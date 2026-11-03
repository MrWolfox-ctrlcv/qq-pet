// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {PetStore} from '../src/store.ts';
import {MediaTools} from '../src/media.ts';

const require=createRequire(import.meta.url);
function fixture(t:any){
  const base=path.resolve('.test-data');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'media-'));
  const store=new PetStore(root);store.createPet({id:'p',name:'原生媒体测试',accountId:'1'});
  t.after(()=>{store.close();assert.ok(root.startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  return {root,store};
}

test('real FFmpeg video sampling produces four decodable JPEGs and WAV bytes', {skip:process.platform!=='win32'},async t=>{
  const {root,store}=fixture(t);const exe=path.join(path.dirname(require.resolve('@ffmpeg-installer/win32-x64/package.json')),'ffmpeg.exe');
  const video=path.join(root,'clip.mp4');execFileSync(exe,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest','-y',video],{windowsHide:true,timeout:30000});
  const bytes=fs.readFileSync(video),originalFetch=globalThis.fetch;let frames=0,wavBytes=0;
  globalThis.fetch=(async()=>new Response(bytes,{headers:{'content-type':'video/mp4'}})) as typeof fetch;t.after(()=>{globalThis.fetch=originalFetch;});
  const models:any={call:async(_id:string,_cfg:any,messages:any[])=>{
    const content=messages[0].content;
    for(const segment of content)if(segment.type==='image_url'){const data=Buffer.from(segment.image_url.url.split(',')[1],'base64');const meta=await sharp(data).metadata();assert.ok(meta.width&&meta.height);frames++;}
    const audio=content.find((s:any)=>s.type==='input_audio');assert.ok(audio);const wave=Buffer.from(audio.input_audio.data,'base64');assert.equal(wave.toString('ascii',0,4),'RIFF');wavBytes=wave.length;
    return {text:'蓝色画面和音调',usage:{}};
  }};
  const tools=new MediaTools(store,models,{get:()=>({model:{visionModel:'test'}})} as any);
  const result=await tools.analyzeIncomingMedia('p',{type:'video',url:'https://multimedia.nt.qq.com.cn/clip.mp4'},{chatId:'group:10',senderId:'2',messageId:'v1'},{readAction:async()=>({})});
  assert.equal(frames,4);assert.ok(wavBytes>100);assert.equal(result.provenance.senderId,'2');assert.deepEqual(fs.readdirSync(path.join(root,'media-work')),[]);
});

test('provider-resolved local voice paths are limited to the private provider directory',async t=>{
  const {root,store}=fixture(t);const provider=path.join(root,'provider','pet_a');fs.mkdirSync(provider,{recursive:true});const file=path.join(provider,'voice.wav');const wave=Buffer.alloc(64);wave.write('RIFF');wave.write('WAVE',8);fs.writeFileSync(file,wave);
  let calls=0;const models:any={call:async()=>{calls++;return {text:'测试语音',usage:{}}}};
  const tools=new MediaTools(store,models,{get:()=>({model:{visionModel:'test'}})} as any);
  const input={type:'audio',file:'provider-reference'};const source={chatId:'group:10',senderId:'2',messageId:'a1'};
  const result=await tools.analyzeIncomingMedia('p',input,source,{readAction:async()=>({file})});assert.equal(result.description,'测试语音');assert.equal(calls,1);
  const outside=path.join(root,'private-config.txt');fs.writeFileSync(outside,'not audio');
  await assert.rejects(()=>tools.analyzeIncomingMedia('p',input,{...source,messageId:'a2'},{readAction:async()=>({file:outside})}),/outside/);assert.equal(calls,1);
});
