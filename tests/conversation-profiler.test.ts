// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PetStore} from '../src/store.ts';
import {PrivateConfig} from '../src/private-config.ts';
import {Runtime} from '../src/runtime.ts';
import {ModelClient} from '../src/model.ts';

test('stage summary records same-author evidence, respects locks and advances once',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'pet-summary-')),store=new PetStore(dir),config=new PrivateConfig(dir);
  store.createPet({id:'p',name:'猫',accountId:'999',settings:{profileSummaryEnabled:true,profileSummaryMessageCount:8}});
  store.createPerson('p',{id:'123',fields:{profile:'人工锁定',affinity:10},lockedFields:['profile']});
  config.set('p',{connection:{live:true},model:{apiKey:'fake',baseUrl:'https://model.invalid'}});
  let calls=0;
  const model={usage:()=>({}),call:async()=>{calls++;return {text:JSON.stringify({summary:'讨论猫与绘画',people:[{qq:'123',profile:'应被锁定',impression:'喜欢分享',affinityDelta:80,evidenceIds:['m0'],facts:[{text:'喜欢猫',quote:'我喜欢猫',evidenceIds:['m0'],confidence:.95},{text:'冒名事实',quote:'我喜欢猫',evidenceIds:['m1'],confidence:.95}]},{qq:'456',profile:'错误归属',evidenceIds:['m0']}]}),usage:{calls:1}}}} as unknown as ModelClient;
  const runtime=new Runtime(store,config,model);t.after(async()=>{await runtime.stop();store.close();rmSync(dir,{recursive:true,force:true})});
  for(let i=0;i<8;i++){
    const sender=i%2?'456':'123',m=store.putMessage('p',{id:'m'+i,chatId:'group:1',senderId:sender,segments:[{type:'text',text:i===0?'我喜欢猫':'今天聊绘画'}]});
    store.db.prepare('INSERT INTO incoming_jobs VALUES(?,?,?,?,?,?,?,?,?)').run('p','group:1',m.id,'{}','done',1,null,new Date().toISOString(),new Date().toISOString());
  }
  const result=await runtime.profiler.run('p','group:1');assert.equal(result.summary,'讨论猫与绘画');
  const person=store.listPeople('p').find(p=>p.id==='123')!;assert.equal(person.fields.profile,'人工锁定');assert.equal(person.fields.affinity,13);assert.equal(store.listPeople('p').length,1);
  assert.equal(store.listMemories('p').length,1);assert.equal(store.listMemories('p')[0].personId,'123');assert.deepEqual(store.listMemories('p')[0].sourceMessageIds,['group:1#m0']);
  assert.equal(runtime.profiler.list('p')[0].sources.length,8);assert.equal((await runtime.profiler.run('p','group:1')).skipped,'not-yet-due');assert.equal(calls,1);
});
