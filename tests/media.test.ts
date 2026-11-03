// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { PetStore } from '../src/store.ts';
import { PrivateConfig } from '../src/private-config.ts';
import { MediaTools } from '../src/media.ts';

test('media search enforces pet/chat visibility, hidden and relevance; preview validates IDs',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'pet-media-'));const store=new PetStore(dir);const pet=store.createPet({id:'p1',name:'Pet',settings:{masterId:'owner'}});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});
  const bytes=await sharp({create:{width:32,height:24,channels:3,background:'#ff0000'}}).png().toBuffer();
  const pub=await store.importAsset('p1',{bytes,kind:'sticker',title:'red cat',tags:['猫','cute'],description:'happy red cat',scope:'public'});
  const privateA=await store.importAsset('p1',{bytes:await sharp({create:{width:33,height:24,channels:3,background:'#0000ff'}}).png().toBuffer(),kind:'sticker',title:'private blue',tags:['blue'],description:'blue cat',scope:'group:alpha'});
  const hidden=await store.importAsset('p1',{bytes:await sharp({create:{width:34,height:24,channels:3,background:'#ffff00'}}).png().toBuffer(),kind:'sticker',title:'hidden red cat',tags:['red'],description:'red cat',scope:'public'});store.updateAsset('p1',hidden.id,{hidden:true},hidden.version);
  const config=new PrivateConfig(dir);const model:any={call:async()=>({text:JSON.stringify({id:pub.id}),usage:{calls:1},raw:{}})};
  const media=new MediaTools(store,model,config);
  assert.deepEqual(media.search('p1','sticker','red cat','group:beta','visitor').map((a:any)=>a.id),[pub.id]);
  assert.deepEqual(media.search('p1','sticker','blue','group:beta','visitor'),[]);
  assert.equal(media.search('p1','sticker','blue','group:alpha','visitor')[0].id,privateA.id);
  assert.equal(media.search('p1','sticker','blue','group:beta','owner')[0].id,privateA.id);
  assert.deepEqual(media.search('p1','sticker','unrelated query','group:alpha','owner'),[]);
  await assert.rejects(media.preview('p1',['missing'],{chatId:'group:beta',uid:'visitor'}),/unavailable/);
  const picked=await media.preview('p1',[pub.id],{chatId:'group:beta',uid:'visitor'});
  assert.equal(picked.id,pub.id);assert.ok(Buffer.isBuffer(picked.preview));assert.ok(picked.preview.length>0);
  assert.ok((await media.originalBytes('p1',pub.id,{chatId:'group:beta',uid:'visitor'})).equals(bytes));
  await assert.rejects(media.originalBytes('p1',privateA.id,{chatId:'group:beta',uid:'visitor'}),/unavailable/);
});

test('preview rejects model IDs outside the actual candidate set',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'pet-media-'));const store=new PetStore(dir);const pet=store.createPet({id:'p1',name:'Pet'});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});
  const bytes=await sharp({create:{width:4,height:4,channels:3,background:'#00ff00'}}).png().toBuffer();const a=await store.importAsset(pet.id,{bytes,kind:'sticker',scope:'public'});
  const model:any={call:async()=>({text:'{"id":"forged"}',usage:{}})};const media=new MediaTools(store,model,new PrivateConfig(dir));
  await assert.rejects(media.preview('p1',[a.id],{chatId:'group:x',uid:'someone'}),/outside/);
});

test('draw sends references to image API and persists generated image before returning',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'pet-media-'));const store=new PetStore(dir);const pet=store.createPet({id:'p1',name:'Pet'});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});
  const reference=await store.importAsset(pet.id,{bytes:await sharp({create:{width:8,height:8,channels:3,background:'#ff00ff'}}).png().toBuffer(),kind:'gallery',scope:'public'});
  const generated=await sharp({create:{width:10,height:10,channels:3,background:'#00ffff'}}).png().toBuffer();const config=new PrivateConfig(dir);config.set(pet.id,{model:{apiKey:'local-test-key',baseUrl:'https://model.invalid/v1',chatModel:'chat',imageModel:'test-image'}});
  let called=false;const media=new MediaTools(store,{call:async(_p:string,_c:any,m:any[])=>{called=true;assert.ok(Array.isArray(m[0].content));assert.ok(m[0].content.some((v:any)=>v.type==='image_url'));return {text:'',usage:{calls:1},raw:{choices:[{message:{images:[{image_url:{url:`data:image/png;base64,${generated.toString('base64')}`}}]}}]}}}} as any,config);
  const out=await media.draw(pet.id,'Draw a bright flower',[reference.id],'group:abc','u1');
  assert.equal(called,true);assert.equal(out.asset.category,'drawing');assert.deepEqual(out.referenceIds,[reference.id]);assert.equal(out.prompt,'Draw a bright flower');assert.ok(out.bytes.equals(generated));assert.match(out.asset.description, new RegExp(reference.id));
  assert.equal(store.getAsset(pet.id,out.asset.id).id,out.asset.id);
});

