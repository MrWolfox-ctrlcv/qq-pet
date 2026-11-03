// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';

export type PetConnection = {
  provider?:'onebot'; httpUrl?:string; wsUrl?:string; accessToken?:string;
  enabled?:boolean; live?:boolean;
};
export type ModelConnection = {baseUrl?:string;apiKey?:string;chatModel?:string;decisionModel?:string;visionModel?:string;imageModel?:string;auxApiKey?:string;auxBaseUrl?:string;imageProvider?:'chat'|'agnes';imageBaseUrl?:string;imageApiKey?:string};
export type RuntimeConfig={pets:Record<string,{connection:PetConnection;model:ModelConnection}>};
export class PrivateConfig {
  file:string;
  config:RuntimeConfig;
  constructor(dataDir:string){this.file=path.join(dataDir,'runtime.private.json');this.config=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{pets:{}};}
  get(petId:string){return this.config.pets[petId]||{connection:{},model:{}};}
  set(petId:string,value:{connection?:PetConnection;model?:ModelConnection}){
    const current=this.get(petId);const next={connection:{...current.connection,...value.connection},model:{...current.model,...value.model}};
    for(const name of ['httpUrl','wsUrl'] as const){const text=next.connection[name];if(text){const url=new URL(text);if(!['http:','https:','ws:','wss:'].includes(url.protocol))throw new Error('连接地址格式错误');}}
    if(next.model.imageProvider&&!['chat','agnes'].includes(next.model.imageProvider))throw new Error('不支持此生图服务');
    if(next.model.imageBaseUrl&&new URL(next.model.imageBaseUrl).protocol!=='https:')throw new Error('生图地址必须使用 HTTPS');
    if(next.model.baseUrl&&!/^https?:\/\//.test(next.model.baseUrl))throw new Error('模型地址必须是 HTTP 或 HTTPS');
    this.config.pets[petId]=next;this.save();return this.public(petId);
  }
  save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.config,null,2),{mode:0o600});fs.renameSync(tmp,this.file);}
  public(petId:string){const {connection,model}=this.get(petId);return {connection:{provider:connection.provider||'onebot',httpUrl:connection.httpUrl||'',wsUrl:connection.wsUrl?connection.wsUrl.replace(/([?&](?:access_token|token)=)[^&]*/gi,'$1***'):'',enabled:!!connection.enabled,live:!!connection.live,hasAccessToken:!!connection.accessToken},model:{baseUrl:model.baseUrl||'',chatModel:model.chatModel||'',decisionModel:model.decisionModel||'gemini-3.5-flash-lite',visionModel:model.visionModel||'gemini-3.5-flash-lite',imageModel:model.imageModel||'',imageProvider:model.imageProvider||'chat',imageBaseUrl:model.imageBaseUrl||'https://apihub.agnes-ai.com',hasImageApiKey:!!model.imageApiKey,hasApiKey:!!model.apiKey,hasAuxApiKey:!!model.auxApiKey}};}
}
