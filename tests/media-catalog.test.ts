// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {PetStore} from '../src/store.ts';
import {MediaTools} from '../src/media.ts';
import {PrivateConfig} from '../src/private-config.ts';
import {MediaCatalog} from '../src/media-catalog.ts';
import {EventSequencer} from '../src/core/events.ts';

test('catalog collects an explicit reply with original author, stable number, duplicate reuse and reversible edits',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pet-catalog-'));let store=new PetStore(dir);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true})});
  store.createPet({id:'p',name:'pet',settings:{masterId:'42',toolsEnabled:true}});
  const bytes=await sharp({create:{width:9,height:7,channels:3,background:'#778899'}}).png().toBuffer();
  const oldFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(bytes);t.after(()=>{globalThis.fetch=oldFetch});let calls=0;
  const media=new MediaTools(store,{call:async()=>{calls++;return {text:'A blue square.',usage:{}}}} as any,new PrivateConfig(dir));
  const catalog=new MediaCatalog(store,media),seq=new EventSequencer(),transport={readAction:async()=>({})};
  const image=seq.next({message_id:'image',group_id:8,user_id:11,message:[{type:'image',data:{url:'https://a.qpic.cn/sample.png'}}]});
  store.putMessage('p',{id:image.sourceId,chatId:image.chatId,senderId:image.authorId,segments:image.segments});
  const e=seq.next({message_id:'request',group_id:8,user_id:42,message:[{type:'reply',data:{id:'image'}},{type:'text',data:{text:'把这张图收成表情包'}}]});
  const added=await catalog.execute('p',{op:'add',kind:'sticker',source:'reply',title:'蓝色方块',tags:['蓝色']},e,transport);
  assert.ok(added.source);assert.ok(added.asset);
  assert.equal(added.source.senderId,'11');assert.equal(added.source.messageId,'image');assert.match(added.asset.key,/^表\d+$/);assert.equal(added.asset.scope,'group:8');
  const duplicated=await catalog.execute('p',{op:'add',kind:'sticker',source:'reply'},e,transport);assert.equal(duplicated.alreadyExists,true);assert.equal(calls,1);
  await catalog.execute('p',{op:'update',id:added.asset.key,patch:{title:'新名称',tags:['方块']}},e,transport);
  const hidden=await catalog.execute('p',{op:'delete',id:added.asset.key},e,transport);assert.ok(hidden.asset);assert.equal(hidden.asset.hidden,true);
  const restored=await catalog.execute('p',{op:'restore',id:added.asset.key},e,transport);assert.ok(restored.asset);assert.equal(restored.asset.hidden,false);assert.equal(restored.asset.title,'新名称');assert.deepEqual(restored.asset.tags,['方块']);
  await assert.rejects(catalog.execute('p',{op:'get',id:'图'+added.asset.number},e,transport),/不存在/);
  await assert.rejects(catalog.execute('p',{op:'add',sourceMessageId:'unrelated-chat'},e,transport),/只能收录/);
  const row=store.getPet('p');store.updatePet('p',{settings:{toolsEnabled:false}},row.version);
  await assert.rejects(catalog.execute('p',{op:'delete',id:added.asset.id},e,transport),/尚未开放/);
  assert.equal(store.getAsset('p',added.asset.id).hidden,false);
  store.close();store=new PetStore(dir);assert.equal(store.getAsset('p',added.asset.id).number,added.asset.number);
});

test('non-owner cannot edit admin assets or read another private scope',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pet-catalog-'));const store=new PetStore(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true})});
  store.createPet({id:'p',name:'pet',settings:{masterId:'42',toolsEnabled:true}});
  const bytes=await sharp({create:{width:4,height:4,channels:3,background:'#ff0000'}}).png().toBuffer();
  const publicAsset=await store.importAsset('p',{bytes,kind:'gallery',scope:'public'});
  const privateAsset=await store.importAsset('p',{bytes,kind:'gallery',scope:'private:42'});
  const media=new MediaTools(store,{} as any,new PrivateConfig(dir)),catalog=new MediaCatalog(store,media);
  const e=new EventSequencer().next({message_id:'e',group_id:8,user_id:99,message:'删除那张图'}),transport={readAction:async()=>({})};
  await assert.rejects(catalog.execute('p',{op:'delete',id:publicAsset.id},e,transport),/由主人管理/);
  await assert.rejects(catalog.execute('p',{op:'get',id:privateAsset.id},e,transport),/不存在/);
});
