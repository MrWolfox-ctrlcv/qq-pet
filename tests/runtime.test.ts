// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import sharp from 'sharp';
import { PetStore } from '../src/store.ts';
import { PrivateConfig } from '../src/private-config.ts';
import { Runtime } from '../src/runtime.ts';
import { EventSequencer } from '../src/core/events.ts';

const pause=(ms=10)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean,timeout=2500){const end=Date.now()+timeout;while(Date.now()<end){if(fn())return;await pause()}throw new Error('Timed out waiting for runtime state')}
function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve}}
function makeModel(handler:(messages:any[])=>Promise<string>|string){let calls=0;const captured:any[][]=[],kinds:string[]=[];return {calls:()=>calls,captured,kinds,usage:()=>({calls,promptTokens:0,completionTokens:0,cachedTokens:null}),call:async(_pet:string,_config:any,messages:any[],options:any={})=>{calls++;captured.push(messages);kinds.push(options.kind||'chat');return {text:await handler(messages),usage:{calls:1,promptTokens:1,completionTokens:1,cachedTokens:null},raw:{}}}}}
async function fixture(t:any,opts:{accountId?:string;connectedAccountId?:string;live?:boolean;paused?:boolean;modelHandler?:(messages:any[])=>Promise<string>|string;proactive?:boolean}={}){
  const expected=opts.accountId??'999',connected=opts.connectedAccountId??expected;const dir=mkdtempSync(path.join(os.tmpdir(),'qq-runtime-'));const store=new PetStore(dir);store.createPet({id:'pet',name:'TestPet',accountId:expected,settings:{toolsEnabled:true,masterId:'42',paused:!!opts.paused,proactiveReply:!!opts.proactive}});
  const server=new WebSocketServer({port:0});await new Promise<void>(r=>server.once('listening',r));const addr=server.address();if(!addr||typeof addr==='string')throw new Error('WebSocket test server has no address');const clients=new Set<WebSocket>(),sent:any[]=[],actions:any[]=[];
  server.on('connection',ws=>{clients.add(ws);ws.on('close',()=>clients.delete(ws));ws.on('message',buf=>{const req=JSON.parse(String(buf));actions.push(req);const data=req.action==='get_login_info'?{user_id:connected}:req.action==='get_status'?{online:true,good:true}:req.action==='send_msg'?(sent.push(req.params),{message_id:`out-${sent.length}`}):req.action==='get_group_member_list'?[{user_id:'42'}]:req.action==='get_msg'?{message_id:req.params.message_id,user_id:7,group_id:7,time:1,message:'quoted'}:{};ws.send(JSON.stringify({echo:req.echo,status:'ok',retcode:0,data}))})});
  const config=new PrivateConfig(dir);config.set('pet',{connection:{enabled:true,live:opts.live??true,wsUrl:`ws://127.0.0.1:${addr.port}`},model:{apiKey:'fake',baseUrl:'http://model.invalid',chatModel:'fake-chat',visionModel:'fake-vision'}});const models=makeModel(opts.modelHandler??(()=> '收到'));const runtime=new Runtime(store,config,models as any);const runtimes=[runtime];await runtime.refresh('pet');await until(()=>['online','wrong-account'].includes(runtime.status('pet').account.state));
  const emit=(event:any)=>{for(const ws of clients)if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({post_type:'message',self_id:connected,message_type:event.group_id?'group':'private',time:Math.floor(Date.now()/1000),...event}))};
  t.after(async()=>{await Promise.all(runtimes.map(r=>r.stop()));await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(dir,{recursive:true,force:true})});
  return {dir,store,server,clients,sent,actions,config,models,runtime,runtimes,addRuntime:(r:Runtime)=>runtimes.push(r),emit};
}

