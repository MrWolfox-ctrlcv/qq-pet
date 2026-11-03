// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {PetStore} from '../src/store.ts';import {MemoryTools} from '../src/memory-tools.ts';
test('model memory tools merge and correct identities with revisions, preserve locks and reject private or fabricated sources',t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'pet-memory-')),store=new PetStore(dir),tools=new MemoryTools(store);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});
 store.createPet({id:'p',name:'Pet',settings:{toolsEnabled:true,masterId:'42'}});
 for(const id of ['42','77'])store.putMessage('p',{id:'m'+id,chatId:'group:1',senderId:id,segments:[{type:'text',text:id==='77'?'大家叫我星':'你好'}]});
 const ctx={chatId:'group:1',uid:'42',messageId:'m42',sequence:2};
 const a=store.createMemory('p',{text:'昵称是星',personId:'42',scope:'person',sourceMessageIds:[]}),b=store.createMemory('p',{text:'平时被叫做星',personId:'77',scope:'person',sourceMessageIds:[]});
 const merged=tools.execute('p',{op:'merge',id:a.id,version:1,merge:[{id:b.id,version:1}],personId:'77',text:'77的别名是星',kind:'fact',sourceIds:['m77']},ctx);
 assert.equal(merged.memory.personId,'77');assert.equal(store.getMemory('p',b.id).hidden,true);assert.equal(store.getRevisions('p','memory',a.id).length,1);
 assert.throws(()=>tools.execute('p',{op:'update',id:a.id,version:1,text:'stale'},ctx),/版本/);
 tools.execute('p',{op:'restore',id:b.id,version:2},ctx);assert.equal(store.getMemory('p',b.id).hidden,false);
 const locked=store.createMemory('p',{text:'locked',scope:'group:1',locked:true,sourceMessageIds:[]});assert.throws(()=>tools.execute('p',{op:'forget',id:locked.id,version:1},ctx),/锁定/);
 const secret=store.createMemory('p',{text:'private secret',personId:'42',scope:'private',sourceMessageIds:['private:42#secret']});assert.throws(()=>tools.execute('p',{op:'get',id:secret.id},ctx),/范围/);
 assert.throws(()=>tools.execute('p',{op:'add',text:'made up',sourceIds:['missing']},ctx),/来源消息/);
 const p=tools.execute('p',{op:'profile',personId:'77'},ctx).person;tools.execute('p',{op:'profile',personId:'77',version:p.version,sourceIds:['m77'],patch:{aliases:['星'],affinityDelta:2}},ctx);assert.equal(store.listPeople('p')[0].fields.affinity,12);
 store.updatePet('p',{settings:{toolPermissions:{memory:false}}},store.getPet('p').version);assert.throws(()=>tools.execute('p',{op:'search'},ctx),/关闭/);
});
