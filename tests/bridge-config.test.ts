// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {PetStore} from '../src/store.ts';
import {PrivateConfig} from '../src/private-config.ts';

test('public setup creates isolated account configs without enabling live messages or printing tokens',t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'qq-pet-public-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const run=(script:string,args:string[])=>execFileSync(process.execPath,[script,...args,'--data-dir',directory],{encoding:'utf8'});
  run('scripts/create-pet.ts',['--account','100000001','--owner','100000003']);
  run('scripts/create-pet.ts',['--account','100000002','--owner','100000003']);
  const output=run('scripts/setup-native-bridge.ts',['--account','100000001','--port','4440']);
  run('scripts/setup-native-bridge.ts',['--account','100000002','--port','4442']);
  const a=JSON.parse(readFileSync(path.join(directory,'bridges','100000001','config.json'),'utf8')),b=JSON.parse(readFileSync(path.join(directory,'bridges','100000002','config.json'),'utf8'));
  assert.equal(a.dataDir,directory);assert.notEqual(a.accessToken,b.accessToken);assert.equal(output.includes(a.accessToken),false);
  const store=new PetStore(directory);try{assert.equal(store.getPet('qq-100000001').settings.paused,true);assert.equal(store.getPet('qq-100000002').settings.masterId,'100000003')}finally{store.close()}
  const config=new PrivateConfig(directory);assert.equal(config.get('qq-100000001').connection.live,false);assert.equal(config.get('qq-100000002').connection.wsUrl,'ws://127.0.0.1:4442');
});
