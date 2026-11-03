// SPDX-License-Identifier: Apache-2.0
// Resolve native reply placeholders through exact, same-conversation sequences.
module.exports=function resolveReply(raw,reply,records){
  const valid=value=>/^[1-9]\d*$/.test(String(value||''));
  for(const value of [reply.replayMsgId,reply.replyMsgId])if(valid(value))return String(value);
  const scoped=[...records].filter(row=>String(row.chatType)===String(raw.chatType)&&String(row.peerUid)===String(raw.peerUid)&&(!valid(reply.senderUin)||String(row.senderUin??row.authorUin)===String(reply.senderUin)));
  if(valid(reply.replayMsgSeq)){
    const matched=scoped.filter(row=>String(row.msgSeq)===String(reply.replayMsgSeq));
    if(matched.length===1)return String(matched[0].msgId??matched[0].sourceId);
  }
  // sourceMsgIdInRecords can be a synthetic quote-record ID, not the target
  // message ID. Accept it only when it is already a known scoped message.
  return scoped.some(row=>String(row.msgId??row.sourceId)===String(reply.sourceMsgIdInRecords))?String(reply.sourceMsgIdInRecords):'';
};
