// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {selectMediaCandidates} from '../src/media-search.ts';

const assets=[
  {id:'radish',number:12,title:'水彩插画，一只白萝卜',tags:['AI绘图'],description:'一只白萝卜',category:'drawing',createdAt:'2026-01-02'},
  {id:'eggs',number:13,title:'一盒鸡蛋',tags:['AI绘图'],description:'13个鸡蛋',category:'drawing',createdAt:'2026-01-03'},
  {id:'persona',number:14,title:'角色设定',tags:[],description:'猫耳角色',category:'persona',createdAt:'2026-01-01'},
];
test('literal image subject is retained even when embedding search rejects it',async()=>{
  let calls=0;const result=await selectMediaCandidates(assets,'gallery','萝卜',async()=>{calls++;return []});assert.deepEqual(result.map(a=>a.id),['radish']);assert.equal(calls,0);
});
test('catalog keys, browsing and persona aliases select visible actual candidates',async()=>{
  const rank=async()=>[];assert.equal((await selectMediaCandidates(assets,'gallery','图12',rank))[0].id,'radish');assert.equal((await selectMediaCandidates(assets,'gallery','随便',rank))[0].id,'eggs');assert.equal((await selectMediaCandidates(assets,'gallery','猫娘',rank))[0].id,'persona');assert.equal((await selectMediaCandidates(assets,'gallery','表12',rank)).length,0);assert.equal((await selectMediaCandidates(assets.slice(1),'gallery','图12',rank)).length,0);
});
