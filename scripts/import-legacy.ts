// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PetStore } from '../src/store.ts';

type Report={source:string;petId:string;imported:Record<string,number>;skipped:string[];errors:string[]};
const safeReadJson=(file:string)=>{try{return JSON.parse(readFileSync(file,'utf8'))}catch{return {}}};
const tables=(db:DatabaseSync)=>new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(r=>r.name));
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const safeScope=(value:unknown)=>{const s=String(value||'');if(s==='public'||s==='private'||s.startsWith('group:'))return s;if(s.startsWith('private:'))return 'private';return 'private'};
const legacyTags=(value:unknown)=>{const text=String(value||'');try{const parsed=JSON.parse(text);if(Array.isArray(parsed))return parsed.map(String)}catch{}return text.split(',').map(x=>x.trim()).filter(Boolean)};
const stableId=(scope:string,chatKey:string|null)=>{
  if(scope==='global')return {scope:'public',personId:null};
  const key=String(chatKey||'');
  if(scope==='person')return {scope:'person',personId:key.startsWith('uid:')?key.slice(4):key||null};
  if(scope==='group')return {scope:key.startsWith('group:')?key:`group:${key}`,personId:null};
  if(key.startsWith('uid:'))return {scope:'person',personId:key.slice(4)};
  if(key.startsWith('group:'))return {scope:key,personId:null};
  return {scope:safeScope(scope),personId:null};
};
const petDefaults=(cfg:any)=>{
  const accountId=String(cfg.self||'').trim();if(!accountId)throw new Error('Legacy config is missing self QQ ID');
  const name=String(cfg.botName||'Imported Pet');
  return {id:`qq-${accountId}`,name,accountId,prompts:{persona:String(cfg.persona||'')},settings:{masterId:String(cfg.master||''),proactiveReply:!!cfg.proactiveReply,videoFrames:Number(cfg.videoFrames||4),videoAudioSeconds:Number(cfg.videoAudioSeconds||0),imageStyle:String(cfg.imageStyle||''),imageAnchor:String(cfg.imageAnchor||''),paused:true}};
};

function findLegacyFile(source:string,rawPath:unknown,extraRoots:string[]=[]):string|undefined{
  const text=String(rawPath||'').trim();if(!text)return undefined;
  const root=path.resolve(source),roots=[root,...extraRoots.map(r=>path.resolve(r))];
  const candidates=[path.isAbsolute(text)?path.resolve(text):path.resolve(root,text)];
  const base=path.basename(text);
  for(const folder of ['media','gallery','gallery/images','stickers','stickers/images'])candidates.push(path.join(root,folder,base));
  for(const candidate of candidates){const resolved=path.resolve(candidate);if(roots.some(r=>resolved===r||resolved.startsWith(r+path.sep))&&existsSync(resolved))return resolved;}
  return undefined;
}
function chatForArchive(chat:string){return chat.startsWith('group:')||chat.startsWith('private:')?chat:`legacy:${chat}`;}
async function rawSegments(raw:string,source:string,petId:string,store:PetStore,report:Report,chatId:string){
  let parsed:any={};try{parsed=JSON.parse(raw||'{}')}catch{}
  const segs=Array.isArray(parsed.message)?parsed.message:[];const result:any[]=[];
  for(const seg of segs){const type=String(seg?.type||'');const data=seg?.data||{};
    if(type==='text'){result.push({type:'text',text:String(data.text||'')});continue;}
    const mapped=type==='image'?'image':type==='record'?'audio':type==='video'?'video':type==='file'?'file':null;if(!mapped)continue;
    const file=findLegacyFile(source,data._archivedFile||data.file||data.url);
    if(file&&mapped==='image'){
      try{const bytes=readFileSync(file);const scope='private';const existing=store.listAssets(petId,{includeHidden:true}).find((a:any)=>a.hash===sha(bytes)&&a.scope===scope);const asset=existing||await store.importAsset(petId,{bytes,kind:'gallery',category:'reference',title:path.basename(file),description:String(data.description||''),scope});
        // Legacy chat uploads stay private and retain source message author/time on their message occurrence.
        result.push({type:'image',assetId:asset.id,sourceFile:path.basename(file),description:data.description||null,sourceChatId:chatId});
      }catch(e:any){report.errors.push(`message image ${path.basename(file)}: ${e.message}`);result.push({type:'image',sourceFile:path.basename(file)})}
    }else result.push({type:mapped,fileName:String(data.file||data.name||''),url:undefined});
  }
  return result;
}

