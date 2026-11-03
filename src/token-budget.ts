// SPDX-License-Identifier: Apache-2.0
import sharp from 'sharp';
import type {ModelMessage} from './model.ts';

export const CONTEXT_HARD_LIMIT=60000;
export class ContextLimitError extends Error {constructor(){super('本轮必要资料超过上下文保护上限，请分段发送或明确要看的部分。');}}
// This is a local request protection measure, NEVER recorded as provider usage.
// Text uses UTF-8 bytes; image allowance is intentionally conservative. Exact
// preflight provider token counting is not integrated in this client.
export async function protectionBudget(messages:ModelMessage[]){
  let text=0,images=0;
  for(const message of messages){
    text+=24;
    if(typeof message.content==='string'){text+=Buffer.byteLength(message.content);continue;}
    if(!Array.isArray(message.content)){text+=Buffer.byteLength(JSON.stringify(message.content??''));continue;}
    for(const part of message.content){
      if(part.type==='image_url'){
        let width=1536,height=1536;const data=/^data:image\/[^;]+;base64,(.*)$/s.exec(part.image_url?.url||'');
        if(data)try{const meta=await sharp(Buffer.from(data[1],'base64'),{limitInputPixels:60_000_000}).metadata();width=meta.width||width;height=meta.height||height;}catch{}
        images+=Math.max(512,Math.ceil(width/768)*Math.ceil(height/768)*512);
      }else if(part.type==='input_audio'){images+=12000;}else text+=Buffer.byteLength(String(part.text??JSON.stringify(part)));
    }
  }
  return {text,media:images,total:text+images,source:'local-protection-not-actual-tokens' as const};
}
