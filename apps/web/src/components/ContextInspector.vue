<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
defineProps<{value:Record<string,any>}>()
const emit=defineEmits<{compact:[id:string]}>()
const number=(value:any)=>typeof value==='number'?value.toLocaleString():'未知'
function summary(value:string){try{const s=JSON.parse(value);return [s.overview,...(s.decisions||[]),...(s.pending||[]).map((x:string)=>'待解决：'+x)].filter(Boolean).join('\n')}catch{return value}}
const state=(value:string)=>({applied:'已应用',failed:'失败，原文保留',skipped:'保留原文'}[value]||value)
const kind=(value:string)=>({'context-routing':'话题判断','context-compression':'上下文压缩',chat:'对话',decision:'回复判断','conversation-summary':'画像阶段总结'}[value]||value)
</script>
<template>
  <section class="context-inspector">
    <h3>话题与真实用量</h3>
    <p class="muted">用量来自服务实际返回；未上报显示未知。本地请求保护预算与真实 Token 分开。</p>
    <details open><summary>当前话题</summary>
      <article v-for="topic in value.topics||[]" :key="topic.id" class="context-inspector__item">
        <b>{{topic.title}}</b><small>{{topic.chat_id}} · 最近实测输入 {{number(topic.last_prompt)}} Token</small>
        <p v-if="topic.summary">{{summary(topic.summary)}}</p><p v-else class="muted">尚未压缩，保留原始对话。</p>
        <p v-if="topic.last_error" class="error">{{topic.last_error}}</p>
        <button class="quiet" @click="emit('compact',topic.id)">压缩较早内容（调用模型）</button>
      </article>
      <p v-if="!value.topics?.length" class="muted">新消息到达后建立话题。</p>
    </details>
    <details><summary>最近上下文快照</summary>
      <article v-for="snapshot in value.snapshots||[]" :key="snapshot.id" class="context-inspector__item">
        <b>{{snapshot.chat_id}} · {{snapshot.trigger_id}}</b><small>{{snapshot.created_at}} · 实测输入 {{number(snapshot.usage?.promptTokens)}} / 输出 {{number(snapshot.usage?.completionTokens)}}</small>
        <p>本轮带入 {{snapshot.selected.filter((s:any)=>s.kind==='history'||s.kind==='current').length}} 条原文 · {{snapshot.images.length}} 组原图 · 摘要版本 {{snapshot.summary_version||'无'}}</p>
        <details><summary>查看选入和省略的来源</summary><pre>{{JSON.stringify({selected:snapshot.selected,omitted:snapshot.omitted},null,2)}}</pre></details>
      </article>
    </details>
    <details><summary>压缩记录</summary>
      <article v-for="item in value.compressions||[]" :key="item.id" class="context-inspector__item"><b>{{state(item.state)}} · {{item.reason}}</b><small>{{item.created_at}} · 压缩请求输入 {{number(item.usage?.promptTokens)}} / 输出 {{number(item.usage?.completionTokens)}}</small><p v-if="item.summary">{{summary(item.summary)}}</p><p v-if="item.error" class="error">{{item.error}}</p><small>来源 {{item.sources.length}} 条 · 范围 {{item.from_sequence}}—{{item.to_sequence}}</small></article>
      <p v-if="!value.compressions?.length" class="muted">尚无压缩记录。</p>
    </details>
    <details><summary>逐次模型用量</summary><div class="context-inspector__table"><table><thead><tr><th>时间 / 会话</th><th>用途 / 模型</th><th>输入</th><th>输出</th><th>总量</th><th>缓存</th></tr></thead><tbody><tr v-for="(call,i) in value.usage||[]" :key="call.requestId||i"><td>{{call.ts}}<small>{{call.chatId||'早期记录未关联会话'}}</small></td><td>{{kind(call.kind)}}<small>{{call.returnedModel||call.model}}</small></td><td>{{number(call.promptTokens)}}</td><td>{{number(call.completionTokens)}}</td><td>{{number(call.totalTokens)}}</td><td>{{number(call.cachedTokens)}}</td></tr></tbody></table></div></details>
  </section>
</template>
<style scoped>
.context-inspector{margin:24px 0}.context-inspector>details{padding:14px 0;border-bottom:1px solid var(--border,#e1e7e2)}.context-inspector summary{cursor:pointer;color:var(--text,#3f5148)}.context-inspector__item{padding:14px 0;border-bottom:1px solid var(--border,#edf0ed)}.context-inspector small{display:block;margin:6px 0;color:var(--muted,#87918b);font-size:11px}.context-inspector p,.context-inspector pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;font-size:12px}.context-inspector__table{overflow:auto}.context-inspector table{border-collapse:collapse;width:100%;font-size:12px}.context-inspector th,.context-inspector td{padding:10px;text-align:left;border-bottom:1px solid var(--border,#edf0ed);white-space:nowrap}
</style>
