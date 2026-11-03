// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { PetStore } from './store.ts';

export type SemanticCandidate={id:string;text:string;[key:string]:unknown};
export type RankedCandidate<T extends SemanticCandidate=SemanticCandidate>=T&{score:number;matchMode:'vector'|'lexical'};
export type SemanticOptions={modelDir?:string;embed?:(text:string)=>Promise<number[]|Float32Array>;minSimilarity?:number;minLexicalScore?:number};
type Pipeline=(text:string,options?:Record<string,unknown>)=>Promise<any>;
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
function normalize(v:ArrayLike<number>){const vector=Array.from(v,Number);const norm=Math.sqrt(vector.reduce((n,x)=>n+x*x,0));return norm?vector.map(x=>x/norm):vector}
function cosine(a:number[],b:number[]){if(!a.length||a.length!==b.length)return 0;return a.reduce((n,x,i)=>n+x*b[i],0)}
function terms(text:string){const out=new Set<string>();for(const word of text.toLocaleLowerCase().match(/[a-z0-9]{2,}/g)??[])out.add(word);for(const phrase of text.toLocaleLowerCase().match(/\p{Script=Han}+/gu)??[]){const chars=Array.from(phrase);if(chars.length===1)out.add(chars[0]);for(let i=0;i+1<chars.length;i++)out.add(chars.slice(i,i+2).join(''));for(let i=0;i+2<chars.length;i++)out.add(chars.slice(i,i+3).join(''))}return out}
function lexicalScore(query:string,text:string){const q=terms(query),d=terms(text);if(!q.size||!d.size)return 0;let overlap=0;for(const t of q)if(d.has(t))overlap++;const coverage=overlap/q.size;const precision=overlap/d.size;const phrase=query.trim().length>2&&text.toLocaleLowerCase().includes(query.toLocaleLowerCase())?0.2:0;return Math.min(1,coverage*0.75+precision*0.25+phrase)}

/** Local-first semantic matching with persisted pet/entity vectors and a clearly reported lexical fallback. */
export class SemanticIndex {
  readonly store:PetStore;readonly options:SemanticOptions;readonly modelDir?:string;
  #pipeline?:Promise<Pipeline>;#embedder?:Pipeline;#mode:'local-vector'|'lexical-fallback';#reason?:string;
  constructor(store:PetStore,options:SemanticOptions={}){this.store=store;this.options=options;this.modelDir=options.modelDir?path.resolve(options.modelDir):path.join(store.dataDir,'models','bge-small-zh-v1.5');this.#mode=options.embed?'local-vector':'lexical-fallback';this.#reason=options.embed?undefined:existsSync(this.modelDir)?undefined:'Local BGE model files are not installed';
    store.db.exec(`CREATE TABLE IF NOT EXISTS semantic_vectors(pet_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,text_signature TEXT NOT NULL,vector TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(pet_id,entity_type,entity_id))`);
  }
  status(){return {mode:this.#mode,model:'bge-small-zh-v1.5',modelDir:this.modelDir,reason:this.#reason,remoteModelDownloads:false,apiCalls:false}}
  async #getEmbedder():Promise<Pipeline>{
    if(this.options.embed)return async text=>normalize(await this.options.embed!(text));
    if(!existsSync(this.modelDir!))throw new Error('Local BGE model files are not installed');
    if(!this.#pipeline){this.#pipeline=(async()=>{const dynamicImport=new Function('name','return import(name)') as (name:string)=>Promise<any>;const lib=await dynamicImport('@huggingface/transformers');lib.env.allowRemoteModels=false;lib.env.localModelPath=this.modelDir;const pipe=await lib.pipeline('feature-extraction',this.modelDir,{dtype:'q8'});return async(text:string)=>{const tensor=await pipe(text,{pooling:'mean',normalize:true});return Array.from(tensor.data as ArrayLike<number>)}})()}
    return this.#pipeline;
  }
  async #vector(petId:string,type:string,candidate:SemanticCandidate,embed:Pipeline){const signature=hash(candidate.text);const row=this.store.db.prepare('SELECT text_signature,vector FROM semantic_vectors WHERE pet_id=? AND entity_type=? AND entity_id=?').get(petId,type,candidate.id) as any;if(row?.text_signature===signature){try{return JSON.parse(row.vector) as number[]}catch{}}
    const vector=normalize(await embed(candidate.text.slice(0,8000)));if(!vector.length||vector.some(x=>!Number.isFinite(x)))throw new Error('Embedding model returned an invalid vector');this.store.db.prepare('INSERT INTO semantic_vectors VALUES(?,?,?,?,?,?) ON CONFLICT(pet_id,entity_type,entity_id) DO UPDATE SET text_signature=excluded.text_signature,vector=excluded.vector,updated_at=excluded.updated_at').run(petId,type,candidate.id,signature,JSON.stringify(vector),new Date().toISOString());return vector;
  }
  async rank<T extends SemanticCandidate>(petId:string,entityType:string,query:string,candidates:readonly T[],limit=10):Promise<Array<RankedCandidate<T>>>{
    this.store.getPet(petId);const q=query.trim();if(!q||!candidates.length)return [];if(!/^[a-z][a-z0-9_-]{0,39}$/i.test(entityType))throw new Error('Invalid semantic entity type');if(candidates.length>2000)throw new Error('Too many semantic candidates');
    try{const embed=await this.#getEmbedder();const qv=normalize(await embed(q.slice(0,8000)));const scored=await Promise.all(candidates.map(async c=>({candidate:c,score:cosine(qv,await this.#vector(petId,entityType,c,embed))})));this.#mode='local-vector';this.#reason=undefined;return scored.filter(x=>x.score>=(this.options.minSimilarity??0.25)).sort((a,b)=>b.score-a.score).slice(0,Math.max(1,Math.min(100,limit))).map(x=>({...x.candidate,score:x.score,matchMode:'vector' as const}));}
    catch(error){this.#mode='lexical-fallback';this.#reason=error instanceof Error?error.message:'Local embedding model unavailable';const scored=candidates.map(candidate=>({candidate,score:lexicalScore(q,candidate.text)})).filter(x=>x.score>=(this.options.minLexicalScore??0.18)).sort((a,b)=>b.score-a.score);return scored.slice(0,Math.max(1,Math.min(100,limit))).map(x=>({...x.candidate,score:x.score,matchMode:'lexical' as const}));}
  }
}
