<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
defineProps<{items:Record<string,any>[]}>()
</script>
<template>
  <section class="conversation-summaries">
    <h3>阶段性会话总结</h3>
    <p class="muted">按会话积累消息后总结，更新对应 QQ 的画像与好感度，并保留来源。</p>
    <article v-for="item in items" :key="item.id" class="conversation-summaries__item">
      <small>{{item.chat_id}} · {{new Date(item.created_at).toLocaleString()}}</small>
      <p>{{item.summary}}</p>
      <p v-for="person in item.people" :key="person.qq">QQ {{person.qq}} · 好感度 {{person.affinity}} · {{person.impression}}</p>
      <details><summary>查看依据（{{item.sources.length}} 条）</summary><p v-for="source in item.sources" :key="source.messageId">{{source.senderId}} · {{source.messageId}}</p></details>
    </article>
    <p v-if="!items.length" class="muted">还没有达到总结条件的会话。</p>
  </section>
</template>
<style scoped>
.conversation-summaries{margin:20px 0}.conversation-summaries__item{padding:14px 0;border-bottom:1px solid var(--border,#e1e7e2)}.conversation-summaries__item p{white-space:pre-wrap;line-height:1.7}.conversation-summaries__item small{color:var(--muted,#52645a)}
</style>
