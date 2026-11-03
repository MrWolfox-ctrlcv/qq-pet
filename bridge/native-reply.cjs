// SPDX-License-Identifier: Apache-2.0
// Resolve native reply placeholders through exact, same-conversation sequences.
module.exports=function resolveReply(raw,reply,records){
  const valid=value=>/^[1-9]\d*$/.test(String(value||''));
  for(const value of [reply.sourceMsgIdInRecords,reply.replayMsgId,reply.replyMsgId])if(valid(value))return String(value);
  if(!valid(reply.replayMsgSeq))return '';
  const matched=[...records].filter(row=>String(row.chatType)===String(raw.chatType)&&String(row.peerUid)===String(raw.peerUid)&&String(row.msgSeq)===String(reply.replayMsgSeq)&&(!valid(reply.senderUin)||String(row.senderUin??row.authorUin)===String(reply.senderUin)));
  return matched.length===1?String(matched[0].msgId??matched[0].sourceId):'';
};
