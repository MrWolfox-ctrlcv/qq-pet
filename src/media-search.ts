// SPDX-License-Identifier: Apache-2.0
type Asset=Record<string,any>;
type Rank=(assets:Asset[])=>Promise<Asset[]>;
// The caller must filter visibility first. Exact catalog keys and literal
// subject words must not be discarded by an embedding similarity threshold.
export async function selectMediaCandidates(visible:Asset[],kind:'gallery'|'sticker',query:string,rank:Rank,limit=4){
  const q=query.trim().toLocaleLowerCase();
  const numbered=/^(图|表|#)?(\d+)$/.exec(q);
  if(numbered){if(numbered[1]==='图'&&kind!=='gallery'||numbered[1]==='表'&&kind!=='sticker')return [];return visible.filter(a=>a.number===Number(numbered[2])).slice(0,1);}
  const byId=visible.find(a=>a.id===q);if(byId)return [byId];
  const persona=kind==='gallery'&&/人设|设定图|立绘|头像|猫娘|猫耳娘|你自己|你的(?:图|照片|样子|形象)/.test(q);
  const candidates=persona?visible.filter(a=>a.category==='persona'):visible;
  if(persona)return candidates.slice(0,limit);
  const browse=!q||/^(?:随机|随便|任选|任意|随意|来一张|发一张|图库|图片|照片|图)(?:的|一张|一个|发一张|图片|照片|图)?$/.test(q);
  if(browse)return [...candidates].sort((a,b)=>Number(b.category==='drawing')-Number(a.category==='drawing')||Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,limit);
  const exact=q.length>=2?candidates.filter(a=>[a.title,...a.tags,a.description].some(v=>String(v).toLocaleLowerCase().includes(q))):[];
  if(exact.length)return exact.slice(0,limit);
  return (await rank(candidates)).slice(0,limit);
}
