// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { EventSequencer } from '../src/core/events.ts';
import { buildContext } from '../src/core/context.ts';
import { OneBotTransport } from '../src/adapters/onebot.ts';
import { ResponseDecider } from '../src/core/decision.ts';

test('context preserves author and excludes events beyond trigger watermark', async()=>{
  const q=new EventSequencer();
  const a=q.next({message_id:'1',group_id:9,user_id:11,time:10,message:[{type:'image',data:{url:'a'}}]});
  const trigger=q.next({message_id:'2',group_id:9,user_id:22,time:11,message:'hello'});
  const later=q.next({message_id:'3',group_id:9,user_id:33,time:12,message:'future'});
  const ctx=await buildContext(trigger,[a,trigger,later]);
  assert.equal(ctx.trigger.authorId,'22'); assert.deepEqual(ctx.messages.map(x=>x.authorId),['11','22']);
  assert.notEqual(a.chatId,'private:9');
  assert.equal(a.time,10_000); assert.equal(a.segments[0]?.type,'image');
});

test('context orders imported history by source time after applying the sequence watermark',async()=>{
  const q=new EventSequencer();
  const local1=q.next({message_id:'local-1',group_id:9,user_id:11,time:100,message:'first'});
  const local2=q.next({message_id:'local-2',group_id:9,user_id:22,time:200,message:'second'});
  const local3=q.next({message_id:'local-3',group_id:9,user_id:33,time:300,message:'third'});
  const importedOld=q.next({message_id:'imported-old',group_id:9,user_id:44,time:10,message:[{type:'image',data:{url:'old-image'}}]});
  const trigger=q.next({message_id:'trigger',group_id:9,user_id:55,time:500,message:'current'});
  const later=q.next({message_id:'D-later',group_id:9,user_id:66,time:600,message:'future'});
  // Stable source identity can differ between persisted rows and the normalized
  // trigger object. BuildContext must deduplicate by source ID, not object ID.
  const ctx=await buildContext(trigger,[local1,local2,local3,importedOld,trigger,later],undefined,3);
  assert.deepEqual(ctx.messages.map(e=>e.sourceId),['local-2','local-3','trigger']);
  assert.deepEqual(ctx.messages.map(e=>e.authorId),['22','33','55']);
  assert.equal(ctx.messages.some(e=>e.sourceId==='D-later'),false);
});

test('private messages reply directly; explicit unrelated mentions stay quiet',async()=>{
  const q=new EventSequencer(); const d=new ResponseDecider('99',['88']);
  const dm=q.next({message_id:1,user_id:9,message:'hi'});assert.equal((await d.decide(dm)).reply,true);
  const group=q.next({message_id:2,group_id:8,user_id:9,message:[{type:'at',data:{qq:'77'}}]});assert.equal((await d.decide(group)).reply,false);
});

test('transport authenticates account and gates send on mismatch',async()=>{
  const server=new WebSocketServer({port:0}); await new Promise<void>(r=>server.once('listening',r));
  const address=server.address(); if(!address||typeof address==='string')throw new Error('no server address');
  server.on('connection',ws=>ws.on('message',buf=>{const req=JSON.parse(String(buf)); const data=req.action==='get_login_info'?{user_id:123}:req.action==='get_status'?{online:true,good:true}:{message_id:7};ws.send(JSON.stringify({echo:req.echo,status:'ok',retcode:0,data}));}));
  const transport=new OneBotTransport({url:`ws://127.0.0.1:${address.port}`,expectedAccountId:'456',heartbeatIntervalMs:1000});
  await assert.rejects(transport.connect(),/does not match/);
  assert.equal(transport.state,'account-mismatch');
  const receipt=await transport.sendMessage({message_type:'private',user_id:'1',message:'test'});
  assert.equal(receipt.ok,false); assert.match(receipt.error??'',/not authenticated/);
  await transport.stop(); await new Promise<void>(r=>server.close(()=>r()));
});

test('transport reconnects after socket loss and cleans up on stop',async()=>{
  const server=new WebSocketServer({port:0}); await new Promise<void>(r=>server.once('listening',r));
  const addr=server.address();if(!addr||typeof addr==='string')throw new Error('no server address');
  let connections=0;const actions:string[][]=[];let replayed=0;
  server.on('connection',ws=>{const index=connections++;actions[index]=[];ws.on('message',buf=>{const req=JSON.parse(String(buf));actions[index].push(req.action);const data=req.action==='get_login_info'?{user_id:12}:{online:true,good:true,bridge_resume:true};ws.send(JSON.stringify({echo:req.echo,status:'ok',retcode:0,data}));if(req.action==='bridge_ready'){ws.send(JSON.stringify({post_type:'message',self_id:12,message_id:'retained',user_id:9,message:'retained text'}));if(index===0)setTimeout(()=>ws.terminate(),5);}});});
  const t=new OneBotTransport({url:`ws://127.0.0.1:${addr.port}`,expectedAccountId:'12',heartbeatIntervalMs:1000,reconnectBaseMs:20,reconnectMaxMs:40,maxRetries:3});
  t.onEvent=()=>{assert.equal(t.accountId,'12');assert.equal(t.state,'online');replayed++;};
  await t.connect();
  const deadline=Date.now()+1500;while(replayed<2&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  assert.ok(connections>=2);assert.equal(t.state,'online');
  assert.deepEqual(actions.slice(0,2),[['get_login_info','get_status','bridge_ready'],['get_login_info','get_status','bridge_ready']]);assert.equal(replayed,2);
  await t.stop();await new Promise<void>(r=>server.close(()=>r()));
});

test('transport read API permits provider lookups and blocks all send actions',async()=>{
  const server=new WebSocketServer({port:0});await new Promise<void>(r=>server.once('listening',r));const addr=server.address();if(!addr||typeof addr==='string')throw new Error('no server address');
  const actions:any[]=[];server.on('connection',ws=>ws.on('message',buf=>{const req=JSON.parse(String(buf));actions.push(req);const data=req.action==='get_login_info'?{user_id:12}:req.action==='get_status'?{online:true,good:true}:req.action==='get_msg'?{message_id:'5',group_id:9,user_id:22,time:12,message:'quoted'}:{url:'https://a.qpic.cn/a.wav'};ws.send(JSON.stringify({echo:req.echo,status:'ok',retcode:0,data}))}));
  const t=new OneBotTransport({url:`ws://127.0.0.1:${addr.port}`,expectedAccountId:'12'});await t.connect();const event=await t.getMessage('group:9','5');assert.equal(event?.authorId,'22');assert.equal((await t.readAction('get_record',{file:'x',out_format:'wav'})).url,'https://a.qpic.cn/a.wav');
  await assert.rejects(t.readAction('send_msg',{message:'must never send'}),/read operation/);await assert.rejects(t.setAccountSignature('test',false),/owner-authorized/);await t.setAccountSignature('我的新签名',true);assert.equal(actions.at(-1).action,'set_self_longnick');assert.deepEqual(actions.at(-1).params,{longNick:'我的新签名'});await t.stop();await new Promise<void>(r=>server.close(()=>r()));
});
