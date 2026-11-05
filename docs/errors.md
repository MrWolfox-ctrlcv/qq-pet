# 异常提示与排查

系统生成的异常提示采用 `【操作异常·错误代码】具体说明`，与角色的自然回复区分。
正常的纯图片或纯表情包回复不会附加错误提示。只有上游明确返回拦截标记时才标记为拦截；空内容不推测为安全拒绝。

| 错误代码 | 含义 |
| --- | --- |
| MODEL_EMPTY | 上游返回空正文 |
| MODEL_OUTPUT_LIMIT | 输出额度耗尽且没有正文 |
| MODEL_UNSPECIFIED_FAILURE | 模型自行返回旧的笼统失败话术，未说明原因 |
| MODEL_BLOCKED | 上游明确返回 refusal 或 content_filter |
| MODEL_TOOL_PROTOCOL | 上游只返回当前未支持的原生工具调用 |
| MODEL_AUTH / MODEL_PERMISSION | 密钥认证失败 / 权限不足 |
| MODEL_QUOTA / MODEL_RATE_LIMIT | 明确的额度不足 / 请求限流 |
| MODEL_CONFIG / MODEL_NOT_FOUND | 配置缺失 / 模型或接口不存在 |
| MODEL_BUSY | 本地并发请求达到上限 |
| MODEL_NETWORK / MODEL_TIMEOUT / MODEL_CANCELLED | 连接失败 / 超时 / 取消 |
| MODEL_UNAVAILABLE / MODEL_REQUEST_REJECTED | 上游服务故障 / 请求被拒绝 |
| MODEL_RESPONSE_FORMAT / MODEL_RESPONSE_PROCESSING | 响应格式不符合约定 / 内部处理异常 |
| CONTEXT_LIMIT / MODEL_CONTEXT_LIMIT | 本地上下文保护上限 / 上游上下文限制 |
| MEDIA_READ_FAILED | 收到的媒体尚未加载或读取失败 |
| MEDIA_DISABLED / TOOLS_DISABLED | 素材工具未开放 / 工具总接口未开放 |
| GALLERY_NOT_FOUND / GALLERY_PREVIEW_MISMATCH / GALLERY_PREPARE_FAILED | 图片不可用 / 预览不匹配 / 预览或原文件准备失败 |
| STICKER_NOT_FOUND / STICKER_PREPARE_FAILED | 没有匹配表情包 / 预览或原文件准备失败 |
| DRAWING_FAILED | 生图调用或生成文件读取失败 |
| DRAWING_DISABLED / DRAWING_NOT_REQUESTED | 绘画工具关闭 / 本轮未要求新画 |
| TOOL_ARGUMENTS / TOOL_EXECUTION_FAILED / TOOL_ROUND_LIMIT / TOOL_NO_REPLY | 参数错误 / 执行失败 / 调用轮数用尽 / 只有不可执行指令 |
| MENTION_INVALID | 仅有不可发送的 @ 对象 |
| QQ_SEND_FAILED / QQ_SEND_UNCERTAIN | QQ 拒绝发送 / 发送结果未确认 |
| INTERNAL_ERROR | 尚未归类的内部异常 |

聊天检查中的“完整诊断”包含 `diagnostics`，可查看错误代码、触发消息及模型请求编号。模型调用记录保留 HTTP 状态、结束原因、耗时和上游实际返回的 token 用量。未报告的用量保持未知，空回复若已计费也记录真实用量。

公开提示不回显服务密钥、完整上游错误响应或本地文件路径。发送通道异常只记录到面板，不通过同一故障通道重复发送提示；结果未确认时不自动重发。