test('group stream retains image author and sequence snapshot; duplicate delivery sends once and old media is not fetched',async t=>{
  const entered=gate(),resume=gate();let block=true;
  const f=await fixture(t,{modelHandler:async messages=>{const current=JSON.parse(String(messages[1]?.content??'{}'));if(current.currentSpeaker?.id==='42'&&block){entered.resolve();await resume.promise;block=false}return '收到'} });
  f.emit({message_id:'A-image',group_id:7,user_id:11,sender:{nickname:'A'},message:[{type:'image',data:{url:'https://a.qpic.cn/old.jpg'} }]});
  f.emit({message_id:'B-text',group_id:7,user_id:22,sender:{nickname:'B'},message:[{type:'text',data:{text:'unrelated'} }]});
  await until(()=>f.store.listMessages('pet',{chatId:'group:7',limit:10}).length===2);
  const c={message_id:'C-trigger',group_id:7,user_id:42,sender:{nickname:'Owner'},message:[{type:'at',data:{qq:'999'}},{type:'text',data:{text:' hi'}}]};f.emit(c);
  await entered.promise;f.emit(c);f.emit({message_id:'D-later',group_id:7,user_id:33,message:[{type:'text',data:{text:'later'} }]});resume.resolve();
  await until(()=>f.store.listTraces('pet').some(x=>x.triggerId==='D-later'&&x.state==='silent'));
  assert.equal(f.models.calls(),1);assert.equal(f.sent.length,1);assert.equal(f.actions.filter(a=>a.action==='get_image').length,0);
  const captured=f.models.captured[0].map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content));const a=captured.find(x=>x.includes('A-image'))!,cMsg=captured.find(x=>x.includes('C-trigger'))!;
  assert.match(a,/"senderId":"11"/);assert.match(a,/"relation":"history"/);assert.match(cMsg,/"senderId":"42"/);assert.match(cMsg,/"relation":"current"/);assert.doesNotMatch(cMsg,/old\.jpg/);assert.doesNotMatch(captured.join('\n'),/D-later/);
  const send=f.sent[0];assert.equal(send.message_type,'group');assert.equal(send.group_id,'7');
});

test('private messages reply directly; paused and preview-only live flags archive without model calls or sends',async t=>{
  const f=await fixture(t,{modelHandler:()=> 'private reply'});f.emit({message_id:'dm',user_id:42,message:[{type:'text',data:{text:'hello'}}]});await until(()=>f.sent.length===1);assert.equal(f.sent[0].message_type,'private');assert.equal(f.sent[0].user_id,'42');
  f.store.updatePet('pet',{settings:{paused:true}},f.store.getPet('pet').version);f.emit({message_id:'paused',user_id:42,message:[{type:'text',data:{text:'still here?'}}]});await until(()=>f.store.listTraces('pet').some(x=>x.triggerId==='paused'&&x.state==='archived-only'));
  f.store.updatePet('pet',{settings:{paused:false}},f.store.getPet('pet').version);f.config.set('pet',{connection:{live:false}});f.emit({message_id:'preview-only',user_id:42,message:[{type:'text',data:{text:'online?'}}]});await until(()=>f.store.listTraces('pet').some(x=>x.triggerId==='preview-only'&&x.state==='archived-only'));
  assert.equal(f.models.calls(),1);assert.equal(f.sent.length,1);
});

test('wrong account never reaches model or send; explicit evidence is scoped and source-linked without changing locked profile fields',async t=>{
  const entered=gate(),resume=gate();const f=await fixture(t,{modelHandler:async messages=>{const sys=String(messages[0]?.content??'');if(sys.includes('只提取当前说话人'))return JSON.stringify([{text:'喜欢喝茶',kind:'preference',confidence:0.95}]);entered.resolve();await resume.promise;return '记住了'} });
  f.store.createPerson('pet',{id:'42',displayName:'Owner',aliases:[],fields:{relationship:'manual'},lockedFields:['relationship']});
  f.emit({message_id:'evidence',user_id:42,sender:{nickname:'Owner'},message:[{type:'text',data:{text:'我喜欢喝茶，请记住我喜欢茶'}}]});await entered.promise;resume.resolve();await until(()=>f.store.listMemories('pet').length===1);
  const memory=f.store.listMemories('pet')[0];assert.deepEqual(memory.sourceMessageIds,['private:42#evidence']);assert.equal(memory.scope,'person');assert.equal(memory.personId,'42');assert.equal(f.store.listPeople('pet').find(p=>p.id==='42')?.fields.relationship,'manual');
  const mismatch=await fixture(t,{accountId:'999',connectedAccountId:'wrong',modelHandler:()=>{throw new Error('must not be called')}});
  const event=new EventSequencer().next({message_id:'wrong-self',user_id:42,time:1,message:'hi',self_id:'wrong'});
  await mismatch.runtime.accept('pet',event);await until(()=>mismatch.store.listTraces('pet').some(x=>x.triggerId==='wrong-self'&&x.state==='archived-only'));
  assert.equal(mismatch.models.calls(),0);assert.equal(mismatch.sent.length,0);
});

