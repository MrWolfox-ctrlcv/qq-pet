// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {PetStore} from '../src/store.ts';
import {PrivateConfig} from '../src/private-config.ts';
import {MediaTools} from '../src/media.ts';

test('detailed reading requests original and uses image crops without reusing preview cache',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'pet-original-')),store=new PetStore(dir);store.createPet({id:'p',name:'猫'});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});
  mkdirSync(path.join(dir,'provider'));const file=path.join(dir,'provider','test.png');writeFileSync(file,await sharp({create:{width:1800,height:1600,channels:3,background:'#abcdef'}}).png().toBuffer());
  const calls:any[]=[],actions:any[]=[],models:any={call:async(_p:any,_c:any,msg:any)=>{calls.push(msg);return {text:'可见文字与坐标',usage:{}}}};
  const media=new MediaTools(store,models,new PrivateConfig(dir)),transport={readAction:async(_action:string,params:any)=>{actions.push(params);return {file}}},source={chatId:'group:1',senderId:'2',messageId:'m'};
  await media.analyzeIncomingMedia('p',{type:'image',file:'native-image:m:e'},source,transport);
  await media.analyzeIncomingMedia('p',{type:'image',file:'native-image:m:e'},source,transport,{detail:true,question:'读出坐标'});
  assert.equal(actions[0].full_size,false);assert.equal(actions[1].full_size,true);assert.equal(calls.length,2);
  const images=calls[1][0].content.filter((p:any)=>p.type==='image_url');assert.equal(images.length,5);assert.equal(images[0].image_url.detail,'high');
  const original=Buffer.from(images[0].image_url.url.split(',')[1],'base64');assert.equal((await sharp(original).metadata()).width,1800);
});
