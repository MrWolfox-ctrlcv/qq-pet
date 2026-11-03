// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PetStore } from '../src/store.ts';
const temp=()=>mkdtempSync(path.join(os.tmpdir(),'petstore-'));
test('pet isolation, optimistic revisions, stable messages, persistence and locks',async()=>{
 const dir=temp();let s=new PetStore(dir);const a=s.createPet({id:'a',name:'A'}),b=s.createPet({id:'b',name:'B'});
 const m=s.createMemory(a.id,{text:'喜欢喝奶茶，尤其是珍珠奶茶',kind:'preference'});assert.equal(s.searchMemories(a.id,'珍珠奶茶').length,1);assert.equal(s.searchMemories(b.id,'珍珠奶茶').length,0);
 const updated=s.updateMemory(a.id,m.id,{text:'喜欢喝咖啡'},1);assert.equal(s.searchMemories(a.id,'奶茶').length,0);assert.equal(s.searchMemories(a.id,'咖啡').length,1);assert.equal(s.getRevisions(a.id,'memory',m.id).length,1);
 assert.throws(()=>s.updateMemory(a.id,m.id,{text:'bad'},1),(e:any)=>e.status===409);
 const p=s.createPerson(a.id,{id:'123',displayName:'One',fields:{nickname:'Tea'},lockedFields:['nickname']});s.updatePerson(a.id,p.id,{fields:{nickname:'Other'}},1,'model');assert.equal(s.listPeople(a.id)[0].fields.nickname,'Tea');
 const msg=s.putMessage(a.id,{id:'m1',chatId:'group',senderId:'x',segments:[]});assert.equal(s.putMessage(a.id,{id:'m1',chatId:'group',senderId:'x'}).sequence,msg.sequence);assert.equal(s.putMessage(a.id,{id:'m1',chatId:'other',senderId:'x'}).sequence,1);
 s.close();s=new PetStore(dir);assert.equal(s.listMessages(a.id,{chatId:'group'}).length,1);assert.equal(s.listPets().length,2);s.close();rmSync(dir,{recursive:true,force:true});
});
