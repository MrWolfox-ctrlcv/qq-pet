// SPDX-License-Identifier: Apache-2.0
// Apache-2.0. OneBot-compatible local transport over an existing native QQ session.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const prepareImage = require('./native-image-send.cjs');
const MAX_REQUEST=72*1024*1024;

module.exports = function startProvider(configFile) {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const accountId = String(config.accountId);
  const base = path.dirname(configFile);
  const dataRoot=path.resolve(config.dataDir||path.join(base,'..'));
  if(!Number.isInteger(config.port)||config.port<1024||config.port>65535)throw new Error('Invalid bridge port');
  const existing = globalThis.__qqPetNativeBridge;
  if (existing?.provider && existing.provider.status().state !== 'stopped') {
    if(existing.accountId!==accountId)throw new Error('Use a separate QQ process for each account');
    return existing.provider.status();
  }
  if (!/^[1-9][0-9]{4,11}$/.test(accountId) || !/^[a-f0-9]{64}$/.test(config.accessToken)) throw new Error('Invalid private bridge configuration');
  if (String(globalThis.authData?.uin) !== accountId || globalThis.sessionInited !== true) throw new Error('Native account identity mismatch');
  const { WebSocketServer, WebSocket } = require('ws');
  const native = process._linkedBinding('QQNT');
  const session = native.NodeIQQNTWrapperSession.getNTWrapperSession(config.sessionId||'nt_1');
  const messages = session.getMsgService();
  const state = {accountId, pid:process.pid, bridgeRevision:2, transport:'native-qq', state:'starting', port:config.port,
    incoming:0, outgoing:0, lastEventAt:null, lastError:null,
    capabilities:{textSend:true,imageSend:true,nativeAt:true,history:true,cachedImages:true}};
  const rawCache = new Map(), uinToUid = new Map(), media = new Map(), events = new Map(), downloads = new Map();
  const backlogFile=path.join(base,'event-backlog.json');
  const backlog=new Map();let backlogWrite=Promise.resolve();
  function inScope(list,scope){return !list?.length || list.includes(scope) || list.includes(scope.split(':')[0]+':*');}
  function allowed(event){const scope=event.message_type==='group'?`group:${event.group_id}`:`private:${event.user_id}`;
    return inScope(config.receiveAllowlist,scope);}
  if(fs.existsSync(backlogFile))for(const event of JSON.parse(fs.readFileSync(backlogFile,'utf8'))){
    if(String(event.self_id)===accountId && allowed(event) && event.time>Date.now()/1000-86400)
      backlog.set(`${event.message_type}:${event.group_id||event.user_id}:${event.message_id}`,event);
  }
  function saveBacklog(){const snapshot=JSON.stringify([...backlog.values()]);
    backlogWrite=backlogWrite.catch(()=>{}).then(async()=>{await fs.promises.writeFile(backlogFile+'.tmp',snapshot);
      await fs.promises.rename(backlogFile+'.tmp',backlogFile);}).catch(()=>{});}
  const referenceFile=path.join(base,'message-references.json');
  const references=new Map();
  if(fs.existsSync(referenceFile))for(const row of JSON.parse(fs.readFileSync(referenceFile,'utf8'))){
    if(row.accountId===accountId && row.sourceId && row.peerUid)references.set(row.sourceId,row);
  }
  let referenceWrite=Promise.resolve();
  function saveReferences(){
    const snapshot=JSON.stringify([...references.values()]);
    referenceWrite=referenceWrite.catch(()=>{}).then(async()=>{
      await fs.promises.writeFile(referenceFile+'.tmp',snapshot);
      await fs.promises.rename(referenceFile+'.tmp',referenceFile);
    }).catch(()=>{});
  }
  const downloadRoot=path.join(base,'downloads');fs.mkdirSync(downloadRoot,{recursive:true});
  const managedMediaRoot=path.resolve(dataRoot,'provider','native-media',accountId);
  fs.mkdirSync(managedMediaRoot,{recursive:true});
  const metadataFile=path.join(base,'reader','events-metadata.ndjson');
  uinToUid.set(accountId,String(globalThis.authData?.uid || ''));
  if(fs.existsSync(metadataFile))for(const line of fs.readFileSync(metadataFile,'utf8').trim().split('\n').slice(-128)) {
    try {const row=JSON.parse(line);if(row.accountId===accountId && row.authorUin && row.authorUid)uinToUid.set(row.authorUin,row.authorUid);}catch{}
  }
  const status = () => ({...state, online:online()});
  const online = () => String(globalThis.authData?.uin) === accountId && globalThis.sessionInited === true && globalThis.statusData?.disconnect !== true;
  let statusWrite=Promise.resolve();
  function saveStatus() {
    const snapshot=JSON.stringify(status()), file=path.join(base,'provider-status.json');
    statusWrite=statusWrite.catch(()=>{}).then(async()=>{
      await fs.promises.writeFile(file+'.tmp',snapshot);
      await fs.promises.rename(file+'.tmp',file);
    }).catch(()=>{});
  }
  function remember(map,key,value,max=512) {map.set(key,value);if(map.size>max)map.delete(map.keys().next().value);}
  function identity(raw) {return `${raw.chatType}:${raw.peerUid}:${raw.msgId}`;}
  function peer(raw) {return {chatType:Number(raw.chatType),peerUid:String(raw.peerUid),guildId:''};}

  function normalize(raw) {
    if (!raw?.msgId || !raw.peerUid || !raw.senderUin || ![1,2].includes(Number(raw.chatType))) return null;
    const author = String(raw.senderUin), nativeUid = String(raw.senderUid || '');
    if(nativeUid)uinToUid.set(author,nativeUid);
    if(!references.has(String(raw.msgId))) {
      remember(references,String(raw.msgId),{accountId,sourceId:String(raw.msgId),chatType:Number(raw.chatType),
        peerUid:String(raw.peerUid),authorUin:author,authorUid:nativeUid},4096);
      saveReferences();
    }
    const content=[];
    for(const el of raw.elements || []) {
      if(el.elementType===1 && el.textElement) {
        const text=el.textElement;
        if(Number(text.atType)===1)content.push({type:'at',data:{qq:'all'}});
        else if(Number(text.atType)===2) {
          const direct=String(text.atUid || '');
          const mapped=[...uinToUid].find(([,uid])=>uid && uid===text.atNtUid)?.[0];
          const target=/^[1-9][0-9]{4,11}$/.test(direct)?direct:mapped;
          if(target)content.push({type:'at',data:{qq:target}});
          else content.push({type:'text',data:{text:String(text.content || '')}});
        }
        else content.push({type:'text',data:{text:String(text.content || '')}});
      } else if(el.elementType===2 && el.picElement) {
        const key=`native-image:${raw.msgId}:${el.elementId}`;
        remember(media,key,{raw,element:el},1024);
        content.push({type:'image',data:{file:key}});
      } else if(el.elementType===7 && el.replyElement) {
        const id=el.replyElement.replayMsgId || el.replyElement.replyMsgId || '';
        if(id)content.push({type:'reply',data:{id:String(id)}});
      } else content.push({type:'native',data:{element_type:el.elementType}});
    }
    const group=Number(raw.chatType)===2;
    const result={time:Number(raw.msgTime),self_id:accountId,post_type:'message',
      message_type:group?'group':'private',sub_type:group?'normal':'friend',
      message_id:String(raw.msgId),user_id:author,
      sender:{user_id:author,nickname:String(raw.sendNickName || raw.senderNick || '')},
      message:content,raw_message:content.filter(x=>x.type==='text').map(x=>x.data.text).join('')};
    if(group)result.group_id=String(raw.peerUin || raw.peerUid);
    remember(rawCache,String(raw.msgId),raw);
    return result;
  }
  const wss = new WebSocketServer({noServer:true,maxPayload:MAX_REQUEST});
  function publish(raw) {
    if(!online())return;
    const event=normalize(raw);if(!event)return;
    const key=identity(raw);if(events.has(key))return;
    remember(events,key,event);
    state.incoming++;state.lastEventAt=new Date().toISOString();saveStatus();
    const data=JSON.stringify(event);
    if(!allowed(event))return;
    remember(backlog,key,event,128);saveBacklog();
    for(const client of wss.clients)if(client.readyState===WebSocket.OPEN && client.bridgeReady)client.send(data);
  }
  const callbacks=new Map([
    ['onRecvMsg',input=>{try{for(const raw of Array.isArray(input)?input:input?.msgList || [])publish(raw);}catch{state.lastError='native-event-error';saveStatus();}}],
    ['onAddSendMsg',raw=>{try{normalize(raw);}catch{}}],
    ['onRichMediaDownloadComplete',info=>{
      const pending=downloads.get(`${info?.msgId}:${info?.msgElementId}`);
      if(pending)pending.complete(info);
    }],
  ]);
  const listener=new Proxy(Object.create(null),{get(_,name){
    if(typeof name!=='string')return undefined;
    if(!callbacks.has(name))callbacks.set(name,()=>{});
    return callbacks.get(name);
  }});
  let listenerId;
  const groups=new Map(),groupWaiters=new Set();let groupListReady=false;
  const groupService=session.getGroupService();
  const groupCallbacks=new Map([
    ['onGroupListUpdate',(_kind,list)=>{
      if(!Array.isArray(list))return;
      for(const group of list){const id=String(group.groupCode || group.groupUin || '');
        if(/^[1-9][0-9]+$/.test(id))groups.set(id,{group_id:id,group_name:String(group.groupName || '')});}
      groupListReady=true;for(const done of groupWaiters)done();groupWaiters.clear();
    }],
    ['onMemberInfoChange',(_group,_source,members)=>{
      for(const member of members instanceof Map?members.values():Object.values(members || {}))
        if(member.uin && member.uid)uinToUid.set(String(member.uin),String(member.uid));
    }],
  ]);
  const groupListener=new Proxy(Object.create(null),{get(_,name){
    if(typeof name!=='string')return undefined;
    if(!groupCallbacks.has(name))groupCallbacks.set(name,()=>{});
    return groupCallbacks.get(name);
  }});
  const groupListenerId=groupService.addKernelGroupListener(groupListener);

  async function findRaw(id,refresh=false) {
    id=String(id);
    if(rawCache.has(id) && !refresh)return rawCache.get(id);
    // Only exact references from our own native captures; no scan of chat history.
    const file=path.join(base,'reader','events-metadata.ndjson');
    const rows=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').slice(-128).map(x=>JSON.parse(x)):[];
    const known=rawCache.get(id);
    const ref=known?{chatType:known.chatType,peerUid:known.peerUid}:references.get(id) || rows.find(row=>row.sourceId===id && row.accountId===accountId);
    if(!ref)throw new Error('Message reference is unavailable');
    const result=await messages.getMsgsByMsgId({chatType:Number(ref.chatType),peerUid:ref.peerUid,guildId:''},[id]);
    const raw=result?.msgList?.find(msg=>String(msg.msgId)===id);
    if(!raw)throw new Error('Native QQ did not return this message');
    normalize(raw);return raw;
  }
  async function action(name,params={}) {
    if(!online())throw new Error('Native QQ account is offline or changed');
    if(name==='get_login_info')return {user_id:accountId,nickname:String(globalThis.authData?.nickName || '')};
    if(name==='get_status')return {online:true,good:state.state==='online',bridge_resume:true};
    if(name==='get_bridge_status')return status();
    if(name==='sync_native_messages') {
      if(!Array.isArray(params.message_ids) || params.message_ids.length>8)throw new Error('Provide at most eight exact native message references');
      for(const id of params.message_ids)publish(await findRaw(id,true));
      return {requested:params.message_ids.length};
    }
    if(name==='get_version_info')return {app_name:'QQ Pet Native Bridge',app_version:'0.1.0',protocol_version:'v11'};
    if(name==='get_msg') {
      const raw=await findRaw(params.message_id,true);return {...normalize(raw),real_id:String(raw.msgId)};
    }
    if(name==='get_image') {
      let ref=media.get(String(params.file));
      if(!ref && String(params.file).startsWith('native-image:')) {
        const [,msgId,elId]=String(params.file).split(':');
        const raw=await findRaw(msgId);ref={raw,element:raw.elements?.find(el=>String(el.elementId)===elId)};
      }
      if(ref?.raw && ref.element) {
        const updated=await findRaw(ref.raw.msgId,true);
        ref={raw:updated,element:updated.elements?.find(el=>String(el.elementId)===String(ref.element.elementId))};
      }
      const pic=ref?.element?.picElement;if(!pic)throw new Error('Image reference is unavailable');
      const thumbs=pic.thumbPath instanceof Map?[...pic.thumbPath.values()]:Object.values(pic.thumbPath || {});
      const candidates=[pic.sourcePath,pic.filePath,pic.original?.filePath,pic.originPath,...(params.full_size===true?[]:thumbs)];
      let file=candidates.find(value=>typeof value==='string' && fs.existsSync(value) && fs.statSync(value).isFile());
      if(!file) {
        const raw=ref.raw, elementId=String(ref.element.elementId), key=`${raw.msgId}:${elementId}`;
        const destination=path.join(downloadRoot,crypto.createHash('sha256').update(key).digest('hex')+'.image');
        if(fs.existsSync(destination) && fs.statSync(destination).size>0)file=destination;
        else {
          let pending=downloads.get(key);
          if(!pending) {
            let resolve,reject;
            const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
            const timer=setTimeout(()=>{downloads.delete(key);reject(new Error('Native image download timed out'));},8000);
            const finish=(error,info)=>{clearTimeout(timer);downloads.delete(key);
              if(error)reject(error);
              else {
                try {
                  const returned=typeof info?.filePath==='string'?info.filePath:'';
                  const available=[destination,returned].find(file=>file && fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size>0);
                  state.lastDownload={hasNativePath:!!returned,fileAvailable:!!available,
                    result:typeof info?.result==='number'?info.result:null,
                    errorCode:Number.isFinite(Number(info?.fileErrCode))?Number(info.fileErrCode):null,
                    fields:info?Object.keys(info):[]};saveStatus();
                  if(available)resolve(available);
                  else reject(new Error('Native image download completed without a file'));
                } catch(error){reject(error);}
              }
            };
            pending={promise,complete:info=>finish(null,info)};downloads.set(key,pending);
            try {
              const request=messages.downloadRichMedia({fileModelId:'0',downSourceType:0,triggerType:1,
                msgId:String(raw.msgId),chatType:Number(raw.chatType),peerUid:String(raw.peerUid),
                elementId,thumbSize:0,downloadType:1,filePath:destination});
              request?.catch?.(error=>finish(error));
            } catch(error){finish(error);}
          }
          file=await pending.promise;
        }
      }
      // Keep the backend's existing private-media boundary intact. Native QQ
      // owns its cache paths; authenticated clients receive only our managed copy.
      const managed=path.join(managedMediaRoot,crypto.createHash('sha256')
        .update(`${accountId}:${ref.raw.msgId}:${ref.element.elementId}`).digest('hex')+'.image');
      if(path.resolve(file)!==path.resolve(managed))await fs.promises.copyFile(file,managed);
      return {file:managed,file_size:fs.statSync(managed).size,filename:path.basename(managed)};
    }
    if(name==='get_friend_list') {
      const list=await session.getBuddyService().getBuddyList();
      return (Array.isArray(list)?list:list?.buddyList || []).flatMap(item=>item.buddyList || [item]).filter(item=>item.uin).map(item=>{
        if(item.uid)uinToUid.set(String(item.uin),String(item.uid));
        return {user_id:String(item.uin),nickname:String(item.nick || item.nickname || ''),remark:String(item.remark || '')};
      });
    }
    if(name==='get_group_list') {
      if(groupListReady)return [...groups.values()];
      await new Promise((resolve,reject)=>{
        const done=()=>{clearTimeout(timer);groupWaiters.delete(done);resolve();};
        const timer=setTimeout(()=>{groupWaiters.delete(done);reject(new Error('Native group list callback timed out'));},8000);
        groupWaiters.add(done);
        try{const request=groupService.getGroupList(false);
          request?.catch?.(error=>{clearTimeout(timer);groupWaiters.delete(done);reject(error);});
        }catch(error){clearTimeout(timer);groupWaiters.delete(done);reject(error);}
      });
      return [...groups.values()];
    }
    if(name==='get_group_member_list') {
      const result=await session.getGroupService().getAllMemberList(String(params.group_id),false);
      if(Number(result?.errCode)!==0)throw new Error('Native group member lookup failed');
      const infos=result.result?.infos;
      return (infos instanceof Map?[...infos.values()]:Object.values(infos || {})).filter(member=>member.uin).map(member=>{
        if(member.uid)uinToUid.set(String(member.uin),String(member.uid));
        return {group_id:String(params.group_id),user_id:String(member.uin),nickname:String(member.nick || ''),card:String(member.cardName || '')};
      });
    }
    if(name==='send_msg' || name==='send_private_msg' || name==='send_group_msg') {
      if(!config.outboundEnabled)throw new Error('Outbound messages are disabled');
      const group=params.message_type==='group' || name==='send_group_msg';
      const recipient=String(group?params.group_id:params.user_id);
      if(!inScope(config.sendAllowlist,`${group?'group':'private'}:${recipient}`))throw new Error('Conversation is outside the enabled scope');
      let uid=group?recipient:uinToUid.get(recipient);
      if(!uid && !group){
        const converted=await session.getUixConvertService().getUid([recipient]);
        uid=converted?.uidInfo instanceof Map?converted.uidInfo.get(recipient):converted?.uidInfo?.[recipient];
        if(uid)uinToUid.set(recipient,String(uid));
      }
      if(!uid)throw new Error('No verified native UID for this recipient');
      const segments=typeof params.message==='string'?[{type:'text',data:{text:params.message}}]:params.message;
      if(!Array.isArray(segments) || segments.length>32)throw new Error('Invalid send message segments');
      const elements=[];
      for(const seg of segments){
        const data=seg.data || seg;
        if(seg.type==='text')elements.push({elementType:1,elementId:'',textElement:{content:String(data.text || ''),atType:0,atUid:'',atNtUid:'',atTinyId:''}});
        else if(seg.type==='at') {
          const target=String(data.qq);let atUid=target==='all'?'':uinToUid.get(target);
          if(target!=='all' && !atUid){
            const converted=await session.getUixConvertService().getUid([target]);
            atUid=converted?.uidInfo instanceof Map?converted.uidInfo.get(target):converted?.uidInfo?.[target];
            if(atUid)uinToUid.set(target,String(atUid));
          }
          if(target!=='all' && !atUid)throw new Error('No verified native UID for mention');
          elements.push({elementType:1,elementId:'',textElement:{content:target==='all'?'@全体成员':`@${target}`,atType:target==='all'?1:2,atUid:target==='all'?'0':target,atNtUid:atUid || '',atTinyId:''}});
        } else if(seg.type==='image')elements.push(await prepareImage(data,messages,path.join(base,'outbound')));
        else throw new Error('This outbound segment is not enabled yet: '+String(seg.type));
      }
      const contact={chatType:group?2:1,peerUid:uid,guildId:''};
      const id=messages.generateMsgUniqueId(contact.chatType,session.getMSFService().getServerTime());
      const result=await messages.sendMsg(id,contact,elements,new Map());
      if(Number(result?.result)!==0)throw new Error('Native send failed ('+String(result?.result)+')');
      state.outgoing++;saveStatus();return {message_id:String(id)};
    }
    throw new Error('Native bridge action is not implemented: '+name);
  }
  function authorized(req) {
    if(req.headers.origin)return false;
    const expected=Buffer.from('Bearer '+config.accessToken), supplied=Buffer.from(String(req.headers.authorization || ''));
    return expected.length===supplied.length && crypto.timingSafeEqual(expected,supplied);
  }
  async function request(data,client) {
    try {
      if(data.action==='bridge_ready'){
        if(!client || !online())throw new Error('Native bridge socket is not ready');
        client.bridgeReady=true;
        return {status:'ok',retcode:0,data:{ready:true},echo:data.echo};
      }
      return {status:'ok',retcode:0,data:await action(String(data.action),data.params || {}),echo:data.echo};}
    catch(error){return {status:'failed',retcode:1400,data:null,message:String(error.message || error).slice(0,180),echo:data.echo};}
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    if(!authorized(req)){res.writeHead(401);res.end('{"error":"unauthorized"}');return;}
    if(req.method!=='POST'){res.writeHead(405);res.end('{}');return;}
    try {
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>MAX_REQUEST)throw new Error('Request too large');chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const name=String(req.url || '').slice(1).split('?')[0];
      res.end(JSON.stringify(await request(name?{action:name,params:body}:body)));
    } catch {res.writeHead(400);res.end('{"error":"invalid request"}');}
  });
  server.on('upgrade',(req,socket,head)=>{
    if(!authorized(req)){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,client=>wss.emit('connection',client,req));
  });
  wss.on('connection',client=>{
    client.on('error',()=>{});
    client.on('message',async bytes=>{try{
      const input=JSON.parse(String(bytes)),response=await request(input,client);
      client.send(JSON.stringify(response));
      if(input.action==='bridge_ready' && response.status==='ok')for(const event of backlog.values()){
        if(event.time>Date.now()/1000-86400 && client.readyState===WebSocket.OPEN)client.send(JSON.stringify(event));
      }
    }catch{client.close(1007);}});
    client.send(JSON.stringify({time:Math.floor(Date.now()/1000),self_id:accountId,post_type:'meta_event',meta_event_type:'lifecycle',sub_type:'connect'}));
  });
  server.on('error',error=>{state.state='failed';state.lastError=String(error.code || 'server-error');
    if(listenerId!=null){try{messages.removeKernelMsgListener(String(listenerId));}catch{}}
    try{groupService.removeKernelGroupListener(groupListenerId);}catch{}saveStatus();});
  existing?.reader?.stop();
  listenerId=messages.addKernelMsgListener(listener);
  const heartbeat=setInterval(()=>{
    const event=JSON.stringify({time:Math.floor(Date.now()/1000),self_id:accountId,post_type:'meta_event',meta_event_type:'heartbeat',status:{online:online(),good:state.state==='online'}});
    for(const client of wss.clients)if(client.readyState===WebSocket.OPEN)client.send(event);
  },10000);heartbeat.unref();
  server.listen(config.port,'127.0.0.1',()=>{state.state='online';saveStatus();});
  const provider={status,action,stop(){
    clearInterval(heartbeat);
    groupService.removeKernelGroupListener(groupListenerId);
    messages.removeKernelMsgListener(String(listenerId));
    for(const client of wss.clients)client.close();wss.close();
    state.state='stopped';saveStatus();
    return Promise.all([referenceWrite,statusWrite,backlogWrite,new Promise(resolve=>server.close(resolve))]);
  }};
  globalThis.__qqPetNativeBridge={native,session,messages,accountId,provider};
  saveStatus();return status();
};
