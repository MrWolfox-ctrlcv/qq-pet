// SPDX-License-Identifier: Apache-2.0
// Apache-2.0. Prepare an existing image for the official client's send queue.
// No image-generation call, native imaging add-on, or remote URL download.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

function dimensions(bytes) {
  if(bytes.length>=24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),ext:'png',animated:false};
  if(bytes.length>=10 && /^GIF8[79]a$/.test(bytes.toString('ascii',0,6)))
    return {width:bytes.readUInt16LE(6),height:bytes.readUInt16LE(8),ext:'gif',animated:true};
  if(bytes.length>=30 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') {
    const type=bytes.toString('ascii',12,16);
    if(type==='VP8X')return {width:1+bytes.readUIntLE(24,3),height:1+bytes.readUIntLE(27,3),ext:'webp',animated:false};
    if(type==='VP8 ')return {width:bytes.readUInt16LE(26)&0x3fff,height:bytes.readUInt16LE(28)&0x3fff,ext:'webp',animated:false};
    if(type==='VP8L') {const packed=bytes.readUInt32LE(21);return {width:1+(packed&0x3fff),height:1+((packed>>>14)&0x3fff),ext:'webp',animated:false};}
  }
  if(bytes.length>=4 && bytes[0]===255 && bytes[1]===216) {
    let offset=2;
    while(offset+4<=bytes.length) {
      if(bytes[offset++]!==255)continue;
      while(offset<bytes.length && bytes[offset]===255)offset++;
      const marker=bytes[offset++];
      if(marker===0xd9 || marker===0xda)break;
      if(marker===0x01 || marker>=0xd0 && marker<=0xd7)continue;
      if(offset+2>bytes.length)break;
      const length=bytes.readUInt16BE(offset);
      if(length<2 || offset+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length>=7)
        return {width:bytes.readUInt16BE(offset+5),height:bytes.readUInt16BE(offset+3),ext:'jpg',animated:false};
      offset+=length;
    }
  }
  throw new Error('Unsupported or incomplete image bytes');
}

module.exports=async function prepareImage(data,messages,staging) {
  const input=String(data.file || '');
  let encoded;
  if(input.startsWith('base64://'))encoded=input.slice(9);
  else if(/^data:image\/(?:png|jpeg|gif|webp);base64,/.test(input))encoded=input.slice(input.indexOf(',')+1);
  else throw new Error('Image sending requires gallery-owned inline bytes');
  if(encoded.length>24*1024*1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('Invalid or oversized image');
  const bytes=Buffer.from(encoded,'base64');
  if(!bytes.length || bytes.length>16*1024*1024)throw new Error('Image must be between 1 byte and 16 MiB');
  const image=dimensions(bytes);
  if(image.width<1 || image.height<1 || image.width>32768 || image.height>32768)throw new Error('Invalid image dimensions');
  const md5=crypto.createHash('md5').update(bytes).digest('hex');
  const filename=md5+'.'+image.ext, subtype=Number(data.sub_type)===1?1:0;
  fs.mkdirSync(staging,{recursive:true});
  const source=path.join(staging,filename);
  if(!fs.existsSync(source))await fs.promises.writeFile(source,bytes,{flag:'wx'});
  const destination=messages.getRichMediaFilePathForGuild({md5HexStr:md5,fileName:filename,
    elementType:2,elementSubType:subtype,thumbSize:0,needCreate:true,downloadType:1,file_uuid:''});
  if(typeof destination!=='string' || !path.isAbsolute(destination))throw new Error('Native QQ returned no media staging path');
  await fs.promises.mkdir(path.dirname(destination),{recursive:true});
  if(path.resolve(source)!==path.resolve(destination))await fs.promises.copyFile(source,destination);
  return {elementType:2,elementId:'',picElement:{md5HexStr:md5,fileName:filename,sourcePath:destination,
    fileSize:String(bytes.length),picWidth:image.width,picHeight:image.height,original:true,
    picType:image.animated?2:1,picSubType:subtype,fileUuid:'',fileSubId:'',thumbFileSize:0,
    summary:subtype?'[表情]':'[图片]'}};
};
