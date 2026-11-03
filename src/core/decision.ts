// SPDX-License-Identifier: Apache-2.0
import type { NormalizedEvent } from './events.ts';
export type Decision = { reply: boolean; reason: 'addressed-to-self' | 'mentions-master' | 'remote-required' | 'cooldown' | 'not-addressed' };
export interface RemoteDecision { shouldReply(event: NormalizedEvent): Promise<boolean> }
export class ResponseDecider {
  #lastRemote = new Map<string, number>();
  readonly selfId:string; readonly masterIds:readonly string[]; readonly remote?:RemoteDecision; readonly intervalMs:number; readonly now:()=>number;
  constructor(selfId: string, masterIds: readonly string[], remote?: RemoteDecision, intervalMs = 15_000, now = () => Date.now()) { this.selfId=selfId;this.masterIds=masterIds;this.remote=remote;this.intervalMs=intervalMs;this.now=now; }
  async decide(e: NormalizedEvent): Promise<Decision> {
    const raw: any = e.raw; const mentions: string[] = (Array.isArray(raw?.message) ? raw.message : []).filter((s: any) => s.type === 'at').map((s: any) => String(s.data?.qq));
    if (mentions.includes(this.selfId)) return { reply: true, reason: 'addressed-to-self' };
    if (this.masterIds.some(id => mentions.includes(id))) return { reply: true, reason: 'mentions-master' };
    if (mentions.length) return { reply: false, reason: 'not-addressed' };
    if (e.chatType === 'private') return { reply: true, reason: 'not-addressed' };
    if (e.chatType !== 'group' || !this.remote) return { reply: false, reason: 'not-addressed' };
    const t=this.now(), last=this.#lastRemote.get(e.chatId) ?? 0;
    if (t-last < this.intervalMs) return { reply: false, reason: 'cooldown' };
    this.#lastRemote.set(e.chatId,t);
    return await this.remote.shouldReply(e) ? { reply:true, reason:'remote-required' } : { reply:false, reason:'not-addressed' };
  }
}
