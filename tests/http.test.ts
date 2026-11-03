// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createApp} from '../src/server.ts';

test('HTTP auth, CSRF, conflicts, pet isolation, media validation and size limits',async()=>{
 const dataDir=mkdtempSync(path.join(os.tmpdir(),'pet-http-')),app=createApp({dataDir});
 await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',()=>r()));const address=app.server.address() as any,base=`http://127.0.0.1:${address.port}`;
 const req=(url:string,init:any={})=>fetch(base+url,init);
 try{
  assert.equal((await req('/api/health')).status,200);assert.equal((await req('/')).status,200);assert.equal((await req('/api/pets')).status,401);
  const token=(await import('node:fs')).readFileSync(app.auth.tokenPath,'utf8').trim();const login=await req('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0],csrf=(await login.json() as any).data.csrfToken;
  const headers={'content-type':'application/json',cookie,'x-csrf-token':csrf};const a=app.store.createPet({id:'a',name:'A'}),b=app.store.createPet({id:'b',name:'B'});
  app.store.createPerson(a.id,{id:'same-qq',displayName:'A person'});app.store.createPerson(b.id,{id:'same-qq',displayName:'B person'});
  assert.equal((await req('/api/pets/b/people/same-qq',{method:'PATCH',headers,body:JSON.stringify({version:1,displayName:'Updated B'})})).status,200);assert.equal(app.store.listPeople(a.id)[0].displayName,'A person');assert.equal(app.store.listPeople(b.id)[0].displayName,'Updated B');
  const connection=await req('/api/pets/a/connection',{headers});assert.deepEqual(Object.keys((await connection.json() as any).data).sort(),['connection','model']);
  const status=await req('/api/pets/a/status',{headers});assert.equal(status.status,200);const preview=await req('/api/pets/a/preview',{method:'POST',headers,body:JSON.stringify({text:'本地预览'})});assert.equal(preview.status,200);assert.equal((await preview.json() as any).data.modelCalled,false);
  assert.equal((await req('/api/pets/a',{method:'PATCH',headers:{'content-type':'application/json',cookie},body:JSON.stringify({version:1,name:'bad'})})).status,403);
  assert.equal((await req('/api/pets/a',{method:'PATCH',headers:{...headers,origin:'http://evil.invalid'},body:JSON.stringify({version:1,name:'bad'})})).status,403);
  const patch=await req('/api/pets/a',{method:'PATCH',headers,body:JSON.stringify({version:1,name:'A2'})});assert.equal(patch.status,200);
  assert.equal((await req('/api/pets/a',{method:'PATCH',headers,body:JSON.stringify({version:1,name:'stale'})})).status,409);
  const png=await sharp({create:{width:2,height:2,channels:3,background:'#ff0000'}}).png().toBuffer();const upload=await req('/api/pets/a/assets',{method:'POST',headers,body:JSON.stringify({base64:png.toString('base64'),kind:'gallery',category:'reference',title:'test',tags:[],scope:'private'})});assert.equal(upload.status,201);const asset=(await upload.json() as any).data;
  assert.equal((await req(`/api/assets/${asset.id}/media?petId=b`,{headers})).status,404);
  assert.equal((await req('/api/pets/a/assets',{method:'POST',headers,body:JSON.stringify({base64:Buffer.alloc(13*1024*1024).toString('base64')})})).status,413);
  assert.equal((await req(`/api/assets/${asset.id}/media?petId=a`,{headers})).status,200);
  assert.equal((await req(`/api/pets/a/assets/${asset.id}/media`,{headers})).status,200);
  assert.equal((await req('/api/assets/%2e%2e%2fadmin-token.txt/media?petId=a',{headers})).status,404);
  const cfg=await req('/api/pets/a/private-config',{method:'PATCH',headers,body:JSON.stringify({model:{apiKey:'secret-never-return',baseUrl:'https://model.invalid',chatModel:'test'}})});assert.equal(cfg.status,200);assert.equal(JSON.stringify(await cfg.json()).includes('secret-never-return'),false);
  const backup=await req('/api/backups',{method:'POST',headers,body:'{}'});assert.equal(backup.status,201);const backupId=(await backup.json() as any).data.id;
  assert.equal((await req(`/api/backups/${backupId}/restore`,{method:'POST',headers,body:'{}'})).status,400);
  await req('/api/pets/a',{method:'PATCH',headers,body:JSON.stringify({version:2,name:'after-backup'})});
  const restored=await req(`/api/backups/${backupId}/restore`,{method:'POST',headers,body:JSON.stringify({confirmation:'RESTORE'})});assert.equal(restored.status,200);
  assert.equal((await (await req('/api/pets/a',{headers})).json() as any).data.name,'A2');
 }finally{await app.close();rmSync(dataDir,{recursive:true,force:true})}
});
