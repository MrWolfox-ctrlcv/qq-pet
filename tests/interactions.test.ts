// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';import assert from 'node:assert/strict';import {petInteraction} from '../src/core/interactions.ts';import {ResponseDecider} from '../src/core/decision.ts';import type {NormalizedEvent} from '../src/core/events.ts';
const event=(text:string):NormalizedEvent=>({id:'x',sourceId:'x',chatId:'group:1',chatType:'group',authorId:'42',time:Date.now(),sequence:1,messageType:'group',text,segments:[{type:'text',text}]});
test('standalone ampersand is a local fictional whip interaction, not a URL or expression',async()=>{
 assert.equal(petInteraction(event(' & '),'999')?.kind,'virtual-whip');assert.equal(petInteraction(event('&'),'999')?.fictional,true);
 for(const text of ['a & b','&&','https://example.invalid/?a=1&b=2','今天 & 明天'])assert.equal(petInteraction(event(text),'999'),undefined);
 const other=event('&');other.segments.push({type:'at',qq:'77'});assert.equal(petInteraction(other,'999'),undefined);
 let remote=0;const decider=new ResponseDecider('999',['42'],{shouldReply:async()=>{remote++;return false}});assert.deepEqual(await decider.decide(event('&')),{reply:true,reason:'pet-interaction'});assert.equal(remote,0);
});
