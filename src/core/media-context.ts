// SPDX-License-Identifier: Apache-2.0
import type {NormalizedEvent} from './events.ts';

export function imageReadIntent(text:string){return /(?:描述|识别|分析|读出|读一下|看看|看清|看不清|讲一下|解释|写了什么|是什么|在哪|哪里|经纬|坐标|板书|黑板|内容|这张|这幅|这是什么)/.test(text)&&/(?:图|照片|截图|画面|经纬|坐标|板书|黑板|这张|这幅|这是什么)/.test(text);}
export function selectRecentImageReference(trigger:NormalizedEvent,history:readonly NormalizedEvent[]){
  if(!imageReadIntent(trigger.text)||trigger.segments.some(s=>s.type==='image'))return {state:'not-needed',event:undefined};
  const recent=history.filter(e=>e.chatId===trigger.chatId&&e.sequence<trigger.sequence&&e.messageType!=='out'&&e.time<=trigger.time&&trigger.time-e.time<=90000).sort((a,b)=>b.sequence-a.sequence).slice(0,12);
  const images=recent.filter(e=>e.segments.some(s=>s.type==='image'));
  if(!images.length)return {state:'not-found',event:undefined};
  // A person's immediately preceding image is a strong reference. A newer
  // picture from someone else makes it ambiguous; never silently substitute it.
  const latest=images[0];
  if(latest.authorId===trigger.authorId)return {state:'same-author-recent-image',event:latest};
  if(images.length===1)return {state:'single-recent-image',event:latest};
  return {state:'ambiguous',event:undefined};
}
