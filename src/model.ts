// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ContextLimitError,protectionBudget} from './token-budget.ts';
import type {ModelConnection} from './private-config.ts';

export type ModelMessage={role:'system'|'user'|'assistant';content:unknown;contextMeta?:{kind:string;id?:string;sequence?:number;topicId?:string;protected?:boolean;originPetId?:string;originPersonaName?:string;sharedConversation?:boolean}};
export type Usage={calls:number;promptTokens:number|null;completionTokens:number|null;totalTokens?:number|null;cachedTokens:number|null;unreportedCalls?:number};
export type CallContext={chatId:string;topicId?:string;triggerId?:string;snapshotId?:string};
const reported=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
export class ModelClient {
  private inFlight=new Map<string,number>();
  private dataDir:string;
  constructor(dataDir:string){this.dataDir=dataDir;}
  async call(petId:string,config:ModelConnection,messages:ModelMessage[],options:{model?:string;maxTokens?:number;signal?:AbortSignal;kind?:string;context?:CallContext;contextLimit?:number}={}){
    if(!config.apiKey||!config.baseUrl)throw new Error('请先配置模型服务与密钥');
    const model=options.model||config.chatModel;if(!model)throw new Error('未选择模型');
    const guard=await protectionBudget(messages);if(guard.total+(options.maxTokens||1200)>Math.min(60000,options.contextLimit||60000))throw new ContextLimitError();
    const count=this.inFlight.get(petId)||0;if(count>=3)throw new Error('模型请求较多，稍后重试');
    this.inFlight.set(petId,count+1);
    const useAux=!!config.auxApiKey&&model!==config.chatModel;
    const base=useAux?config.auxBaseUrl||config.baseUrl:config.baseUrl;
    const started=Date.now(),requestId=randomUUID();
    try{
      const signals=[AbortSignal.timeout(120000)];if(options.signal)signals.push(options.signal);
      const response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(useAux?config.auxApiKey:config.apiKey)},body:JSON.stringify({model,messages:messages.map(({role,content})=>({role,content})),max_tokens:options.maxTokens||1200}),signal:AbortSignal.any(signals)});
      if(!response.ok)throw new Error(`模型服务返回 ${response.status}，请检查额度与服务状态`);
      const json=await response.json() as any;const content=json.choices?.[0]?.message?.content;
      const text=typeof content==='string'?content:Array.isArray(content)?content.filter((s:any)=>s.type==='text').map((s:any)=>s.text).join('\n'):'';
      const rawCache=json.usage?.prompt_tokens_details?.cached_tokens??json.usage?.prompt_cache_hit_tokens??json.usageMetadata?.cachedContentTokenCount;
      const usage:Usage={calls:1,promptTokens:reported(json.usage?.prompt_tokens??json.usageMetadata?.promptTokenCount),completionTokens:reported(json.usage?.completion_tokens??json.usageMetadata?.candidatesTokenCount),totalTokens:reported(json.usage?.total_tokens??json.usageMetadata?.totalTokenCount),cachedTokens:reported(rawCache)};
      this.record(petId,{requestId,outcome:'ok',...options.context,kind:options.kind||'chat',usageSource:json.usage||json.usageMetadata?'provider':'not-reported',model,returnedModel:json.model||null,elapsedMs:Date.now()-started,...usage});
      return {text,usage,raw:json};
    }catch(error){this.record(petId,{requestId,...options.context,kind:options.kind||'chat',model,outcome:'failed',elapsedMs:Date.now()-started,usageSource:'not-reported',promptTokens:null,completionTokens:null,totalTokens:null,cachedTokens:null,error:error instanceof Error?error.name:'Error'});throw error;}finally{this.inFlight.set(petId,(this.inFlight.get(petId)||1)-1);}
  }
  record(petId:string,info:Record<string,unknown>){fs.appendFileSync(path.join(this.dataDir,'model-usage.jsonl'),JSON.stringify({petId,ts:new Date().toISOString(),...info})+'\n');}
  recentUsage(petId:string,limit=50){
    const file=path.join(this.dataDir,'model-usage.jsonl');if(!fs.existsSync(file))return [];
    return fs.readFileSync(file,'utf8').split('\n').flatMap(line=>{try{const r=JSON.parse(line);return r.petId===petId?[r]:[]}catch{return []}}).slice(-Math.max(1,Math.min(200,limit))).reverse();
  }
  usage(petId:string):Usage{
    const rows=this.recentUsageAll(petId),sum=(key:string)=>{const values=rows.map(r=>r[key]).filter(v=>typeof v==='number');return values.length?values.reduce((a,b)=>a+b,0):null};
    return {calls:rows.length,promptTokens:sum('promptTokens'),completionTokens:sum('completionTokens'),totalTokens:sum('totalTokens'),cachedTokens:sum('cachedTokens'),unreportedCalls:rows.filter(r=>typeof r.promptTokens!=='number').length};
  }
  private recentUsageAll(petId:string){const file=path.join(this.dataDir,'model-usage.jsonl');if(!fs.existsSync(file))return [];return fs.readFileSync(file,'utf8').split('\n').flatMap(line=>{try{const r=JSON.parse(line);return r.petId===petId?[r]:[]}catch{return []}});}
}
