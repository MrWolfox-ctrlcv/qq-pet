// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ModelClient} from '../src/model.ts';
import {ContextLimitError} from '../src/token-budget.ts';
import {PetError} from '../src/errors.ts';

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

test('model errors distinguish causes and retain actual usage for empty or blocked replies',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'pet-errors-')),client=new ModelClient(dir),original=globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;rmSync(dir,{recursive:true,force:true})});
  const config={apiKey:'fake',baseUrl:'https://model.invalid',chatModel:'fake'};
  const upstream=(content:unknown,finish_reason='stop',extra:any={})=>Response.json({choices:[{message:{content,...extra},finish_reason}],usage:{prompt_tokens:123,completion_tokens:50,total_tokens:173}});
  const cases:[string,()=>Response][]=[
    ['MODEL_EMPTY',()=>upstream(' ')],['MODEL_UNSPECIFIED_FAILURE',()=>upstream('暂时无法完成这项操作。')],['MODEL_OUTPUT_LIMIT',()=>upstream('','length')],
    ['MODEL_BLOCKED',()=>upstream('','content_filter')],['MODEL_BLOCKED',()=>upstream('', 'stop',{refusal:'private-provider-message'})],
    ['MODEL_TOOL_PROTOCOL',()=>upstream('','tool_calls',{tool_calls:[{id:'call'}]})],
    ['MODEL_AUTH',()=>new Response('private-provider-message',{status:401})],
    ['MODEL_PERMISSION',()=>new Response('',{status:403})],['MODEL_NOT_FOUND',()=>new Response('',{status:404})],
    ['MODEL_QUOTA',()=>Response.json({error:{code:'insufficient_quota'}},{status:429})],
    ['MODEL_RATE_LIMIT',()=>new Response('',{status:429})],['MODEL_UNAVAILABLE',()=>new Response('',{status:503})],
    ['MODEL_CONTEXT_LIMIT',()=>Response.json({error:{code:'context_length_exceeded'}},{status:400})],
    ['MODEL_REQUEST_REJECTED',()=>new Response('',{status:400})],
    ['MODEL_RESPONSE_FORMAT',()=>new Response('not-json')],['MODEL_RESPONSE_FORMAT',()=>Response.json({choices:[]})],
    ['MODEL_TIMEOUT',()=>{throw new DOMException('private-provider-message','TimeoutError')}],
    ['MODEL_NETWORK',()=>{throw new TypeError('private-provider-message')}]
  ];
  for(const [code,response] of cases){
    globalThis.fetch=async()=>response();
    await assert.rejects(client.call('p',config,[{role:'user',content:'hello'}]),e=>e instanceof PetError&&e.code===code);
    const row=client.recentUsage('p',1)[0];assert.equal(row.code,code);assert.equal(row.outcome,'failed');assert.ok(row.requestId);
    assert.doesNotMatch(JSON.stringify(row),/private-provider-message/);
    if(['MODEL_EMPTY','MODEL_UNSPECIFIED_FAILURE','MODEL_OUTPUT_LIMIT','MODEL_BLOCKED','MODEL_TOOL_PROTOCOL'].includes(code)){assert.equal(row.promptTokens,123);assert.equal(row.completionTokens,50);assert.equal(row.cachedTokens,null);}
    else assert.equal(row.promptTokens,null);
  }
  globalThis.fetch=async()=>upstream(null,'stop',{images:[{image_url:{url:'data:image/png;base64,AA=='}}]});
  const drawing=await client.call('p',config,[{role:'user',content:'draw'}],{kind:'drawing'});assert.equal(drawing.text,'');assert.ok(drawing.raw.choices[0].message.images.length);
});
