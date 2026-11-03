// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { EventSequencer, type NormalizedEvent } from '../core/events.ts';

export type ConnectionState = 'disconnected'|'connecting'|'online'|'reconnecting'|'account-mismatch'|'stopped';
export interface SendReceipt { ok: boolean; status: 'sent'|'failed'|'uncertain'; messageId?: string; error?: string; requestId: string }
export interface OneBotOptions { url: string; accessToken?: string; expectedAccountId?: string; heartbeatIntervalMs?: number; heartbeatTimeoutMs?: number; reconnectBaseMs?: number; reconnectMaxMs?: number; maxRetries?: number; WebSocketImpl?: typeof WebSocket }
type Waiter={resolve:(v:any)=>void; reject:(e:Error)=>void; timer:NodeJS.Timeout};
/** OneBot v11 reverse WebSocket client. No send occurs until login identity is confirmed. */
export class OneBotTransport {
  readonly options:OneBotOptions;
  state: ConnectionState='disconnected'; accountId?: string; lastHeartbeatAt?: number; lastEventAt?: number;
  readonly events = new EventSequencer();
  #receipts=new Map<string,Promise<SendReceipt>>();
  #ws?: WebSocket; #waiters=new Map<string,Waiter>(); #stopped=false; #attempt=0; #heartbeat?:NodeJS.Timeout; #reconnectTimer?:NodeJS.Timeout; #lastPong=0; #checkingStatus=false;
  #ready?:Promise<void>; #readyResolve?:()=>void; #readyReject?:(e:Error)=>void;
  #isReady=false;
  constructor(options: OneBotOptions) { this.options=options; }
  connect(): Promise<void> {
    if(this.#ready && (this.state==='connecting'||this.state==='online')) return this.#ready;
    this.#stopped=false;this.#isReady=false; this.#ready=new Promise((resolve,reject)=>{this.#readyResolve=resolve;this.#readyReject=reject;}); this.#open(); return this.#ready;
  }
  #open() {
    if(this.#stopped)return; this.state=this.#attempt?'reconnecting':'connecting';
    const Impl=this.options.WebSocketImpl ?? WebSocket;
    this.#ws=new Impl(this.options.url, this.options.accessToken?{headers:{Authorization:`Bearer ${this.options.accessToken}`}}:undefined);
    this.#ws.on('open',()=>{this.#lastPong=Date.now(); this.#heartbeat=setInterval(()=>this.#beat(),this.options.heartbeatIntervalMs??10_000); this.#beat(); void this.#authenticate();});
    this.#ws.on('pong',()=>{this.#lastPong=Date.now();this.lastHeartbeatAt=Date.now();});
    this.#ws.on('message',b=>this.#message(String(b)));
    this.#ws.on('close',()=>{this.#clearHeartbeat();this.#rejectWaiters(new Error('OneBot connection closed')); if(!this.#stopped&&this.state!=='account-mismatch')this.#retry();});
    this.#ws.on('error',()=>{});
  }
  #beat(){ if(!this.#ws||this.#ws.readyState!==WebSocket.OPEN)return;
    const timeout=this.options.heartbeatTimeoutMs??30_000;
    if(Date.now()-this.#lastPong>timeout){this.#ws.terminate();return;}
    this.#ws.ping();
  }
  #clearHeartbeat(){if(this.#heartbeat)clearInterval(this.#heartbeat);this.#heartbeat=undefined;}
  #rejectWaiters(error:Error){for(const w of this.#waiters.values()){clearTimeout(w.timer);w.reject(error)}this.#waiters.clear()}
  async #checkStatus(){if(this.#checkingStatus||this.state!=='online')return;this.#checkingStatus=true;try{const s=(await this.#rawAction('get_status',{},5000)).data;if(s?.online===false||s?.good===false)this.#ws?.terminate()}catch{this.#ws?.terminate()}finally{this.#checkingStatus=false}}
  async #authenticate(){
    try {
      const res=await this.#rawAction('get_login_info'); const id=String(res.data?.user_id??'');
      if(!id) throw new Error('get_login_info returned no account id');
      if(this.options.expectedAccountId && this.options.expectedAccountId!==id){this.accountId=id;this.state='account-mismatch';this.#readyReject?.(new Error('Connected account does not match configured account'));this.#ws?.close();return;}
      const status=await this.#rawAction('get_status');
      if(status.data?.online===false||status.data?.good===false)throw new Error('OneBot reports account offline or unhealthy');
      this.accountId=id;this.state='online';this.#attempt=0;
      // Our native bridge waits for verified identity before replaying retained
      // events. Store-level message keys make reconnection replay idempotent.
      if(status.data?.bridge_resume===true)await this.#rawAction('bridge_ready');
      this.#isReady=true;this.#readyResolve?.();
    } catch(e) { this.#ws?.terminate(); }
  }
  #retry(){const max=this.options.maxRetries??Infinity;if(this.#attempt>=max){this.state='disconnected';this.#readyReject?.(new Error('OneBot reconnect limit reached'));return;}
    const delay=Math.min((this.options.reconnectBaseMs??500)*2**this.#attempt,this.options.reconnectMaxMs??30_000); this.#attempt++;this.state='reconnecting';this.#reconnectTimer=setTimeout(()=>{this.#reconnectTimer=undefined;this.#open()},delay);
  }
  #message(data:string){let msg:any;try{msg=JSON.parse(data)}catch{return;}
    if(msg.post_type==='meta_event'&&msg.meta_event_type==='heartbeat'){this.lastHeartbeatAt=Date.now();if(this.state==='online')void this.#checkStatus();return;}
    if(msg.echo&&this.#waiters.has(String(msg.echo))){const w=this.#waiters.get(String(msg.echo))!;clearTimeout(w.timer);this.#waiters.delete(String(msg.echo));if(msg.status==='ok'&&Number(msg.retcode??0)===0)w.resolve(msg);else w.reject(new Error(msg.message??`OneBot action failed (${msg.retcode??msg.status})`));return;}
    if(msg.post_type==='message'){this.lastEventAt=Date.now();this.emitEvent(this.events.next(msg,this.accountId));}
  }
  protected emitEvent(event:NormalizedEvent){this.onEvent?.(event)}
  onEvent?: (event:NormalizedEvent)=>void;
  async #rawAction(action:string,params:Record<string,unknown>={}, timeoutMs=10_000):Promise<any>{
    if(!this.#ws||this.#ws.readyState!==WebSocket.OPEN)throw new Error('OneBot connection is not open');
    const echo=randomUUID(); return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.#waiters.delete(echo);reject(new Error(`OneBot action timed out: ${action}`))},timeoutMs);this.#waiters.set(echo,{resolve,reject,timer});this.#ws!.send(JSON.stringify({action,params,echo}));});
  }
  async #action(action:string,params:Record<string,unknown>={}, timeoutMs=10_000):Promise<any>{if(this.state!=='online')throw new Error('OneBot connection is not authenticated and online');return this.#rawAction(action,params,timeoutMs);}
  async getLoginInfo(){return (await this.#action('get_login_info')).data;}
  async getStatus(){return (await this.#action('get_status')).data;}
  async readAction(action:string,params:Record<string,unknown>={}){if(!/^(get_msg|get_image|get_record|get_file|get_forward_msg|get_group_member_list|get_friend_list|get_group_list)$/.test(action))throw new Error('OneBot action is not an approved read operation');return (await this.#action(action,params)).data;}
  async getMessage(chatId:string,messageId:string){const r=await this.#action('get_msg',{message_id:messageId});const raw=r.data;if(!raw)return undefined;const event=this.events.next(raw,this.accountId);return event.chatId===chatId?event:undefined;}
  async callAction(action:string,params:Record<string,unknown>,authorized=false){if(!authorized)throw new Error('This OneBot action requires an authorized runtime request');if(!/^(send_like|set_group_ban|set_group_whole_ban|set_group_card|set_friend_add_request|set_group_add_request|set_self_longnick)$/.test(action))throw new Error('OneBot action is not allowed');return this.#action(action,params);}
  async setAccountSignature(longNick:string,ownerAuthorized=false){if(!ownerAuthorized)throw new Error('Only an owner-authorized request can change the account signature');if(typeof longNick!=='string'||longNick.length>60)throw new Error('Signature must be at most 60 characters');return this.#action('set_self_longnick',{longNick});}
  async sendMessage(params:{message_type:'private'|'group';user_id?:string;group_id?:string;message:unknown}, idempotencyKey:string=randomUUID()):Promise<SendReceipt>{
    const existing=this.#receipts.get(idempotencyKey);if(existing)return existing;
    const pending=(async()=>{try { const r=await this.#action('send_msg',{...params},15_000); const messageId=String(r.data?.message_id??'');if(!messageId)return {ok:false,status:'failed',error:'OneBot send response had no message_id',requestId:idempotencyKey} as SendReceipt;return {ok:true,status:'sent',messageId,requestId:idempotencyKey} as SendReceipt; }
      catch(e){const error=e instanceof Error?e.message:String(e);return {ok:false,status:/timed out|connection closed/i.test(error)?'uncertain':'failed',error,requestId:idempotencyKey} as SendReceipt;}})();
    this.#receipts.set(idempotencyKey,pending);return pending;
  }
  async stop(){this.#stopped=true;this.state='stopped';this.#clearHeartbeat();if(this.#reconnectTimer)clearTimeout(this.#reconnectTimer);this.#reconnectTimer=undefined;if(!this.#isReady)this.#readyReject?.(new Error('Transport stopped'));this.#rejectWaiters(new Error('Transport stopped'));this.#ws?.close();}
}
