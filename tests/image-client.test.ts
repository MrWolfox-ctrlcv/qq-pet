// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {generateAgnesImage} from '../src/image-client.ts';

test('Agnes uses image endpoint and reference payload, validates bytes and reports failures',async t=>{
  const png=await sharp({create:{width:10,height:10,channels:3,background:'#aabbcc'}}).png().toBuffer(),previous=globalThis.fetch;let request:any,record:any;
  t.after(()=>{globalThis.fetch=previous});
  globalThis.fetch=async(url,options)=>{assert.equal(String(url),'https://apihub.agnes-ai.com/v1/images/generations');request=JSON.parse(String(options?.body));return Response.json({data:[{b64_json:png.toString('base64')}]})};
  const out=await generateAgnesImage('p',{imageApiKey:'fake'},'猫',['data:image/png;base64,test'],{record:(_p:string,row:any)=>{record=row}} as any);
  assert.ok(out.equals(png));assert.equal(request.size,'1024x1024');assert.equal(request.extra_body.response_format,'b64_json');assert.equal(request.extra_body.image.length,1);assert.equal(record.referenceImages,1);
  globalThis.fetch=async()=>new Response('{}',{status:429});await assert.rejects(generateAgnesImage('p',{imageApiKey:'fake'},'猫',[],{} as any),/429/);
});
