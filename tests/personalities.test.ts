// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import sharp from 'sharp';import {WebSocketServer,WebSocket} from 'ws';
import {PetStore} from '../src/store.ts';import {PrivateConfig} from '../src/private-config.ts';import {Runtime} from '../src/runtime.ts';
const sleep=(ms=10)=>new Promise(r=>setTimeout(r,ms));async function until(fn:()=>boolean){for(let i=0;i<250;i++){if(fn())return;await sleep()}throw Error('Timed out')}
async function fixture(t:any,handler?:(pet:string)=>Promise<string>){
 const dir=mkdtempSync(path.join(os.tmpdir(),'pet-personalities-')),store=new PetStore(dir),config=new PrivateConfig(dir),server=new WebSocketServer({port:0});await new Promise<void>(r=>server.once('listening',r));const port=(server.address() as any).port,clients=new Set<WebSocket>(),sent:any[]=[],calls:string[]=[],inputs:any[]=[];let connections=0;
 for(const id of ['a','b']){store.createPet({id,name:id==='a'?'白昼':'夜晚',accountId:'999',prompts:{persona:'只使用当前人格的资料。'},settings:{masterId:'42',toolsEnabled:true}});config.set(id,{connection:{enabled:true,live:true,wsUrl:'ws://127.0.0.1:'+port},model:{apiKey:'fake',baseUrl:'https://model.invalid',chatModel:'fake'}});}
 server.on('connection',ws=>{connections++;clients.add(ws);ws.on('close',()=>clients.delete(ws));ws.on('message',buf=>{const r=JSON.parse(String(buf));const data=r.action==='get_login_info'?{user_id:'999'}:r.action==='get_status'?{online:true,good:true}:r.action==='send_msg'?(sent.push(r.params),{message_id:'out-'+sent.length}):{};ws.send(JSON.stringify({echo:r.echo,status:'ok',retcode:0,data}));});});
 const models:any={usage:()=>({calls:calls.length}),call:async(p:string,_c:any,m:any[])=>{calls.push(p);inputs.push(m);return {text:handler?await handler(p):p+' reply',usage:{calls:1,promptTokens:100,completionTokens:10,cachedTokens:null}}}};
 const runtime=new Runtime(store,config,models);await runtime.refresh('a');await runtime.refresh('b');await until(()=>runtime.status('a').account.state==='online');
 const emit=(id:string,text:string,uid='42')=>{for(const ws of clients)ws.send(JSON.stringify({post_type:'message',self_id:'999',message_type:'private',user_id:uid,message_id:id,time:Math.floor(Date.now()/1000),message:[{type:'text',data:{text}}]}));};
 t.after(async()=>{await runtime.stop();await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(dir,{recursive:true,force:true})});return {store,config,runtime,emit,sent,calls,inputs,connections:()=>connections};
}
test('same QQ personalities reuse one connection and isolate memories, galleries, stickers, profiles and replayed messages',async t=>{
 const f=await fixture(t);f.store.createMemory('a',{text:'白昼独有的记忆',personId:'42',scope:'private:42',sourceMessageIds:[]});f.store.createPerson('a',{id:'42',displayName:'Owner',fields:{affinity:80}});
 const png=await sharp({create:{width:2,height:2,channels:3,background:'blue'}}).png().toBuffer();for(const kind of ['gallery','sticker']){const asset=await f.store.importAsset('a',{bytes:png,kind,scope:'private'});assert.throws(()=>f.store.getAsset('b',asset.id));}
 f.emit('first','白昼独有的记忆');await until(()=>f.sent.length===1);const result=await f.runtime.switchPersonality('b');assert.equal(result.activePetId,'b');assert.equal(f.connections(),1);assert.equal(f.runtime.status('a').worker.state,'inactive-personality');
 f.emit('first','白昼独有的记忆');f.emit('second','你好');await until(()=>f.sent.length===2);assert.deepEqual(f.calls,['a','b']);assert.equal(f.store.listMessages('b',{chatId:'private:42'}).some(r=>r.id==='first'),false);
 assert.equal(f.store.listMemories('b').length,0);assert.equal(f.store.listAssets('b').length,0);assert.equal(f.store.listPeople('b')[0].fields.affinity,10);assert.doesNotMatch(JSON.stringify(f.inputs[1]),/白昼独有的记忆/);
 f.emit('forbidden','#人格 白昼','77');await until(()=>f.store.listTraces('b').some(r=>r.triggerId==='forbidden'));assert.equal(f.runtime.personalities.active('b'),'b');assert.equal(f.sent.length,2);
 f.emit('switch-back','#人格 白昼');await until(()=>f.sent.length===3);assert.equal(f.runtime.personalities.active('b'),'a');assert.equal(f.connections(),1);assert.equal(f.store.listMemories('a').length,1);assert.equal(f.calls.length,2);
});
test('switching cancels the old personality reply and pending memory tool without executing them',async t=>{
 let release!:()=>void;const blocked=new Promise<void>(r=>release=r);const f=await fixture(t,async pet=>{if(pet==='a'){await blocked;return '[[MEMORY: {"op":"add","text":"stale mutation","sourceIds":["blocked"]}]]'}return 'new reply'});
 f.emit('blocked','你好');await until(()=>f.calls.length===1);await f.runtime.switchPersonality('b');release();await until(()=>f.runtime.status('a').queue.pending===0);f.emit('new','你好');await until(()=>f.sent.length===1);
 assert.equal(f.store.listMemories('a').length,0);assert.equal(f.store.listMemories('b').length,0);assert.match(JSON.stringify(f.sent[0]),/new reply/);assert.equal(f.connections(),1);
});
