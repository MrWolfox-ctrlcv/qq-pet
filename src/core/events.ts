// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';

export type Segment = { type: 'text'; text: string } | { type: 'image' | 'audio' | 'video' | 'file'; url?: string; file?: string; fileId?: string; mimeType?: string; size?: number; metadata?: Record<string, unknown> } | { type: string; [key: string]: unknown };
export interface NormalizedEvent {
  id: string; sourceId: string; accountId?: string; chatId: string; chatType: 'private' | 'group' | 'unknown';
  authorId: string; authorName?: string; selfId?: string; time: number; sequence: number; messageType: string;
  text: string; segments: Segment[]; replyTo?: string; raw?: unknown;
}
export function stableEventId(chatId: string, sourceId: string): string {
  return createHash('sha256').update(`${chatId}\0${sourceId}`).digest('hex');
}
export class EventSequencer {
  #sequence = 0;
  next(raw: any, accountId?: string): NormalizedEvent {
    const chatId = raw.group_id != null ? `group:${raw.group_id}` : raw.user_id != null ? `private:${raw.user_id}` : `chat:${raw.chat_id ?? 'unknown'}`;
    const sourceId = String(raw.message_id ?? raw.id ?? createHash('sha256').update(JSON.stringify(raw)).digest('hex'));
    const input: any[] = Array.isArray(raw.message) ? raw.message : [{ type: 'text', data: { text: String(raw.raw_message ?? raw.message ?? '') } }];
    const segments: Segment[] = input.map(s => {
      const d=s.data??s; const type=String(s.type??'unknown');
      if(type==='text')return {type:'text',text:String(d.text??'')};
      if(type==='reply')return {type:'reply',id:String(d.id??'')};
      if(['image','audio','video','file'].includes(type))return {type,url:typeof d.url==='string'?d.url:undefined,file:typeof d.file==='string'?d.file:undefined,fileId:typeof d.file==='string'?d.file:undefined,mimeType:d.mime??d.mime_type,size:Number.isFinite(Number(d.size))?Number(d.size):undefined,metadata:{...d}};
      return {type,...d};
    });
    const text = segments.filter((s):s is Extract<Segment,{type:'text'}> => s.type === 'text').map(s => s.text).join('');
    const rawTime=Number(raw.time); const time=Number.isFinite(rawTime)&&rawTime>0 ? (rawTime<1e12?rawTime*1000:rawTime) : Date.now();
    const reply=segments.find((s:any)=>s.type==='reply') as any;
    return { id: stableEventId(chatId, sourceId), sourceId, accountId, chatId, chatType: raw.group_id != null ? 'group' : raw.user_id != null ? 'private' : 'unknown', authorId: String(raw.user_id ?? raw.sender?.user_id ?? 'unknown'), authorName: raw.sender?.card || raw.sender?.nickname, selfId: raw.self_id == null ? undefined : String(raw.self_id), time, sequence: ++this.#sequence, messageType: String(raw.message_type ?? 'unknown'), text, segments, replyTo: reply?.id || undefined, raw };
  }
  get watermark(): number { return this.#sequence; }
}
export function normalizeOneBotEvent(raw: unknown, options: { petId?: string; sequence: number; selfId?: string; accountId?: string }): NormalizedEvent {
  const sequencer = new EventSequencer();
  const e = sequencer.next({ ...(raw as Record<string, unknown>), self_id: options.selfId ?? (raw as any)?.self_id }, options.accountId);
  return { ...e, sequence: options.sequence };
}
