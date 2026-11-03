// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import type {ModelConnection} from './private-config.ts';

export type ModelMessage={role:'system'|'user'|'assistant';content:unknown};
export type Usage={calls:number;promptTokens:number;completionTokens:number;cachedTokens:number|null};
export class ModelClient {
  private inFlight=new Map<string,number>();
  private dataDir:string;
  constructor(dataDir:string){this.dataDir=dataDir;}
  async call(petId:string,config:ModelConnection,messages:ModelMessage[],options:{model?:string;maxTokens?:number;signal?:AbortSignal;kind?:string}={}){
    if(!config.apiKey||!config.baseUrl)throw new Error('请先配置模型服务与密钥');
    const model=options.model||config.chatModel;if(!model)throw new Error('未选择模型');
    const count=this.inFlight.get(petId)||0;if(count>=3)throw new Error('模型请求较多，稍后重试');
    this.inFlight.set(petId,count+1);
    const useAux=!!config.auxApiKey&&model!==config.chatModel;
    const base=useAux?config.auxBaseUrl||config.baseUrl:config.baseUrl;
    const started=Date.now();
    try{
      const signals=[AbortSignal.timeout(120000)];if(options.signal)signals.push(options.signal);
      const response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(useAux?config.auxApiKey:config.apiKey)},body:JSON.stringify({model,messages,max_tokens:options.maxTokens||1200}),signal:AbortSignal.any(signals)});
      if(!response.ok)throw new Error(`模型服务返回 ${response.status}，请检查额度与服务状态`);
      const json=await response.json() as any;const content=json.choices?.[0]?.message?.content;
      const text=typeof content==='string'?content:Array.isArray(content)?content.filter((s:any)=>s.type==='text').map((s:any)=>s.text).join('\n'):'';
      const rawCache=json.usage?.prompt_tokens_details?.cached_tokens??json.usage?.prompt_cache_hit_tokens??json.usageMetadata?.cachedContentTokenCount;
      const usage={calls:1,promptTokens:Number(json.usage?.prompt_tokens||0),completionTokens:Number(json.usage?.completion_tokens||0),cachedTokens:typeof rawCache==='number'?rawCache:null};
      this.record(petId,{kind:options.kind||'chat',model,returnedModel:json.model||null,elapsedMs:Date.now()-started,...usage});
      return {text,usage,raw:json};
    }finally{this.inFlight.set(petId,(this.inFlight.get(petId)||1)-1);}
  }
  record(petId:string,info:Record<string,unknown>){fs.appendFileSync(path.join(this.dataDir,'model-usage.jsonl'),JSON.stringify({petId,ts:new Date().toISOString(),...info})+'\n');}
  usage(petId:string):Usage{
    const result:Usage={calls:0,promptTokens:0,completionTokens:0,cachedTokens:null};const file=path.join(this.dataDir,'model-usage.jsonl');if(!fs.existsSync(file))return result;
    for(const line of fs.readFileSync(file,'utf8').split('\n')){try{const row=JSON.parse(line);if(row.petId!==petId)continue;result.calls++;result.promptTokens+=Number(row.promptTokens||0);result.completionTokens+=Number(row.completionTokens||0);if(typeof row.cachedTokens==='number')result.cachedTokens=(result.cachedTokens||0)+row.cachedTokens;}catch{}}
    return result;
  }
}