test('PIC before AT sends the validated original without leaking tool markers; drawing marker is ignored without explicit intent',async t=>{
  let assetId='';const f=await fixture(t,{modelHandler:messages=>{if(messages[0]?.role==='user')return JSON.stringify({description:'A yellow flower',ids:[assetId]});return `[[PIC: ${assetId}]] [[AT: 42]] [[AT: 42]] [[AT: 42]] [[AT: 42]] [[记:旧版记忆操作]]`}});
  const original=await sharp({create:{width:17,height:13,channels:3,background:'#f0c000'}}).png().toBuffer();const asset=await f.store.importAsset('pet',{bytes:original,kind:'gallery',category:'drawing',title:'flower',description:'yellow flower',scope:'public'});assetId=asset.id;
  f.emit({message_id:'pic-request',group_id:7,user_id:42,message:[{type:'at',data:{qq:'999'}},{type:'text',data:{text:'发这张花图'}}]});await until(()=>f.sent.length===1);
  const message=f.sent[0].message;const image=message.find((s:any)=>s.type==='image');assert.ok(image);assert.equal(Buffer.from(String(image.data.file).replace('base64://',''),'base64').compare(original),0);
  assert.doesNotMatch(JSON.stringify(message),/\[\[(?:PIC|IMG|REF|GALLERY|STICKER|ACTION|记):/);
  assert.equal(message.filter((s:any)=>s.type==='at').length,3);
  assert.ok(f.models.kinds.includes('gallery-preview'));
});

test('generated image call requires explicit user drawing intent',async t=>{
  const f=await fixture(t,{modelHandler:()=> '[[IMG: a purple cat]]'});f.emit({message_id:'no-draw',user_id:42,message:[{type:'text',data:{text:'你好'}}]});await until(()=>f.sent.length===1);
  assert.equal(f.models.kinds.includes('drawing'),false);assert.equal(f.store.listAssets('pet',{kind:'gallery'}).length,0);assert.match(JSON.stringify(f.sent[0].message),/未明确要求新画/);
});

test('existing image request finds a literal subject, previews it and sends its catalog number without drawing',async t=>{
  let assetId='',number=0;const f=await fixture(t,{modelHandler:messages=>{
    if(Array.isArray(messages[0]?.content))return JSON.stringify({description:'一只白萝卜',ids:[assetId]});
    const result=messages.find(m=>typeof m.content==='string'&&m.content.includes('"toolResults"'));
    if(result){const data=JSON.parse(String(result.content)).toolResults[0];assert.equal(data.images[0].id,assetId);return `这张萝卜图！[[PIC: 图${number}]]`;}
    return '[[GALLERY: 萝卜]]';
  }});
  const bytes=await sharp({create:{width:11,height:9,channels:3,background:'#eeeecc'}}).png().toBuffer();const asset=await f.store.importAsset('pet',{bytes,kind:'gallery',category:'drawing',title:'水彩插画，一只白萝卜',description:'一只带绿叶的白萝卜',scope:'public'});assetId=asset.id;number=asset.number;
  f.emit({message_id:'send-radish',group_id:7,user_id:42,message:[{type:'at',data:{qq:'999'}},{type:'text',data:{text:'发对应的萝卜图'}}]});await until(()=>f.sent.length===1);
  const image=f.sent[0].message.find((s:any)=>s.type==='image');assert.ok(image);assert.equal(image.assetId,assetId);assert.equal(Buffer.from(image.data.file.slice(9),'base64').compare(bytes),0);assert.equal(f.models.kinds.includes('drawing'),false);assert.equal(f.models.kinds.filter(k=>k==='gallery-preview').length,1);
});

test('closed tool interface hides instructions and blocks model-emitted tool markers',async t=>{
  const f=await fixture(t,{modelHandler:()=> '[[MEDIA: {"op":"add","kind":"sticker"}]] [[AT: 42]] [[PIC: forged]] 已收到'});
  const pet=f.store.getPet('pet');f.store.updatePet('pet',{settings:{toolsEnabled:false}},pet.version);
  f.emit({message_id:'closed-tools',user_id:42,message:[{type:'text',data:{text:'把图片收成表情包'}}]});await until(()=>f.sent.length===1);
  assert.equal(f.models.calls(),1);assert.equal(f.store.listAssets('pet').length,0);
  assert.ok(f.sent[0].message.every((s:any)=>s.type==='text'));assert.doesNotMatch(JSON.stringify(f.sent[0].message),/\[\[/);
  assert.match(String(f.models.captured[0][0].content),/工具接口已关闭/);
});

test('open media tool collects an attached image through the chat loop and reports its real catalog number',async t=>{
  const bytes=await sharp({create:{width:8,height:6,channels:3,background:'#cc9966'}}).png().toBuffer();
  const oldFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(bytes);t.after(()=>{globalThis.fetch=oldFetch});
  const f=await fixture(t,{modelHandler:messages=>{
    if(Array.isArray(messages[0]?.content))return 'A brown rectangle.';
    const result=messages.filter(m=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('"toolResults"')).at(-1);
    if(result){const action=JSON.parse(result.content).toolResults[0];assert.equal(action.ok,true);return '已收录，编号'+action.asset.key;}
    return '[[MEDIA: {"op":"add","kind":"sticker","source":"current","title":"新表情","tags":["棕色"]}]]';
  }});
  f.emit({message_id:'collect-image',user_id:42,message:[{type:'text',data:{text:'把这张图收为表情包，标签棕色'}},{type:'image',data:{url:'https://a.qpic.cn/collect.png'}}]});
  await until(()=>f.sent.length===1);
  const assets=f.store.listAssets('pet',{kind:'sticker'});assert.equal(assets.length,1);assert.equal(assets[0].title,'新表情');assert.deepEqual(assets[0].tags,['棕色']);
  assert.match(JSON.stringify(f.sent[0].message),new RegExp('编号表'+assets[0].number));assert.doesNotMatch(JSON.stringify(f.sent[0].message),/\[\[MEDIA/);
  const provenance=f.store.db.prepare('SELECT source_message,source_sender FROM media_catalog WHERE asset_id=?').get(assets[0].id);assert.equal(provenance?.source_message,'collect-image');assert.equal(provenance?.source_sender,'42');
});

test('an explicit reply may analyze the old image while preserving its original author and reply relation',async t=>{
  const oldFetch=globalThis.fetch;const png=await sharp({create:{width:9,height:9,channels:3,background:'#334455'}}).png().toBuffer();let downloads=0;globalThis.fetch=async()=>{downloads++;return new Response(png,{status:200,headers:{'content-type':'image/png'}})};t.after(()=>{globalThis.fetch=oldFetch});
  const f=await fixture(t,{modelHandler:messages=>messages[0]?.role==='user'&&Array.isArray(messages[0]?.content)?'A small blue square is visible.':'I can see a blue square.'});
  f.emit({message_id:'old-image',group_id:7,user_id:11,sender:{nickname:'ImageA'},message:[{type:'image',data:{url:'https://a.qpic.cn/old.png'}}]});await until(()=>f.store.listMessages('pet',{chatId:'group:7',limit:10}).length===1);
  f.emit({message_id:'reply-image',group_id:7,user_id:42,reply_id:'old-image',message:[{type:'reply',data:{id:'old-image'}},{type:'at',data:{qq:'999'}},{type:'text',data:{text:'这张图是什么？'}}]});await until(()=>f.store.listTraces('pet').some(x=>x.triggerId==='reply-image'&&x.state==='sent'));
  assert.equal(downloads,1);const trace=f.store.listTraces('pet').find(x=>x.triggerId==='reply-image');const content=trace.messages.map((m:any)=>String(m.content)).join('\n');assert.match(content,/explicit-reply-media/);assert.match(content,/"originalSenderId":"11"/);assert.match(content,/"sourceMessageId":"old-image"/);
});

test('accepted jobs survive restart in sequence order, while imported history has no replay job',async t=>{
  const f=await fixture(t,{paused:true});
  f.emit({message_id:'resume-me-1',user_id:42,sender:{nickname:'Owner'},message:[{type:'text',data:{text:'first after restart'}}]});
  f.emit({message_id:'resume-me-2',user_id:42,sender:{nickname:'Owner'},message:[{type:'text',data:{text:'second after restart'}}]});
  await until(()=>['resume-me-1','resume-me-2'].every(id=>f.store.db.prepare('SELECT state FROM incoming_jobs WHERE pet_id=? AND source_id=?').get('pet',id)?.state==='done'));
  const imported=f.store.putMessage('pet',{id:'imported-old-history',chatId:'private:42',senderId:'42',senderName:'Owner',segments:[{type:'text',text:'old'}],direction:'in'});
  assert.ok(imported);assert.equal(f.store.db.prepare('SELECT 1 FROM incoming_jobs WHERE pet_id=? AND source_id=?').get('pet','imported-old-history'),undefined);
  // Simulate a process stopping after transactional acceptance but before it
  // claimed either job. The recovered order follows persisted chat sequence.
  f.store.db.prepare("UPDATE incoming_jobs SET state='queued',attempts=0 WHERE pet_id='pet' AND source_id IN ('resume-me-1','resume-me-2')").run();
  f.store.updatePet('pet',{settings:{paused:false}},f.store.getPet('pet').version);
  await f.runtime.stop();
  const restarted=new Runtime(f.store,f.config,f.models as any);f.addRuntime(restarted);
  await restarted.refresh('pet');await until(()=>restarted.status('pet').account.state==='online');
  await until(()=>f.sent.length===2);
  await until(()=>['resume-me-1','resume-me-2'].every(id=>f.store.db.prepare('SELECT state FROM incoming_jobs WHERE pet_id=? AND source_id=?').get('pet',id)?.state==='done'));
  assert.equal(f.sent.length,2);assert.equal(f.models.calls(),2);
  const currentIds=f.models.captured.map(input=>String(input.find(m=>typeof m.content==='string'&&m.content.includes('"relation":"current"'))?.content||'').match(/"messageId":"([^"]+)"/)?.[1]);
  assert.deepEqual(currentIds,['resume-me-1','resume-me-2']);
  assert.equal(f.store.db.prepare('SELECT 1 FROM incoming_jobs WHERE pet_id=? AND source_id=?').get('pet','imported-old-history'),undefined);
});

test('sent and possibly-sent deliveries are reconciled without another send',async t=>{
  const f=await fixture(t,{paused:true});
  for(const id of ['already-sent','may-have-sent'])f.emit({message_id:id,user_id:42,message:[{type:'text',data:{text:'archive only'}}]});
  await until(()=>['already-sent','may-have-sent'].every(id=>f.store.db.prepare('SELECT state FROM incoming_jobs WHERE pet_id=? AND source_id=?').get('pet',id)?.state==='done'));
  const now=new Date().toISOString();
  for(const [id,state] of [['already-sent','sent'],['may-have-sent','sending']] as const){
    f.store.db.prepare('INSERT INTO deliveries VALUES(?,?,?,?,?,?)').run('pet','private:42',id,state,null,now);
    f.store.db.prepare("UPDATE incoming_jobs SET state='running' WHERE pet_id=? AND chat_id=? AND source_id=?").run('pet','private:42',id);
  }
  f.store.updatePet('pet',{settings:{paused:false}},f.store.getPet('pet').version);await f.runtime.stop();
  const restarted=new Runtime(f.store,f.config,f.models as any);f.addRuntime(restarted);await restarted.refresh('pet');await until(()=>restarted.status('pet').account.state==='online');await pause(100);
  assert.equal(f.sent.length,0);assert.equal(f.models.calls(),0);
  assert.equal(f.store.db.prepare('SELECT state FROM deliveries WHERE source_id=?').get('may-have-sent')?.state,'uncertain');
  assert.equal(f.store.db.prepare('SELECT state FROM incoming_jobs WHERE source_id=?').get('already-sent')?.state,'done');
  assert.equal(f.store.db.prepare('SELECT state FROM incoming_jobs WHERE source_id=?').get('may-have-sent')?.state,'done');
});

test('model failures are surfaced as failed jobs and never retried in a restart loop',async t=>{
  const f=await fixture(t,{modelHandler:()=>{throw new Error('model unavailable')}});
  f.emit({message_id:'model-failed',user_id:42,message:[{type:'text',data:{text:'hello'}}]});
  await until(()=>f.store.db.prepare('SELECT state FROM incoming_jobs WHERE source_id=?').get('model-failed')?.state==='failed');
  const job=f.store.db.prepare('SELECT last_error FROM incoming_jobs WHERE source_id=?').get('model-failed');assert.match(String(job?.last_error),/model unavailable/);assert.equal(f.sent.length,0);
  await f.runtime.stop();const restarted=new Runtime(f.store,f.config,f.models as any);f.addRuntime(restarted);await restarted.refresh('pet');await until(()=>restarted.status('pet').account.state==='online');await pause(100);
  assert.equal(f.models.calls(),1);assert.equal(f.sent.length,0);assert.equal(f.store.db.prepare('SELECT state FROM incoming_jobs WHERE source_id=?').get('model-failed')?.state,'failed');
});

test('refreshing configuration while an old model call is pending prevents stale runner sends',async t=>{
  const entered=gate(),resume=gate();const f=await fixture(t,{modelHandler:async()=>{entered.resolve();await resume.promise;return 'stale reply'}});
  f.emit({message_id:'stale-generation',user_id:42,message:[{type:'text',data:{text:'hello'}}]});await entered.promise;
  await f.runtime.refresh('pet');await until(()=>f.runtime.status('pet').account.state==='online');resume.resolve();
  await until(()=>f.store.db.prepare('SELECT state FROM incoming_jobs WHERE source_id=?').get('stale-generation')?.state==='done');
  assert.equal(f.sent.length,0);assert.equal(f.store.db.prepare('SELECT state FROM deliveries WHERE source_id=?').get('stale-generation')?.state,'failed');
});

test('recent prompt context and tool history are bounded and clipping is recorded in traces',async t=>{
  const f=await fixture(t,{modelHandler:messages=>messages.some((m:any)=>typeof m.content==='string'&&m.content.includes('"toolResults"'))?'done':'[[HISTORY: message-]]'});
  for(let i=0;i<20;i++)f.store.putMessage('pet',{id:`import-${i}`,chatId:'private:42',senderId:String(100+i),senderName:'Imported',sentAt:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString(),segments:[{type:'text',text:`message-${i} `+'x'.repeat(1400)},{type:'image',url:'https://a.qpic.cn/image?token=do-not-include',metadata:{url:'https://a.qpic.cn/image?token=do-not-include'}}],direction:'in'});
  const longFact='fact '+('y'.repeat(800));f.store.createMemory('pet',{text:longFact,personId:'42',scope:'person',kind:'fact',sourceMessageIds:['private:42#import-1'],confidence:0.9});
  f.emit({message_id:'budget-trigger',user_id:42,sender:{nickname:'Owner'},message:[{type:'text',data:{text:'hello fact '+'z'.repeat(2600)}}]});await until(()=>f.sent.length===1);
  const trace=f.store.listTraces('pet').find(x=>x.triggerId==='budget-trigger');assert.ok(trace?.contextBudget);assert.ok(trace.contextBudget.recentContextChars<=trace.contextBudget.recentContextCharLimit);assert.ok(trace.contextBudget.omittedMessageIds.length>0);assert.ok(trace.contextBudget.truncatedMessageIds.length>0);assert.ok(trace.contextBudget.clippedMemoryIds.includes(f.store.listMemories('pet')[0].id));
  const historyInputs=trace.messages.filter((m:any)=>{if(m.role!=='user'||typeof m.content!=='string')return false;try{return ['current','history'].includes(JSON.parse(m.content).relation)}catch{return false}});
  assert.ok(historyInputs.length<12);assert.ok(historyInputs.every((m:any)=>m.content.length<=900));assert.doesNotMatch(JSON.stringify(trace.messages),/do-not-include/);
  const current=historyInputs.find((m:any)=>m.content.includes('"relation":"current"'));assert.ok(current);assert.match(current.content,/"senderId":"42"/);
  const historyTool=trace.messages.find((m:any)=>typeof m.content==='string'&&m.content.includes('"tool":"HISTORY"'));assert.ok(historyTool);const toolPayload=JSON.parse(historyTool.content).toolResults[0];assert.ok(toolPayload.chars<=2400);assert.ok(toolPayload.messages.length<=8);
});


test('separate image then describe request reads that actual image with original attribution',async t=>{
  const bytes=await sharp({create:{width:15,height:10,channels:3,background:'#008800'}}).png().toBuffer();const previous=globalThis.fetch;let downloads=0;
  globalThis.fetch=async()=>{downloads++;return new Response(bytes)};t.after(()=>{globalThis.fetch=previous});
  const f=await fixture(t,{modelHandler:messages=>Array.isArray(messages[0]?.content)?'图中是绿色黑板，上面有白色文字。':'这是一块绿色黑板。'});
  f.emit({message_id:'own-photo',group_id:7,user_id:42,message:[{type:'image',data:{url:'https://a.qpic.cn/own.png'}}]});
  await until(()=>f.store.listTraces('pet').some(t=>t.triggerId==='own-photo'));
  f.emit({message_id:'describe-own',group_id:7,user_id:42,message:[{type:'at',data:{qq:'999'}},{type:'text',data:{text:'描述图片'}}]});
  await until(()=>f.store.listTraces('pet').some(t=>t.triggerId==='describe-own'&&t.state==='sent'));
  const trace=f.store.listTraces('pet').find(t=>t.triggerId==='describe-own');const observation=trace.messages.map((m:any)=>{try{return JSON.parse(m.content)}catch{return {}}}).find((x:any)=>x.relation==='recent-image-reference-media');
  assert.equal(downloads,1);assert.equal(observation.sourceMessageId,'own-photo');assert.equal(observation.originalSenderId,'42');assert.equal(observation.delivery,'native-image-input');const input=f.models.captured.flat().find((m:any)=>Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='image_url'));assert.ok(input);assert.equal(Buffer.from(input.content[0].image_url.url.split(',')[1],'base64').compare(bytes),0);assert.equal(f.models.kinds.includes('image-analysis'),false);assert.ok(trace.contextBudget.mediaReserveChars>0);
});

test('image question with multiple other authors requests clarification without downloading an arbitrary image',async t=>{
  const f=await fixture(t);for(const uid of [11,12]){f.emit({message_id:'photo-'+uid,group_id:7,user_id:uid,message:[{type:'image',data:{file:'native-image:'+uid}}]});await until(()=>f.store.listTraces('pet').some(t=>t.triggerId==='photo-'+uid));}
  f.emit({message_id:'ambiguous-image',group_id:7,user_id:42,message:[{type:'at',data:{qq:'999'}},{type:'text',data:{text:'描述图片'}}]});await until(()=>f.sent.length===1);
  const input=f.models.captured.flat().map((m:any)=>String(m.content)).join('\n');assert.match(input,/image-reference-unresolved/);assert.match(input,/ambiguous/);assert.equal(f.actions.filter(a=>a.action==='get_image').length,0);
});
