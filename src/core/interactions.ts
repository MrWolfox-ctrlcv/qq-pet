// SPDX-License-Identifier: Apache-2.0
import type {NormalizedEvent} from './events.ts';
export function petInteraction(event:NormalizedEvent,selfId:string){
  if(!['group','private'].includes(event.chatType)||event.text.trim()!=='&')return undefined;
  const mentions=event.segments.filter(s=>s.type==='at').map((s:any)=>String(s.qq??s.data?.qq??''));
  if(mentions.some(id=>id!==selfId))return undefined;
  return {kind:'virtual-whip',symbol:'&',actorId:event.authorId,targetId:selfId,sourceMessageId:event.sourceId,fictional:true};
}
