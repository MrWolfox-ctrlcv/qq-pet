// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import type {NormalizedEvent} from '../src/core/events.ts';
import {imageReadIntent,selectRecentImageReference} from '../src/core/media-context.ts';
const resolveReply=createRequire(import.meta.url)('../bridge/native-reply.cjs');
const event=(id:string,authorId:string,sequence:number,text='',image=false):NormalizedEvent=>({id,sourceId:id,authorId,chatId:'group:1',chatType:'group',sequence,time:100000+sequence*1000,messageType:'group',text,segments:image?[{type:'image',file:id}]:[{type:'text',text}]});
test('recent image reference requires an image question and preserves author and watermark',()=>{
  const a=event('a','11',1,'',true),b=event('b','42',2,'',true),q=event('q','42',3,'描述图片');
  assert.equal(selectRecentImageReference(q,[a,b,event('future','42',4,'',true)]).event?.sourceId,'b');
  assert.equal(selectRecentImageReference({...q,text:'你好'},[a,b]).event,undefined);
  assert.equal(selectRecentImageReference({...q,authorId:'7'},[a,b]).state,'ambiguous');
  assert.equal(selectRecentImageReference({...q,authorId:'7'},[a]).event?.authorId,'11');
  assert.equal(selectRecentImageReference({...q,time:999999},[a,b]).state,'not-found');
});
test('native reply placeholder resolves by exact sequence, conversation and original author',()=>{
  const raw={chatType:2,peerUid:'group-a'},reply={replayMsgId:'0',replayMsgSeq:'55',senderUin:'11'},records=[{chatType:2,peerUid:'group-b',msgSeq:'55',msgId:'90001',senderUin:'11'},{chatType:2,peerUid:'group-a',msgSeq:'55',msgId:'90002',senderUin:'11'}];
  assert.equal(resolveReply(raw,reply,records),'90002');assert.equal(resolveReply(raw,{...reply,senderUin:'12'},records),'');assert.equal(resolveReply(raw,{replayMsgId:'0'},records),'');assert.equal(resolveReply(raw,{replayMsgId:'90003'},records),'90003');
  assert.equal(resolveReply(raw,{...reply,sourceMsgIdInRecords:'888888'},records),'90002');
  assert.equal(resolveReply(raw,{replayMsgId:'0',sourceMsgIdInRecords:'888888'},records),'');
});
test('lecture request, ability question and bare self mention preserve the recent own image',()=>{
  const image=event('board','42',1,'',true);
  for(const text of ['讲解一下','这个图能看了么','看看','看一下',' ']){
    const q=event('ask','42',2,text);q.segments=[{type:'at',qq:'999'},{type:'text',text}];
    assert.equal(selectRecentImageReference(q,[image],'999').event?.sourceId,'board');
  }
  assert.equal(imageReadIntent('黑板这块是频率特性，把s换成jw，看系统对不同频率的响应。'),false);
});
