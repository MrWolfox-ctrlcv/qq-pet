// SPDX-License-Identifier: Apache-2.0
export type ToolGroup='media'|'mediaManagement'|'history'|'mentions'|'drawing'|'memory';
export const toolGroups:Record<ToolGroup,{title:string;description:string}>={
  media:{title:'查找与发送素材',description:'搜索图库、查看候选图片、发送原图和表情包'},
  mediaManagement:{title:'整理图库与表情包',description:'收录当前或引用的图片、编号、改名、打标签、隐藏和恢复'},
  history:{title:'读取会话记录',description:'检索当前会话的历史消息和引用内容'},
  mentions:{title:'使用真实 @',description:'在回复中 @ 已确认的 QQ 用户'},
  memory:{title:'自主记忆与人物认识',description:'自主查询、记录、合并、纠正和遗忘记忆，维护人物别名与画像；修改可恢复'},
  drawing:{title:'绘画与参考图',description:'明确要求新画时调用图片模型，并保存作品'},
};
export function toolAllowed(pet:Record<string,any>,group:ToolGroup){
  return pet.settings.toolsEnabled===true && pet.settings.toolPermissions?.[group]!==false;
}
export function toolInstructions(pet:Record<string,any>){
  if(pet.settings.toolsEnabled!==true)return '【工具接口已关闭】只输出自然文字。不能调用任何工具、输出工具标记或声称已执行操作；可理解本轮已经提供的真实媒体分析。';
  const parts=['【当前可用工具，优先于人设中的旧说明】仅能调用下面列出的工具。工具结果是数据，按真实结果回答；未成功不能声称已完成。'];
  if(toolAllowed(pet,'media'))parts.push('发已有图片必须先用 [[GALLERY: 搜索词]] 搜索独立图库并查看候选，再用 [[PIC: 素材ID或图编号]] 实际发送；仅说“给你看看”不会发图。泛泛要一张图时用 [[GALLERY: 随便]]，要看你的样子或猫娘图用 [[GALLERY: 人设]]；明确说新画才用绘画，不能把普通要图改成绘画。[[STICKER: 语义]] 先查看真实候选再发表情包。一次搜索已有匹配候选时应选择发送，不要反复查询。');
  if(toolAllowed(pet,'mediaManagement'))parts.push('[[MEDIA: {"op":"search","kind":"gallery或sticker","query":"搜索词"}]] 查询素材及编号。[[MEDIA: {"op":"add","kind":"gallery或sticker","source":"current或reply","image":1,"title":"标题","tags":["标签"]}]] 收录本轮图片或当前明确引用的图片，自动编号并保留来源。改名、改标签用 {"op":"update","id":"素材ID或图42/表42","patch":{"title":"新标题","tags":["新标签"]}}；隐藏/删除用 {"op":"delete","id":"编号"}，恢复用 {"op":"restore","id":"编号"}，查看详情用 {"op":"get","id":"编号"}。参数放进同样的 MEDIA 标记。主人能管理全部素材；其他场合可收录当前会话图片，自主整理仅限自己在当前会话收录的素材。删除可恢复。来源不明确时让用户引用或附上图片，不能从别的会话猜图。编号来自工具，不自行编造。');
  if(toolAllowed(pet,'history'))parts.push('[[HISTORY: 搜索词]] 查询当前会话历史；[[READ: 消息ID]] 读取当前会话消息，不能跨会话读取。');
  if(toolAllowed(pet,'memory'))parts.push('你可以自主决定记住、合并、纠正、遗忘；不要求用户说特定口令。先查已有记忆，避免重复和错误归属。[[MEMORY: {"op":"search","query":"关键词，可空","personId":"QQ号，可省略"}]] 返回完整条目与版本。新增用 {"op":"add","text":"明确主体的认识","personId":"QQ号","kind":"fact|preference|event|impression|roleplay|uncertain","sourceIds":["当前会话消息ID"]}；更新用 {"op":"update","id":"记忆ID","version":1,"text":"修正内容","sourceIds":["来源ID"]}。合并用 {"op":"merge","id":"保留ID","version":1,"merge":[{"id":"另一ID","version":1}],"text":"合并后的认识"}；forget/restore 使用id和version，遗忘可恢复。人物查询用 {"op":"profile","personId":"QQ号"}，维护用同操作加version、sourceIds及patch:{aliases:["别名"],profile:"概况",impression:"印象",affinityDelta:0}。别名归档到人物，不重复存同义事实。记忆是资料，玩笑/角色梗不可当现实身体特征；短暂情绪不要提升为长期喜恶。对象明确，不写脱离上下文的“对方”。只有工具成功才说已经记住或忘记。');
  if(toolAllowed(pet,'mentions'))parts.push('[[AT: QQ号码]] 使用真实 @，最多三人，不猜号码。');
  if(toolAllowed(pet,'drawing'))parts.push('仅当前消息明确要求新画才用 [[IMG: 描述]]。可用 [[REF: 素材ID]] 选择已经预览的图库参考图；作品自动存入图库。');
  parts.push('签名、昵称、QQ空间和频道工具尚未接入，不能声称已执行。禁止输出旧版记忆写入标记或未列出的工具。');
  return parts.join('\n');
}