test('incoming image analysis restricts hosts and reuses content hash results',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'pet-media-'));const store=new PetStore(dir);const pet=store.createPet({id:'p1',name:'Pet'});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});
  const png=await sharp({create:{width:6,height:6,channels:3,background:'#abcdef'}}).png().toBuffer();const oldFetch=globalThis.fetch;let downloads=0;globalThis.fetch=async()=>{downloads++;return new Response(png,{status:200,headers:{'content-type':'image/png'}})};t.after(()=>{globalThis.fetch=oldFetch});let modelCalls=0;
  const media=new MediaTools(store,{call:async()=>{modelCalls++;return {text:'a small image',usage:{}}}} as any,new PrivateConfig(dir));
  await assert.rejects(media.analyzeIncomingImage(pet.id,'https://example.org/image.png'),/host is not allowed/);
  const first=await media.analyzeIncomingImage(pet.id,'https://a.qpic.cn/image.png');const second=await media.analyzeIncomingImage(pet.id,'https://a.qpic.cn/other-name.png');
  assert.equal(first.description,'a small image');assert.equal(first.cached,false);assert.equal(second.cached,true);assert.equal(downloads,2);assert.equal(modelCalls,1);
});

test('gallery preview returns only authorized candidate IDs and visual description',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'pet-media-'));const store=new PetStore(dir);const pet=store.createPet({id:'p1',name:'Pet'});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});
  const bytes=await sharp({create:{width:5,height:5,channels:3,background:'#112233'}}).png().toBuffer();const asset=await store.importAsset(pet.id,{bytes,kind:'gallery',title:'海边猫咪',scope:'public'});let gotText='';
    const media=new MediaTools(store,{call:async(_p:string,_c:any,m:any[])=>{gotText=m[0].content[0].text;return {text:'```json\n'+JSON.stringify({description:'海边的一只猫',ids:[asset.id]})+'\n```',usage:{calls:1}}}} as any,new PrivateConfig(dir));
  const result=await media.previewGallery(pet.id,[asset.id],{chatId:'group:x',uid:'u',text:'给群里看看这只猫'});assert.deepEqual(result.ids,[asset.id]);assert.equal(result.description,'海边的一只猫');assert.match(gotText,/给群里看看这只猫/);
});

test('incoming voice uses provider WAV and durable hash cache with source provenance',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'pet-media-'));const store=new PetStore(dir);const pet=store.createPet({id:'p1',name:'Pet'});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});
  const oldFetch=globalThis.fetch;const audio=Buffer.from('RIFF-audio-sample');globalThis.fetch=async()=>new Response(audio,{status:200});t.after(()=>{globalThis.fetch=oldFetch});let prompts:any[]=[];const model:any={call:async(_p:string,_c:any,m:any[])=>{prompts.push(m);return {text:'你好，今天有空吗？',usage:{calls:1}}}};const media=new MediaTools(store,model,new PrivateConfig(dir));let action:any;
  const transport={readAction:async(name:string,params:any)=>{action={name,params};return {url:'https://a.qpic.cn/voice.wav'}}};const source={chatId:'group:5',senderId:'42',messageId:'m7'};
  const one=await media.analyzeIncomingMedia(pet.id,{type:'audio',file:'provider-token'},source,transport);assert.equal(action.name,'get_record');assert.equal(action.params.out_format,'wav');assert.equal(one.description,'你好，今天有空吗？');assert.deepEqual(one.provenance,{...source,mediaType:'audio'});assert.equal(prompts[0][0].content[1].type,'input_audio');
  const again=await new MediaTools(store,model,new PrivateConfig(dir)).analyzeIncomingMedia(pet.id,{type:'audio',file:'provider-token'},source,transport);assert.equal(again.cached,true);assert.equal(prompts.length,1);
});

test('incoming video extracts at most four frames and 20 seconds of audio using bounded tools',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'pet-media-'));const store=new PetStore(dir);const pet=store.createPet({id:'p1',name:'Pet'});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});
  const oldFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(Buffer.from('video fixture'),{status:200});t.after(()=>{globalThis.fetch=oldFetch});const seen:string[][]=[];
  const command=async(_exe:string,args:string[])=>{seen.push(args);if(args.includes('format=duration'))return {stdout:'18.5\n',stderr:''};const dest=args.at(-1)!;if(dest.endsWith('.jpg'))writeFileSync(dest,Buffer.from('jpeg-frame'));else if(dest.endsWith('.wav'))writeFileSync(dest,Buffer.from('RIFF-audio'));return {stdout:'',stderr:''}};
  let sent:any;const media=new MediaTools(store,{call:async(_p:string,_c:any,m:any[])=>{sent=m[0].content;return {text:'A person speaks while showing a garden.',usage:{}}}} as any,new PrivateConfig(dir),{ffmpegPath:'ffmpeg-test',ffprobePath:'ffprobe-test',command});
  const result=await media.analyzeIncomingMedia(pet.id,{type:'video',file:'vid'}, {chatId:'private:2',senderId:'2',messageId:'m9'},{readAction:async()=>({url:'https://v.qq.com/video.mp4'})});
  assert.equal(seen.filter(a=>a.includes('-frames:v')).length,4);const audioCmd=seen.find(a=>a.includes('-f')&&a.includes('wav'))!;assert.ok(audioCmd.includes('20'));assert.equal(sent.filter((x:any)=>x.type==='image_url').length,4);assert.equal(sent.filter((x:any)=>x.type==='input_audio').length,1);assert.equal(result.description,'A person speaks while showing a garden.');
});
