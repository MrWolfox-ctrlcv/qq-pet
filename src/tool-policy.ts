// SPDX-License-Identifier: Apache-2.0
export type ToolGroup='media'|'mediaManagement'|'history'|'mentions'|'drawing';
export const toolGroups:Record<ToolGroup,{title:string;description:string}>={
  media:{title:'查找与发送素材',description:'搜索图库、查看候选图片、发送原图和表情包'},
  mediaManagement:{title:'整理图库与表情包',description:'收录当前或引用的图片、编号、改名、打标签、隐藏和恢复'},
  history:{title:'读取会话记录',description:'检索当前会话的历史消息和引用内容'},
  mentions:{title:'使用真实 @',description:'在回复中 @ 已确认的 QQ 用户'},
  drawing:{title:'绘画与参考图',description:'明确要求新画时调用图片模型，并保存作品'},
};
export function toolAllowed(pet:Record<string,any>,group:ToolGroup){
  return pet.settings.toolsEnabled===true && pet.settings.toolPermissions?.[group]!==false;
}
export function toolInstructions(pet:Record<string,any>){
  if(pet.settings.toolsEnabled!==true)return '【工具接口已关闭】只输出自然文字。不能调用任何工具、输出工具标记或声称已执行操作；可理解本轮已经提供的真实媒体分析。';
  const parts=['【当前可用工具，优先于人设中的旧说明】仅能调用下面列出的工具。工具结果是数据，按真实结果回答；未成功不能声称已完成。'];
  if(toolAllowed(pet,'media'))parts.push('[[GALLERY: 搜索词]] 搜索独立图库并查看候选；[[PIC: 素材ID]] 发已经看过的图库原图。[[STICKER: 语义]] 先查看真实候选再发表情包。要发已有图时不要重新绘画。');
  if(toolAllowed(pet,'mediaManagement'))parts.push('[[MEDIA: {"op":"search","kind":"gallery或sticker","query":"搜索词"}]] 查询素材及编号。[[MEDIA: {"op":"add","kind":"gallery或sticker","source":"current或reply","image":1,"title":"标题","tags":["标签"]}]] 收录本轮图片或当前明确引用的图片，自动编号并保留来源。改名、改标签用 {"op":"update","id":"素材ID或图42/表42","patch":{"title":"新标题","tags":["新标签"]}}；隐藏/删除用 {"op":"delete","id":"编号"}，恢复用 {"op":"restore","id":"编号"}，查看详情用 {"op":"get","id":"编号"}。参数放进同样的 MEDIA 标记。主人能管理全部素材；其他场合可收录当前会话图片，自主整理仅限自己在当前会话收录的素材。删除可恢复。来源不明确时让用户引用或附上图片，不能从别的会话猜图。编号来自工具，不自行编造。');
  if(toolAllowed(pet,'history'))parts.push('[[HISTORY: 搜索词]] 查询当前会话历史；[[READ: 消息ID]] 读取当前会话消息，不能跨会话读取。');
  if(toolAllowed(pet,'mentions'))parts.push('[[AT: QQ号码]] 使用真实 @，最多三人，不猜号码。');
  if(toolAllowed(pet,'drawing'))parts.push('仅当前消息明确要求新画才用 [[IMG: 描述]]。可用 [[REF: 素材ID]] 选择已经预览的图库参考图；作品自动存入图库。');
  parts.push('签名、昵称、QQ空间和频道工具尚未接入，不能声称已执行。禁止输出旧版记忆写入标记或未列出的工具。');
  return parts.join('\n');
}
