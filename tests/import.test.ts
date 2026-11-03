// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {PetStore} from '../src/store.ts';
import {importLegacy} from '../scripts/import-legacy.ts';

function fixtureRoot(root:string,config:any){
 mkdirSync(path.join(root,'gallery','images'),{recursive:true});mkdirSync(path.join(root,'stickers'),{recursive:true});writeFileSync(path.join(root,'config.json'),JSON.stringify(config));
}
test('legacy importer separates pets, maps scopes/provenance and is idempotent',async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'legacy-import-')),dest=path.join(root,'new-data'),main=path.join(root,'pet_a'),fish=path.join(root,'fish');fixtureRoot(main,{self:'100000001',master:'100000003',botName:'示例宠物A',persona:'cat persona',apiKey:'do-not-import',live:true,proactiveReply:true,videoFrames:5,imageStyle:'style',imageAnchor:'anchor'});fixtureRoot(fish,{self:'100000002',master:'100000003',botName:'示例宠物B',persona:'fish persona',apiKey:'another-secret'});
 try{
  const imgA=await sharp({create:{width:3,height:2,channels:3,background:'#1484d6'}}).png().toBuffer(),imgB=await sharp({create:{width:2,height:3,channels:3,background:'#be41a1'}}).png().toBuffer();const mediaFile=path.join(main,'media','archive.png');mkdirSync(path.dirname(mediaFile),{recursive:true});writeFileSync(mediaFile,imgA);const galleryFile=path.join(main,'gallery','images','persona.png');writeFileSync(galleryFile,imgB);const stickerFile=path.join(main,'stickers','react.png');writeFileSync(stickerFile,imgB);
  const ad=new DatabaseSync(path.join(main,'agent.db'));ad.exec(`CREATE TABLE memories(id INTEGER PRIMARY KEY,scope TEXT,chat_key TEXT,subject TEXT,kind TEXT,text TEXT,vec BLOB,importance REAL,created_at TEXT,last_used_at TEXT,use_count INTEGER);CREATE TABLE profiles(chat_key TEXT PRIMARY KEY,name TEXT,summary TEXT,updated_at TEXT);CREATE TABLE messages(id INTEGER PRIMARY KEY,chat_key TEXT,msg_id TEXT,direction TEXT,sender_id TEXT,sender_name TEXT,text TEXT,ts TEXT);CREATE TABLE stickers(id INTEGER PRIMARY KEY,file TEXT,sha TEXT,tags TEXT,source TEXT,chat_key TEXT,created_at TEXT);`);
  ad.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(1,'person','uid:1234',null,'preference','likes green tea',null,0.8,'2025-01-02T03:04:05.000Z',null,0);ad.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(2,'group','group:99',null,'event','group agreed to meet',null,0.7,'2025-02-03T04:05:06.000Z',null,0);ad.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(3,'global',null,null,'fact','the pet likes naps',null,0.9,'2025-03-04T05:06:07.000Z',null,0);
  ad.prepare('INSERT INTO profiles VALUES(?,?,?,?)').run('uid:1234','Tea Friend','prefers tea','2025-04-05T06:07:08.000Z');ad.prepare('INSERT INTO stickers VALUES(?,?,?,?,?,?,?)').run(1,stickerFile,null,'funny,hello','group','group:99','2025-05-06T07:08:09.000Z');ad.close();
  const hd=new DatabaseSync(path.join(main,'history.db'));hd.exec('CREATE TABLE archive(id INTEGER PRIMARY KEY,chat TEXT,mid TEXT,sender TEXT,name TEXT,ts TEXT,text TEXT,raw TEXT,analysis TEXT DEFAULT "",UNIQUE(chat,mid))');const raw=JSON.stringify({message:[{type:'image',data:{_archivedFile:mediaFile,file:'legacy-image.png',description:'old image'}}]});hd.prepare('INSERT INTO archive VALUES(?,?,?,?,?,?,?,?,?)').run(1,'group:99','msg-1','4321','Sender','2025-06-07T08:09:10.000Z','',raw,'');hd.close();
  const gd=new DatabaseSync(path.join(main,'gallery','gallery.db'));gd.exec('CREATE TABLE images(id INTEGER PRIMARY KEY,hash TEXT,file TEXT,kind TEXT,scope TEXT,title TEXT,description TEXT,prompt TEXT,refs TEXT,created TEXT,vec BLOB)');gd.prepare('INSERT INTO images VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(1,'ignored','images/persona.png','persona','public','Persona image','source description','private prompt','[]','2025-07-08T09:10:11.000Z',null);gd.close();
  const first=await importLegacy(main,dest),second=await importLegacy(fish,dest);assert.equal(first.petId,'qq-100000001');assert.equal(second.petId,'qq-100000002');assert.equal(first.imported.pets,1);assert.equal(second.imported.pets,1);
  const store=new PetStore(dest);try{
   const pets=store.listPets();assert.equal(pets.length,2);const p=store.getPet('qq-100000001');assert.equal(p.name,'示例宠物A');assert.equal(p.accountId,'100000001');assert.equal(p.prompts.persona,'cat persona');assert.equal(p.settings.paused,true);assert.equal(p.settings.masterId,'100000003');assert.equal(p.settings.imageAnchor,'anchor');assert.equal(JSON.stringify(p).includes('do-not-import'),false);
   assert.equal(store.getPet('qq-100000002').prompts.persona,'fish persona');assert.equal(store.listPeople(p.id)[0].id,'1234');
   const memories=store.listMemories(p.id,{includeHidden:true});assert.equal(memories.find(m=>m.text==='likes green tea')?.personId,'1234');assert.equal(memories.find(m=>m.text==='likes green tea')?.scope,'person');assert.equal(memories.find(m=>m.text==='group agreed to meet')?.scope,'group:99');assert.equal(memories.find(m=>m.text==='the pet likes naps')?.scope,'public');assert.equal(memories.find(m=>m.text==='likes green tea')?.createdAt,'2025-01-02T03:04:05.000Z');
   const msg=store.listMessages(p.id,{chatId:'group:99'})[0];assert.equal(msg.id,'msg-1');assert.equal(msg.senderId,'4321');assert.equal(msg.senderName,'Sender');assert.equal(msg.sentAt,'2025-06-07T08:09:10.000Z');assert.equal(msg.segments[0].type,'image');assert.ok(msg.segments[0].assetId);const asset=store.getAsset(p.id,msg.segments[0].assetId);assert.equal(asset.scope,'private');
   assert.equal(store.listAssets(p.id,{kind:'gallery',includeHidden:true}).find(a=>a.title==='Persona image')?.scope,'public');assert.equal(store.listAssets(p.id,{kind:'sticker',includeHidden:true})[0]?.scope,'group:99');
   const retry=await importLegacy(main,dest);assert.equal(retry.imported.pets,0);assert.equal(retry.imported.messages,0);assert.equal(retry.imported.memories,0);assert.equal(retry.imported.people,0);assert.equal(store.listMessages(p.id,{chatId:'group:99'}).length,1);
  }finally{store.close()}
 }finally{rmSync(root,{recursive:true,force:true})}
});
