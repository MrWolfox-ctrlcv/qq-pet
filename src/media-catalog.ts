// SPDX-License-Identifier: Apache-2.0
import {createHash} from 'node:crypto';
import type {PetStore} from './store.ts';
import type {MediaTools} from './media.ts';
import type {NormalizedEvent} from './core/events.ts';
import {toolAllowed} from './tool-policy.ts';

type Row=Record<string,any>;
type Transport={readAction(action:string,params:Record<string,unknown>):Promise<any>};
export class MediaCatalog {
  readonly store:PetStore;readonly media:MediaTools;
  constructor(store:PetStore,media:MediaTools){this.store=store;this.media=media;}
  private info(petId:string,id:string){return this.store.db.prepare('SELECT * FROM media_catalog WHERE pet_id=? AND asset_id=?').get(petId,id) as Row;}
  private owner(petId:string,e:NormalizedEvent){return e.authorId===String(this.store.getPet(petId).settings.masterId||'');}
  private visible(petId:string,a:Row,e:NormalizedEvent){return a.petId===petId&&(this.owner(petId,e)||a.scope==='public'||a.scope===e.chatId);}
  private describe(a:Row){return {id:a.id,number:a.number,key:(a.kind==='sticker'?'表':'图')+a.number,kind:a.kind,title:a.title,tags:a.tags,description:a.description,scope:a.scope,hidden:a.hidden,version:a.version};}
  private target(petId:string,key:unknown,e:NormalizedEvent){
    const text=String(key??'').trim(),number=/^(?:图|表|#)?(\d+)$/.exec(text);
    const a=number?this.store.listAssets(petId,{includeHidden:true}).find(a=>a.number===Number(number[1])):this.store.getAsset(petId,text);
    if(!a || !this.visible(petId,a,e) || text.startsWith('图')&&a.kind!=='gallery' || text.startsWith('表')&&a.kind!=='sticker')throw new Error('素材不存在或不在本会话可访问范围内');return a;
  }
  private metadata(input:Row){
    const patch:Row={};
    for(const [key,limit] of [['title',120],['description',1200]] as const)if(input[key]!==undefined){if(typeof input[key]!=='string')throw new Error('标题和说明必须是文字');patch[key]=input[key].slice(0,limit);}
    if(input.tags!==undefined){if(!Array.isArray(input.tags)||input.tags.some((x:any)=>typeof x!=='string'))throw new Error('标签必须是文字数组');patch.tags=[...new Set(input.tags.map((x:string)=>x.trim().slice(0,32)).filter(Boolean))].slice(0,20);}
    return patch;
  }
  async execute(petId:string,input:Row,e:NormalizedEvent,transport:Transport){
    if(!toolAllowed(this.store.getPet(petId),'mediaManagement'))throw new Error('面板尚未开放素材管理工具');
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('素材工具参数格式无效');
    const kind=input.kind??'gallery';if(!['gallery','sticker'].includes(kind))throw new Error('素材类型必须是 gallery 或 sticker');
    if(input.op==='search'){
      const q=String(input.query||'').trim();
      const assets=this.store.listAssets(petId,{kind,includeHidden:!!input.includeHidden}).filter(a=>this.visible(petId,a,e));
      const filtered=assets.filter(a=>!q||[a.title,a.description,...a.tags,String(a.number),(a.kind==='sticker'?'表':'图')+a.number,a.id].some(value=>String(value).toLowerCase().includes(q.toLowerCase())));
      return {ok:true,total:filtered.length,assets:filtered.slice(0,12).map(a=>this.describe(a))};
    }
    if(input.op==='add'){
      const explicit=String(input.sourceMessageId||'');
      const sourceId=explicit || (input.source==='reply'||(!e.segments.some(s=>s.type==='image')&&e.replyTo)?e.replyTo:e.sourceId);
      if(!sourceId || ![e.sourceId,e.replyTo].includes(sourceId))throw new Error('只能收录当前消息或当前明确引用的图片');
      const source=sourceId===e.sourceId?{id:e.sourceId,senderId:e.authorId,segments:e.segments}:this.store.listMessages(petId,{chatId:e.chatId,limit:1000,beforeSequence:e.sequence+1}).find(m=>m.id===sourceId);
      if(!source)throw new Error('引用图片还未收到，请直接附图或重新引用图片');
      const images=source.segments.filter((s:Row)=>s.type==='image'),index=Number(input.image??1);
      if(!Number.isInteger(index)||index<1||index>images.length)throw new Error('来源消息中没有这张图片');
      const segment=images[index-1];
      const bytes=await this.media.incomingImageBytes(segment,transport);
      const hash=createHash('sha256').update(bytes).digest('hex');
      const scope=input.scope==='public'&&this.owner(petId,e)?'public':e.chatId;
      const duplicate=this.store.listAssets(petId,{kind,includeHidden:true}).find(a=>a.hash===hash&&a.scope===scope);
      if(duplicate)return {ok:true,alreadyExists:true,asset:this.describe(duplicate)};
      const observation=await this.media.analyzeIncomingMedia(petId,segment,{chatId:e.chatId,senderId:source.senderId,messageId:sourceId},transport);
      if(!toolAllowed(this.store.getPet(petId),'mediaManagement'))throw new Error('素材管理工具已关闭');
      const metadata=this.metadata(input);
      const asset=await this.store.importAsset(petId,{bytes,kind,category:kind==='sticker'?'sticker':'reference',scope,title:metadata.title||'收录图片',tags:metadata.tags||[],description:metadata.description||observation.description},'model:'+e.authorId);
      this.store.db.prepare('UPDATE media_catalog SET managed=1,source_chat=?,source_message=?,source_sender=? WHERE pet_id=? AND asset_id=?').run(e.chatId,sourceId,source.senderId,petId,asset.id);
      return {ok:true,asset:this.describe(asset),source:{chatId:e.chatId,messageId:sourceId,senderId:source.senderId}};
    }
    const asset=this.target(petId,input.id,e);
    if(input.op==='get')return {ok:true,asset:this.describe(asset)};
    const provenance=this.info(petId,asset.id);
    if(!this.owner(petId,e) && !(provenance?.managed && provenance.source_chat===e.chatId))throw new Error('只能整理自己在当前会话收录的素材；其他素材由主人管理');
    let patch:Row;
    if(input.op==='delete')patch={hidden:true};
    else if(input.op==='restore')patch={hidden:false};
    else if(input.op==='update'){
      if(!input.patch||typeof input.patch!=='object')throw new Error('缺少要修改的内容');
      patch=this.metadata(input.patch);
      if(input.patch.kind!==undefined){if(!['gallery','sticker'].includes(input.patch.kind))throw new Error('素材类型无效');patch.kind=input.patch.kind;patch.category=patch.kind==='sticker'?'sticker':'reference';}
      if(!Object.keys(patch).length)throw new Error('没有可修改的标题、标签、说明或类型');
    }else throw new Error('未知素材操作');
    const updated=this.store.updateAsset(petId,asset.id,patch,asset.version,'model:'+e.authorId);
    return {ok:true,operation:input.op,reversible:true,asset:this.describe(updated)};
  }
}
