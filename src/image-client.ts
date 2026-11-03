// SPDX-License-Identifier: Apache-2.0
import sharp from 'sharp';
import type {ModelConnection} from './private-config.ts';
import type {ModelClient} from './model.ts';

const MAX_BYTES=25*1024*1024;
export async function generateAgnesImage(petId:string,config:ModelConnection,prompt:string,references:string[],models:ModelClient,context:{chatId?:string}={}){
  if(!config.imageApiKey)throw new Error('请先配置 Agnes 生图密钥');
  const endpoint=new URL((config.imageBaseUrl||'https://apihub.agnes-ai.com').replace(/\/$/,'')+'/v1/images/generations');
  const started=Date.now(),signal=AbortSignal.timeout(180000);
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.imageApiKey},body:JSON.stringify({model:config.imageModel||'agnes-image-2.0-flash',prompt,size:'1024x1024',extra_body:{response_format:'b64_json',...(references.length?{image:references}:{})}}),signal});
  if(!response.ok)throw new Error(`Agnes 生图服务返回 ${response.status}，请检查密钥、额度或服务状态`);
  const raw=await response.json() as any;
  const item=raw.data?.[0];let bytes:Buffer;
  if(typeof item?.b64_json==='string'){
    if(item.b64_json.length>Math.ceil(MAX_BYTES*4/3)+100)throw new Error('生图返回文件过大');
    bytes=Buffer.from(item.b64_json.replace(/^data:image\/[^;]+;base64,/,''),'base64');
  }else if(typeof item?.url==='string'){
    // Download only the provider's known output storage, with no credentials or
    // redirects to arbitrary addresses. Never attach the API key to storage.
    const url=new URL(item.url);
    if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!(url.hostname==='storage.googleapis.com'&&url.pathname.startsWith('/agnes-aigc/')))throw new Error('Agnes 返回了未识别的图片存储地址');
    const download=await fetch(url,{signal,redirect:'error'});
    if(!download.ok||!download.body)throw new Error('Agnes 图片下载失败');
    const chunks:Buffer[]=[];let size=0;
    const reader=download.body.getReader();
    try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw new Error('生图返回文件过大');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
    bytes=Buffer.concat(chunks);
  }else throw new Error('Agnes 未返回生成图片');
  if(!bytes.length||bytes.length>MAX_BYTES)throw new Error('生图文件为空或过大');
  await sharp(bytes,{limitInputPixels:40_000_000}).stats();
  models.record(petId,{...context,kind:'drawing',model:config.imageModel||'agnes-image-2.0-flash',provider:'agnes',elapsedMs:Date.now()-started,promptTokens:null,completionTokens:null,totalTokens:null,cachedTokens:null,usageSource:'not-reported',images:1,referenceImages:references.length});
  return bytes;
}
