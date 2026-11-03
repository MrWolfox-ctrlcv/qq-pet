// SPDX-License-Identifier: Apache-2.0
import type {NormalizedEvent} from './events.ts';

export function imageReadIntent(text:string){
  const t=text.trim();
  return /^(?:请|帮我|给我)?(?:讲解|讲讲|解释|描述|分析)(?:一下|下|这个|这张|这幅)?[?？。！!\s]*$/.test(t)||/(?:描述|识别|分析|读出|读一下|讲解|讲讲|解释|看看|看一下|看下|看不清|看不到|能看|看清|写了什么|是什么|在哪|哪里|怎么读|什么内容)/.test(t)&&/(?:图|照片|截图|画面|经纬|坐标|板书|黑板|这张|这幅|这是什么)/.test(t);
}
export function selectRecentImageReference(trigger:NormalizedEvent,history:readonly NormalizedEvent[],selfId?:string){
  if(trigger.segments.some(s=>s.type==='image'))return {state:'not-needed',event:undefined};
  const recent=history.filter(e=>e.chatId===trigger.chatId&&e.sequence<trigger.sequence&&e.messageType!=='out'&&e.time<=trigger.time&&trigger.time-e.time<=300000).sort((a,b)=>b.sequence-a.sequence).slice(0,30);
  const mentions=trigger.segments.filter(s=>s.type==='at').map((s:any)=>String(s.qq??s.data?.qq??''));
  const addressed=trigger.chatType==='private'||!!selfId&&mentions.includes(selfId);
  const own=recent.filter(e=>e.authorId===trigger.authorId),lastOwn=own[0];
  const nextToOwnImage=lastOwn?.segments.some(s=>s.type==='image')&&trigger.time-lastOwn.time<=90000;
  const elliptical=/^(?:再(?:讲|说|解释|详细)|继续|没(?:懂|看懂|明白)|为什么|然后|这个呢|那个呢)/.test(trigger.text.trim())&&lastOwn&&imageReadIntent(lastOwn.text);
  if(!imageReadIntent(trigger.text)&&!(addressed&&nextToOwnImage)&&!elliptical)return {state:'not-needed',event:undefined};
  const images=recent.filter(e=>e.segments.some(s=>s.type==='image'));
  if(!images.length)return {state:'not-found',event:undefined};
  // A person's immediately preceding image is a strong reference. A newer
  // picture from someone else makes it ambiguous; never silently substitute it.
  const latest=images[0];
  if(latest.authorId===trigger.authorId)return {state:nextToOwnImage?'same-author-followup-image':'same-author-recent-image',event:latest};
  if(images.length===1)return {state:'single-recent-image',event:latest};
  return {state:'ambiguous',event:undefined};
}
