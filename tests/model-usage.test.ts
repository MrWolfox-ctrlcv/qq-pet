// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ModelClient} from '../src/model.ts';
import {ContextLimitError} from '../src/token-budget.ts';

test('usage records only provider values, preserves unknowns and strips local metadata from API inputs',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'pet-usage-')),client=new ModelClient(dir),original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(_url,options)=>{calls++;const payload=JSON.parse(String(options?.body));assert.equal(payload.messages[0].contextMeta,undefined);return Response.json({choices:[{message:{content:'ok'}}],...(calls===2?{usage:{prompt_tokens:123,completion_tokens:45,total_tokens:168,prompt_tokens_details:{cached_tokens:0}}}:{})})};
  t.after(()=>{globalThis.fetch=original;rmSync(dir,{recursive:true,force:true})});
  const config={apiKey:'fake',baseUrl:'https://model.invalid',chatModel:'fake'};
  const missing=await client.call('p',config,[{role:'user',content:'hello',contextMeta:{kind:'current'}}],{context:{chatId:'group:1',topicId:'topic'}});
  assert.equal(missing.usage.promptTokens,null);assert.equal(missing.usage.completionTokens,null);assert.equal(missing.usage.cachedTokens,null);
  const actual=await client.call('p',config,[{role:'user',content:'hello'}]);assert.equal(actual.usage.promptTokens,123);assert.equal(actual.usage.totalTokens,168);assert.equal(actual.usage.cachedTokens,0);
  assert.equal(client.usage('p').promptTokens,123);assert.equal(client.usage('p').unreportedCalls,1);assert.equal(client.recentUsage('p')[1].chatId,'group:1');
  await assert.rejects(client.call('p',config,[{role:'user',content:'x'.repeat(70000)}]),ContextLimitError);assert.equal(calls,2);
});
