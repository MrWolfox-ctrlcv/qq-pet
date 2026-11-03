// SPDX-License-Identifier: Apache-2.0
import path from 'node:path';
import {parseArgs} from 'node:util';
import {PetStore} from '../src/store.ts';
import {PrivateConfig} from '../src/private-config.ts';

const {values}=parseArgs({options:{account:{type:'string'},owner:{type:'string'},name:{type:'string'},'data-dir':{type:'string'}}});
if(!/^[1-9]\d{4,11}$/.test(values.account||'')||!/^[1-9]\d{4,11}$/.test(values.owner||''))throw new Error('Provide --account <QQ number> --owner <owner QQ number> [--name <name>]');
const dataDir=path.resolve(values['data-dir']||process.env.PET_DATA_DIR||'data'),store=new PetStore(dataDir),id='qq-'+values.account;
try{
  if(store.listPets().some(p=>p.id===id))throw new Error('This account already has a pet; edit it in the panel');
  store.createPet({id,name:values.name||'My Pet',accountId:values.account,prompts:{persona:'你是一个有自己性格的聊天伙伴。按发送者和消息来源理解聊天，如实说明工具结果，不编造已经执行的操作。'},settings:{masterId:values.owner,paused:true,proactiveReply:false,decisionIntervalMs:15000,proactiveCooldownMs:45000,profileSummaryEnabled:false,profileSummaryMessageCount:20,profileSummaryIdleMinutes:5,toolsEnabled:false}});
  new PrivateConfig(dataDir).set(id,{connection:{provider:'onebot',enabled:false,live:false},model:{decisionModel:'gemini-3.5-flash-lite',visionModel:'gemini-3.5-flash-lite',imageProvider:'chat'}});
  console.log(JSON.stringify({petId:id,paused:true,live:false,dataDir}));
}finally{store.close();}