export async function importLegacy(sourceDir:string,targetDir:string):Promise<Report>{
  const source=path.resolve(sourceDir),target=path.resolve(targetDir);if(!existsSync(source))throw new Error(`Legacy source not found: ${source}`);
  const config=safeReadJson(path.join(source,'config.json'));const petInput=petDefaults(config);const store=new PetStore(target);
  const report:Report={source,petId:petInput.id,imported:{pets:0,memories:0,people:0,messages:0,stickers:0,gallery:0},skipped:[],errors:[]};
  try{
    try{store.getPet(petInput.id);report.skipped.push(`pet ${petInput.id} already present`)}catch{store.createPet(petInput);report.imported.pets=1;}
    const pet=store.getPet(petInput.id),agentDb=path.join(source,'agent.db');
    const importedMessageKeys=new Set<string>();
    const historyFile=path.join(source,'history.db');
    if(existsSync(historyFile)){
      const db=new DatabaseSync(historyFile,{readOnly:true});try{const ts=tables(db);if(ts.has('archive'))for(const r of db.prepare('SELECT * FROM archive ORDER BY id').all() as any[]){try{
        const chatId=chatForArchive(String(r.chat||'legacy')),id=String(r.mid||`archive-${r.id}`),receivedAt=String(r.ts||new Date(0).toISOString());
        const key=`${chatId}\0${id}`;if(store.db.prepare('SELECT 1 FROM messages WHERE pet_id=? AND chat_id=? AND id=?').get(pet.id,chatId,id)){importedMessageKeys.add(key);report.skipped.push(`duplicate message ${id}`);continue;}
        let raw:any={};try{raw=JSON.parse(r.raw||'{}')}catch{}const segments=await rawSegments(String(r.raw||'{}'),source,pet.id,store,report,chatId);if(!segments.length&&r.text)segments.push({type:'text',text:String(r.text)});
        const reply=Array.isArray(raw.message)?raw.message.find((s:any)=>s.type==='reply')?.data?.id:undefined;
        const senderId=String(r.sender||'');store.putMessage(pet.id,{id,chatId,senderId,senderName:String(r.name||''),sentAt:receivedAt,receivedAt,replyTo:reply?String(reply):undefined,segments,direction:senderId===pet.accountId?'out':'in'});importedMessageKeys.add(key);report.imported.messages++;
      }catch(e:any){report.errors.push(`history message ${r.mid||r.id}: ${e.message}`)}}}finally{db.close()}
    }
    if(existsSync(agentDb)){
      const db=new DatabaseSync(agentDb,{readOnly:true});try{const ts=tables(db);
        if(ts.has('memories'))for(const row of db.prepare('SELECT * FROM memories ORDER BY id').all() as any[]){try{
          const text=String(row.text||'').trim();if(!text)continue;const mapped=stableId(String(row.scope||''),row.chat_key==null?null:String(row.chat_key));
          const exists=store.listMemories(pet.id,{includeHidden:true}).some((m:any)=>m.text===text&&m.kind===String(row.kind||'fact')&&m.personId===mapped.personId&&m.scope===mapped.scope);
          if(exists){report.skipped.push(`duplicate memory ${row.id}`);continue;}
          const memory=store.createMemory(pet.id,{text,personId:mapped.personId,scope:mapped.scope,kind:String(row.kind||'fact'),confidence:Number.isFinite(Number(row.importance))?Math.max(0,Math.min(1,Number(row.importance))):0.5,sourceMessageIds:[]});
          if(row.created_at)store.db.prepare('UPDATE memories SET created_at=? WHERE id=? AND pet_id=?').run(String(row.created_at),memory.id,pet.id);
          report.imported.memories++;
        }catch(e:any){report.errors.push(`memory ${row.id}: ${e.message}`)}}
        if(ts.has('profiles'))for(const row of db.prepare('SELECT * FROM profiles').all() as any[]){const rawId=String(row.chat_key||''),id=rawId.startsWith('uid:')?rawId.slice(4):rawId;if(!id)continue;try{store.createPerson(pet.id,{id,displayName:String(row.name||id),aliases:[],fields:{profile:String(row.summary||'')},lockedFields:[]});if(row.updated_at)store.db.prepare('UPDATE people SET updated_at=? WHERE pet_id=? AND id=?').run(String(row.updated_at),pet.id,id);report.imported.people++}catch{report.skipped.push(`profile ${id} already present`)}}
        if(ts.has('messages'))for(const row of db.prepare('SELECT * FROM messages ORDER BY id').all() as any[]){try{const chatId=chatForArchive(String(row.chat_key||'legacy')),id=String(row.msg_id||`legacy-${row.id}`),key=`${chatId}\0${id}`;if(importedMessageKeys.has(key)||store.db.prepare('SELECT 1 FROM messages WHERE pet_id=? AND chat_id=? AND id=?').get(pet.id,chatId,id)){report.skipped.push(`duplicate message ${id}`);continue;}const sentAt=String(row.ts||new Date(0).toISOString());store.putMessage(pet.id,{id,chatId,senderId:String(row.sender_id||''),senderName:String(row.sender_name||''),sentAt,receivedAt:sentAt,direction:row.direction==='out'?'out':'in',segments:row.text?[{type:'text',text:String(row.text)}]:[]});report.imported.messages++;}catch(e:any){report.errors.push(`message ${row.id}: ${e.message}`)}}
        if(ts.has('stickers'))for(const row of db.prepare('SELECT * FROM stickers').all() as any[]){const file=findLegacyFile(source,row.file);if(!file){report.skipped.push(`sticker file unavailable: ${path.basename(String(row.file||''))}`);continue;}try{const bytes=readFileSync(file),hash=sha(bytes),scope=safeScope(row.chat_key||row.source||'public');if(store.listAssets(pet.id,{kind:'sticker',includeHidden:true}).some((a:any)=>a.hash===hash&&a.scope===scope)){report.skipped.push(`duplicate sticker ${path.basename(file)}`);continue;}
          const asset=await store.importAsset(pet.id,{bytes,kind:'sticker',category:'sticker',title:path.basename(file),tags:legacyTags(row.tags),scope});
          if(row.created_at)store.db.prepare('UPDATE assets SET created_at=? WHERE pet_id=? AND id=?').run(String(row.created_at),pet.id,asset.id);report.imported.stickers++;
        }catch(e:any){report.errors.push(`sticker ${path.basename(file)}: ${e.message}`)}}
      }finally{db.close()}
    }
    const galleryDb=path.join(source,'gallery','gallery.db');if(existsSync(galleryDb)){
      const db=new DatabaseSync(galleryDb,{readOnly:true});try{if(tables(db).has('images'))for(const row of db.prepare('SELECT * FROM images ORDER BY id').all() as any[]){const file=findLegacyFile(source,row.file);if(!file){report.skipped.push(`gallery file unavailable: ${path.basename(String(row.file||''))}`);continue;}try{const bytes=readFileSync(file),hash=sha(bytes);if(store.listAssets(pet.id,{kind:'gallery',includeHidden:true}).some((a:any)=>a.hash===hash&&a.scope===safeScope(row.scope))){report.skipped.push(`duplicate gallery ${path.basename(file)}`);continue;}
        const category=['persona','drawing','reference'].includes(row.kind)?row.kind:'reference';const asset=await store.importAsset(pet.id,{bytes,kind:'gallery',category,title:String(row.title||path.basename(file)),description:String(row.description||''),scope:safeScope(row.scope)});
        if(row.created)store.db.prepare('UPDATE assets SET created_at=? WHERE pet_id=? AND id=?').run(String(row.created),pet.id,asset.id);report.imported.gallery++;
      }catch(e:any){report.errors.push(`gallery ${path.basename(file)}: ${e.message}`)}}}finally{db.close()}
    }
    // Recover common legacy media folders even when a gallery DB reference was lost.
    for(const folder of ['gallery/images']){const dir=path.join(source,folder);if(!existsSync(dir))continue;for(const file of readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()).map(e=>path.join(dir,e.name))){if(!/\.(jpe?g|png|webp|gif)$/i.test(file))continue;try{const bytes=readFileSync(file),hash=sha(bytes);if(store.listAssets(pet.id,{kind:'gallery',includeHidden:true}).some((a:any)=>a.hash===hash)){report.skipped.push(`duplicate gallery file ${path.basename(file)}`);continue;}await store.importAsset(pet.id,{bytes,kind:'gallery',category:'reference',title:path.basename(file),scope:'private'});report.imported.gallery++;}catch(e:any){report.errors.push(`gallery file ${path.basename(file)}: ${e.message}`)}}}
    return report;
  }finally{store.close()}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const source=process.argv[2],target=process.argv[3]||'./data';
  if(!source)throw new Error('Usage: node scripts/import-legacy.ts <legacy-directory> [data-directory]');
  const report=await importLegacy(source,target);console.log(JSON.stringify(report,null,2));
}
