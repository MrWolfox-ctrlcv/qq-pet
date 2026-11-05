// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ContextLimitError,protectionBudget} from './token-budget.ts';
import {PetError,errorInfo,modelHttpError} from './errors.ts';
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
    if(!config.apiKey||!config.baseUrl)throw new PetError('MODEL_CONFIG','模型服务或密钥尚未配置。');
    const model=options.model||config.chatModel;if(!model)throw new PetError('MODEL_CONFIG','尚未选择回复模型。');
    const guard=await protectionBudget(messages);if(guard.total+(options.maxTokens||1200)>Math.min(60000,options.contextLimit||60000))throw new ContextLimitError();
    const count=this.inFlight.get(petId)||0;if(count>=3)throw new PetError('MODEL_BUSY','本地模型请求正在排队，请稍后再试。');
    this.inFlight.set(petId,count+1);
    const useAux=!!config.auxApiKey&&model!==config.chatModel;
    const base=useAux?config.auxBaseUrl||config.baseUrl:config.baseUrl;
    const started=Date.now(),requestId=randomUUID();let usage:Usage|null=null;let responseInfo:Record<string,unknown>={};
    try{
      const signals=[AbortSignal.timeout(120000)];if(options.signal)signals.push(options.signal);
      let response:Response;
      try{response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(useAux?config.auxApiKey:config.apiKey)},body:JSON.stringify({model,messages:messages.map(({role,content})=>({role,content})),max_tokens:options.maxTokens||1200}),signal:AbortSignal.any(signals)});}
      catch(error){throw new PetError(error instanceof Error&&error.name==='TimeoutError'?'MODEL_TIMEOUT':error instanceof Error&&error.name==='AbortError'?'MODEL_CANCELLED':'MODEL_NETWORK',error instanceof Error&&error.name==='TimeoutError'?'模型服务响应超时，请稍后再试。':error instanceof Error&&error.name==='AbortError'?'本轮模型请求已取消。':'无法连接模型服务，请检查网络与服务地址。');}
      if(!response.ok){let providerCode='';try{const body=await response.json() as any;providerCode=typeof body?.error?.code==='string'?body.error.code:'';}catch{}throw modelHttpError(response.status,providerCode);}
      let json:any;try{json=await response.json();}catch{throw new PetError('MODEL_RESPONSE_FORMAT','模型服务返回了无法解析的响应。');}
      if(!Array.isArray(json?.choices)||!json.choices[0]?.message)throw new PetError('MODEL_RESPONSE_FORMAT','模型服务响应缺少有效的回复字段。');
      const choice=json.choices[0],content=choice.message.content;
      const text=typeof content==='string'?content:Array.isArray(content)?content.filter((s:any)=>s.type==='text').map((s:any)=>s.text).join('\n'):'';
      const rawCache=json.usage?.prompt_tokens_details?.cached_tokens??json.usage?.prompt_cache_hit_tokens??json.usageMetadata?.cachedContentTokenCount;
      usage={calls:1,promptTokens:reported(json.usage?.prompt_tokens??json.usageMetadata?.promptTokenCount),completionTokens:reported(json.usage?.completion_tokens??json.usageMetadata?.candidatesTokenCount),totalTokens:reported(json.usage?.total_tokens??json.usageMetadata?.totalTokenCount),cachedTokens:reported(rawCache)};
      const finishReason=typeof choice.finish_reason==='string'?choice.finish_reason.slice(0,60):null;
      responseInfo={usageSource:json.usage||json.usageMetadata?'provider':'not-reported',finishReason};
      const drawingOutput=options.kind==='drawing'&&(Array.isArray(choice.message.images)&&choice.message.images.length>0||Array.isArray(content)&&content.some((p:any)=>p.type==='image_url'||p.type==='image'));
      if(choice.message.refusal||finishReason==='content_filter')throw new PetError('MODEL_BLOCKED','模型服务拒绝或拦截了本轮回复。',{finishReason});
      if(/^暂时无法完成这项操作[。.!！]?\s*$/.test(text.trim()))throw new PetError('MODEL_UNSPECIFIED_FAILURE','模型只返回了笼统的失败提示，未提供具体原因。',{finishReason});
      if(!text.trim()&&!drawingOutput){
        if(finishReason==='length'||finishReason==='max_tokens')throw new PetError('MODEL_OUTPUT_LIMIT','模型已耗尽本轮输出额度，但没有返回可发送的正文。',{finishReason});
        if(choice.message.tool_calls?.length||finishReason==='tool_calls')throw new PetError('MODEL_TOOL_PROTOCOL','模型返回了当前接入未支持的原生工具调用，没有回复正文。',{finishReason});
        throw new PetError('MODEL_EMPTY','模型服务返回空内容，这轮没有生成回复。',{finishReason});
      }
      this.record(petId,{requestId,outcome:'ok',...options.context,kind:options.kind||'chat',model,returnedModel:json.model||null,elapsedMs:Date.now()-started,...responseInfo,...usage});
      return {text,usage,raw:json};
    }catch(error){
      const failure=error instanceof PetError?error:new PetError('MODEL_RESPONSE_PROCESSING','处理模型响应时发生内部异常，请在面板查看本轮记录。');
      failure.usage=usage;failure.details.requestId=requestId;
      this.record(petId,{requestId,...options.context,kind:options.kind||'chat',model,outcome:'failed',elapsedMs:Date.now()-started,usageSource:'not-reported',promptTokens:null,completionTokens:null,totalTokens:null,cachedTokens:null,...responseInfo,...usage,error:failure.name,...errorInfo(failure)});throw failure;
    }finally{this.inFlight.set(petId,(this.inFlight.get(petId)||1)-1);}
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
