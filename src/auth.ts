// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';

type Session = {csrfToken:string; expiresAt:number};
export class ApiError extends Error {
  status:number;
  code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}

export class Auth {
  tokenPath:string;
  private tokenDigest:Buffer;
  private sessions=new Map<string,Session>();
  private failures=new Map<string,{count:number;start:number}>();
  constructor(dataDir:string){
    this.tokenPath=path.join(dataDir,'admin-token.txt');
    if(!fs.existsSync(this.tokenPath))fs.writeFileSync(this.tokenPath,crypto.randomBytes(24).toString('base64url')+'\n',{mode:0o600});
    this.tokenDigest=crypto.createHash('sha256').update(fs.readFileSync(this.tokenPath,'utf8').trim()).digest();
  }
  login(req:IncomingMessage,res:ServerResponse,token:unknown){
    const address=req.socket.remoteAddress||'unknown';const now=Date.now();
    const attempts=this.failures.get(address);
    if(attempts&&now-attempts.start<60000&&attempts.count>=8)throw new ApiError(429,'LOGIN_RATE_LIMIT','尝试次数过多，请一分钟后重试');
    const digest=crypto.createHash('sha256').update(typeof token==='string'?token:'').digest();
    if(!crypto.timingSafeEqual(this.tokenDigest,digest)){
      this.failures.set(address,{start:attempts&&now-attempts.start<60000?attempts.start:now,count:attempts&&now-attempts.start<60000?attempts.count+1:1});
      throw new ApiError(401,'BAD_TOKEN','管理口令不正确');
    }
    this.failures.delete(address);
    for(const [id,session] of this.sessions)if(session.expiresAt<now)this.sessions.delete(id);
    const id=crypto.randomBytes(32).toString('base64url');
    const session={csrfToken:crypto.randomBytes(24).toString('base64url'),expiresAt:now+12*3600000};
    this.sessions.set(id,session);
    res.setHeader('Set-Cookie',`pet_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
    return {authenticated:true,csrfToken:session.csrfToken};
  }
  session(req:IncomingMessage){
    const id=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('pet_session='))?.slice(12)||'';
    const session=this.sessions.get(id);
    if(!session||session.expiresAt<Date.now()){if(id)this.sessions.delete(id);return null;}
    return {id,...session};
  }
  require(req:IncomingMessage){
    const session=this.session(req);if(!session)throw new ApiError(401,'UNAUTHENTICATED','请先登录管理面板');
    if(!['GET','HEAD','OPTIONS'].includes(req.method||'GET')){
      if(req.headers['x-csrf-token']!==session.csrfToken)throw new ApiError(403,'CSRF','页面验证已失效，请刷新后重试');
      this.checkOrigin(req);
    }
    return session;
  }
  checkOrigin(req:IncomingMessage){
    if(req.headers.origin){
      let origin:URL;try{origin=new URL(req.headers.origin);}catch{throw new ApiError(403,'ORIGIN','请求来源无效');}
      if(origin.host!==req.headers.host)throw new ApiError(403,'ORIGIN','不接受其他网站提交的修改');
    }
    if(req.headers['sec-fetch-site']==='cross-site')throw new ApiError(403,'ORIGIN','不接受跨站请求');
  }
  logout(req:IncomingMessage,res:ServerResponse){const session=this.session(req);if(session)this.sessions.delete(session.id);res.setHeader('Set-Cookie','pet_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');}
}
