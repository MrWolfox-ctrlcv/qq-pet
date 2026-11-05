// SPDX-License-Identifier: Apache-2.0
import {ContextLimitError} from './token-budget.ts';

export class PetError extends Error {
  code:string;
  details:Record<string,unknown>;
  usage:unknown=null;
  constructor(code:string,message:string,details:Record<string,unknown>={}){super(message);this.name='PetError';this.code=code;this.details=details;}
}

export function errorInfo(error:unknown,fallback={code:'INTERNAL_ERROR',message:'内部处理失败，请在面板查看本轮记录。'}){
  if(error instanceof ContextLimitError)return {code:'CONTEXT_LIMIT',message:error.message};
  return error instanceof PetError?{code:error.code,message:error.message,...error.details}:fallback;
}

export function errorNotice(info:{code:string;message:string},operation='回复'){
  return `【${operation}异常·${info.code}】${info.message}`;
}

export function modelHttpError(status:number,providerCode:string){
  if(status===401)return new PetError('MODEL_AUTH','模型服务认证失败，请检查密钥。',{httpStatus:status});
  if(status===403)return new PetError('MODEL_PERMISSION','模型服务拒绝访问，请检查账号或模型权限。',{httpStatus:status});
  if(status===402||/^(insufficient_quota|quota_exceeded|credit_balance_too_low)$/.test(providerCode))return new PetError('MODEL_QUOTA','模型服务提示额度不足，请检查余额或配额。',{httpStatus:status});
  if(status===429)return new PetError('MODEL_RATE_LIMIT','模型服务请求过于频繁，请稍后再试。',{httpStatus:status});
  if(status===404)return new PetError('MODEL_NOT_FOUND','模型或接口地址不存在，请检查模型配置。',{httpStatus:status});
  if(/^(context_length_exceeded|context_window_exceeded)$/.test(providerCode))return new PetError('MODEL_CONTEXT_LIMIT','本轮内容超过模型服务的上下文限制。',{httpStatus:status});
  if(status>=500)return new PetError('MODEL_UNAVAILABLE',`模型服务暂时故障（HTTP ${status}），请稍后再试。`,{httpStatus:status});
  return new PetError('MODEL_REQUEST_REJECTED',`模型服务拒绝了本轮请求（HTTP ${status}），请查看配置与请求记录。`,{httpStatus:status});
}
