// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PetStore} from '../src/store.ts';
import {PrivateConfig} from '../src/private-config.ts';
import {Runtime} from '../src/runtime.ts';
import {contextEvent} from '../src/conversation-context.ts';

async function fixture(t:any){
  const dir=mkdtempSync(path.join(os.tmpdir(),'pet-context-')),store=new PetStore(dir),config=new PrivateConfig(dir);
  store.createPet({id:'p',name:'Pet',accountId:'999',settings:{masterId:'42'}});config.set('p',{model:{apiKey:'fake',baseUrl:'https://model.invalid',decisionModel:'fake-decision'}});
  let count=0,mode='apply',resume:(()=>void)|undefined,entered:(()=>void)|undefined;
  const gate={wait:undefined as Promise<void>|undefined,entered:undefined as Promise<void>|undefined};
  const model:any={usage:()=>({calls:count,promptTokens:null,completionTokens:null,cachedTokens:null}),call:async(_p:any,_c:any,messages:any[],options:any)=>{
    assert.equal(options.kind,'context-compression');count++;const input=JSON.parse(messages[1].content);
    if(gate.wait){entered?.();await gate.wait;gate.wait=undefined;}
    const value=mode==='invalid'?{compress:true,summary:{overview:'bad'},sourceIds:['not-a-source']}:mode==='keep'?{compress:false}:{compress:true,summary:{overview:'早期讨论的摘要',pending:['继续回答当前问题']},sourceIds:input.messages.slice(0,2).map((m:any)=>m.id)};
    return {text:JSON.stringify(value),usage:{calls:1,promptTokens:777,completionTokens:55,totalTokens:832,cachedTokens:null}};
  }};
  const runtime=new Runtime(store,config,model);await runtime.profiler.stop();t.after(async()=>{await runtime.stop();store.close();rmSync(dir,{recursive:true,force:true})});
  const add=(id:string,sender='42',image=false,chat='group:1')=>{const row=store.putMessage('p',{id,chatId:chat,senderId:sender,segments:image?[{type:'image',file:'native-image:'+id}]:[{type:'text',text:id}],direction:'in'});const event=contextEvent(row);const topic=runtime.conversation.track('p',event);return {event,topic};};
  return {store,runtime,add,calls:()=>count,setMode:(m:string)=>{mode=m},block:()=>{gate.wait=new Promise<void>(r=>resume=r);gate.entered=new Promise<void>(r=>entered=r);return {entered:gate.entered,release:()=>resume?.()}}};
}
test('ten-message base expands by topic and images stay with their original participant topic',async t=>{
  const f=await fixture(t);let current:any;for(let i=0;i<17;i++)current=f.add('m'+i);
  const history=f.store.listMessages('p',{chatId:'group:1',limit:100}).map(contextEvent);
  const plan=await f.runtime.conversation.plan('p',current.event,history);assert.equal(plan.settings.window,10);assert.equal(plan.messages.length,17);
  const a=f.add('photo-a','42',true),b=f.add('photo-b','77',true),question=f.add('讲解一下');
  const photoPlan=await f.runtime.conversation.plan('p',{...question.event,time:question.event.time+600000},f.store.listMessages('p',{chatId:'group:1',limit:100}).map(contextEvent));
  assert.equal(photoPlan.topic?.id,a.topic.id);assert.notEqual(photoPlan.topic?.id,b.topic.id);assert.deepEqual(photoPlan.images.map(e=>e.sourceId),['photo-a']);
  const privateChat=f.add('other-chat','42',false,'private:42');assert.notEqual(privateChat.topic.id,a.topic.id);
});
test('compression uses per-call actual input threshold, throttles assessment and preserves original messages',async t=>{
  const f=await fixture(t);let topic:any;for(let i=0;i<25;i++)topic=f.add('m'+i).topic;
  const observe=(n:number)=>f.runtime.conversation.observe('p',topic.id,undefined,{calls:1,promptTokens:n,completionTokens:1,cachedTokens:null});
  observe(9000);assert.equal((await f.runtime.conversation.compact('p',topic.id)).skipped,'below-assessment-threshold');assert.equal(f.calls(),0);
  f.setMode('keep');observe(10000);assert.equal((await f.runtime.conversation.compact('p',topic.id)).skipped,'model-kept-original');assert.equal(f.calls(),1);
  observe(11000);await f.runtime.conversation.compact('p',topic.id);assert.equal(f.calls(),1);
  f.setMode('apply');observe(13000);assert.equal((await f.runtime.conversation.compact('p',topic.id)).applied,true);assert.equal(f.calls(),2);
  const state=f.runtime.conversation.inspect('p');assert.equal(state.topics[0].cursor,15);assert.equal(state.compressions[0].usage.promptTokens,777);assert.equal(f.store.listMessages('p',{chatId:'group:1',limit:100}).length,25);
});
test('compression cannot advance across queued arrivals and concurrent messages survive commit',async t=>{
  const f=await fixture(t);let topic:any;for(let i=0;i<25;i++)topic=f.add('m'+i).topic;
  const pending=f.store.putMessage('p',{id:'pending',chatId:'group:1',senderId:'42',segments:[{type:'text',text:'new pending'}]});
  f.store.db.prepare('INSERT INTO incoming_jobs VALUES(?,?,?,?,?,?,?,?,?)').run('p','group:1','pending','{}','queued',0,null,new Date().toISOString(),new Date().toISOString());
  const bot=f.store.putMessage('p',{id:'bot-reply',chatId:'group:1',senderId:'999',direction:'out',segments:[{type:'text',text:'reply'}]});f.runtime.conversation.linkResponse('p',contextEvent(pending),bot.id,topic.id);
  const gate=f.block(),work=f.runtime.conversation.compact('p',topic.id,true,'manual');await gate.entered;
  f.add('later','42');gate.release();assert.equal((await work).applied,true);
  const state=f.runtime.conversation.inspect('p');assert.ok(Number(state.topics[0].cursor)<pending.sequence);
  f.runtime.conversation.track('p',contextEvent(pending));const plan=await f.runtime.conversation.plan('p',contextEvent(pending),f.store.listMessages('p',{chatId:'group:1',limit:100}).map(contextEvent));assert.ok(plan.messages.some(e=>e.sourceId==='pending'));assert.ok(!plan.messages.some(e=>e.sourceId==='later'));
});
test('invalid compression sources leave cursor and raw conversation untouched',async t=>{
  const f=await fixture(t);let topic:any;for(let i=0;i<15;i++)topic=f.add('m'+i).topic;f.setMode('invalid');
  assert.equal((await f.runtime.conversation.compact('p',topic.id,true,'manual')).failed,true);
  const state=f.runtime.conversation.inspect('p');assert.equal(state.topics[0].cursor,0);assert.equal(state.compressions[0].state,'failed');assert.equal(f.store.listMessages('p',{chatId:'group:1',limit:100}).length,15);
});
