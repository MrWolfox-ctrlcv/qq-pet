// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PetStore } from '../src/store.ts';
import { SemanticIndex } from '../src/semantic.ts';

function fixture(){const dir=mkdtempSync(path.join(os.tmpdir(),'pet-semantic-'));const store=new PetStore(dir);store.createPet({id:'pet-a',name:'A'});store.createPet({id:'pet-b',name:'B'});return {dir,store}}

test('local vectors persist per pet/entity, reuse unchanged text and invalidate edits',async t=>{
  const {dir,store}=fixture();t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});let calls=0;const embed=async(text:string)=>{calls++;return text==='query'?[1,0]:text.includes('relevant')?[0.9,0.1]:[0,1]};
  const index=new SemanticIndex(store,{embed,minSimilarity:0.7});const rows=[{id:'same-id',text:'relevant item',title:'kept'}, {id:'irrelevant',text:'unrelated'}];
  let rank=await index.rank('pet-a','memory','query',rows);assert.deepEqual(rank.map(x=>x.id),['same-id']);assert.equal(rank[0].title,'kept');assert.equal(rank[0].matchMode,'vector');assert.equal(calls,3);
  await index.rank('pet-a','memory','query',rows);assert.equal(calls,4); // query only: both stored document vectors were reused
  await index.rank('pet-a','memory','query',[{...rows[0],text:'edited relevant'}]);assert.equal(calls,6); // query plus invalidated edited row
  await index.rank('pet-b','memory','query',[rows[0]]);assert.equal(calls,8); // same entity ID in another pet gets its own vector
  assert.equal((store.db.prepare('SELECT COUNT(*) n FROM semantic_vectors').get() as any).n,3);
  assert.equal(index.status().remoteModelDownloads,false);assert.equal(index.status().apiCalls,false);
});

test('missing local weights uses honest lexical Chinese fallback and drops irrelevant candidates',async t=>{
  const {dir,store}=fixture();t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});let calls=0;const index=new SemanticIndex(store,{modelDir:path.join(dir,'no-model'),embed:async()=>{calls++;throw new Error('unexpected embed')}});
  const result=await index.rank('pet-a','asset','猫咪喜欢吃鱼',[{id:'fish',text:'猫咪很喜欢吃鱼'}, {id:'weather',text:'明天要下雨'}]);
  assert.deepEqual(result.map(x=>x.id),['fish']);assert.equal(result[0].matchMode,'lexical');assert.equal(index.status().mode,'lexical-fallback');assert.match(index.status().reason??'',/unexpected embed/);assert.equal(calls,1);
});

test('no model directory means no lazy transformer import or remote download',async t=>{
  const {dir,store}=fixture();t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});const index=new SemanticIndex(store,{modelDir:path.join(dir,'absent')});
  const result=await index.rank('pet-a','message','今天吃饭吗',[{id:'1',text:'今天一起吃饭吗'}]);assert.equal(result[0]?.matchMode,'lexical');assert.equal(index.status().remoteModelDownloads,false);assert.match(index.status().reason??'',/not installed/);
});
