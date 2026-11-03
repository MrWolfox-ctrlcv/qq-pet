// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {parseArgs} from 'node:util';
import {PetStore} from '../src/store.ts';
import {PrivateConfig} from '../src/private-config.ts';

const {values}=parseArgs({options:{account:{type:'string'},port:{type:'string'},'data-dir':{type:'string'}}});
const account=values.account||'',port=Number(values.port||4440);
if(!/^[1-9]\d{4,11}$/.test(account)||!Number.isInteger(port)||port<1024||port>65535)throw new Error('Provide --account <QQ number> [--port <1024..65535>]');
const dataDir=path.resolve(values['data-dir']||process.env.PET_DATA_DIR||'data'),store=new PetStore(dataDir),privateConfig=new PrivateConfig(dataDir),petId='qq-'+account;
try{
  if(store.getPet(petId).accountId!==account)throw new Error('Pet account mismatch');
  const used=Object.entries(privateConfig.config.pets).find(([id,c])=>id!==petId&&[c.connection.httpUrl,c.connection.wsUrl].some(url=>url&&Number(new URL(url).port)===port));
  if(used)throw new Error('Another pet already uses this port');
  const directory=path.join(dataDir,'bridges',account),file=path.join(directory,'config.json');
  if(fs.existsSync(file))throw new Error('Bridge config already exists; leaving its token and state unchanged');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});const token=randomBytes(32).toString('hex');
  fs.writeFileSync(file,JSON.stringify({accountId:account,port,accessToken:token,dataDir,sessionId:'nt_1',outboundEnabled:true,sendAllowlist:['private:*','group:*'],receiveAllowlist:['private:*','group:*']},null,2),{mode:0o600,flag:'wx'});
  privateConfig.set(petId,{connection:{provider:'onebot',httpUrl:'http://127.0.0.1:'+port,wsUrl:'ws://127.0.0.1:'+port,accessToken:token,enabled:true,live:false}});
  console.log(JSON.stringify({petId,configFile:file,port,live:false,tokenPrinted:false}));
}finally{store.close();}
