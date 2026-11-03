// SPDX-License-Identifier: Apache-2.0
import type { NormalizedEvent } from './events.ts';
export interface ReplyResolver { fetchMessage(chatId: string, messageId: string): Promise<NormalizedEvent | undefined> }
export interface ContextSnapshot { trigger: NormalizedEvent; watermark: number; messages: NormalizedEvent[]; reply?: { event: NormalizedEvent; provenance: 'explicit-reply-fetch'; messageId: string } }
export async function buildContext(trigger: NormalizedEvent, history: readonly NormalizedEvent[], resolver?: ReplyResolver, limit = 30): Promise<ContextSnapshot> {
  const watermark = trigger.sequence;
  const byTime = (a:NormalizedEvent,b:NormalizedEvent) => a.time-b.time || a.sequence-b.sequence;
  // Sequence is the immutable snapshot boundary. Imported rows may have been
  // appended later than local rows while carrying much older source times, so
  // use sequence only for eligibility/tie-breaking and time for display order.
  const eligible = history.filter(e => e.chatId === trigger.chatId && e.sequence <= watermark && e.sourceId!==trigger.sourceId);
  eligible.push(trigger);
  eligible.sort(byTime);
  const windowSize=Math.max(1,Math.trunc(limit)||1);
  let sameChat=eligible.slice(-windowSize);
  // The triggering event is authoritative and must remain in the snapshot,
  // even when a caller supplied a history window that omitted it.
  if (!sameChat.some(e => e.sourceId === trigger.sourceId)) {
    const others=eligible.filter(e=>e.sourceId!==trigger.sourceId).slice(-Math.max(0,windowSize-1));
    sameChat=[...others,trigger].sort(byTime);
  }
  let reply: ContextSnapshot['reply'];
  if (trigger.replyTo && resolver) {
    const fetched = await resolver.fetchMessage(trigger.chatId, trigger.replyTo);
    if (fetched && fetched.chatId === trigger.chatId && fetched.sourceId === trigger.replyTo) reply = { event: fetched, provenance: 'explicit-reply-fetch', messageId: trigger.replyTo };
  }
  return { trigger, watermark, messages: sameChat, reply };
}
