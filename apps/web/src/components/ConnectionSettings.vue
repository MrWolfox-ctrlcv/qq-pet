<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { reactive, toRaw, watch } from 'vue'
const props = defineProps<{ value: Record<string, any> }>()
const emit = defineEmits<{ save: [value: Record<string, any>] }>()
const draft = reactive<any>({ connection: {}, model: {} })
watch(() => props.value, value => { Object.assign(draft, structuredClone(toRaw(value) || { connection: {}, model: {} })); draft.connection ||= {}; draft.model ||= {} }, { immediate: true, deep: true })
function save() { const result = structuredClone(toRaw(draft)); for (const group of ['connection', 'model']) { const key = group === 'connection' ? 'accessToken' : 'apiKey'; if (!result[group][key]?.trim()) delete result[group][key] } emit('save', result) }
</script>
<template>
  <section class="panel connection-settings">
    <h3>连接与模型</h3><p class="muted">空白密钥将沿用服务端已保存的值。页面只显示是否已配置，不回显密钥。</p>
    <div class="connection-columns">
      <div><h4>QQ 连接</h4><label class="field">服务类型<input v-model="draft.connection.provider"></label><label class="field">HTTP 地址<input v-model="draft.connection.httpUrl"></label><label class="field">WebSocket 地址<input v-model="draft.connection.wsUrl"></label><label class="field">访问令牌<input v-model="draft.connection.accessToken" type="password" autocomplete="new-password" :placeholder="draft.connection.hasAccessToken?'已配置，留空以保留':''"></label><label class="check"><input v-model="draft.connection.enabled" type="checkbox"> 启用连接</label><label class="check"><input v-model="draft.connection.live" type="checkbox"> 允许实时运行</label></div>
      <div><h4>模型分工</h4><label class="field">API 地址<input v-model="draft.model.baseUrl"></label><label class="field">API 密钥<input v-model="draft.model.apiKey" type="password" autocomplete="new-password" :placeholder="draft.model.hasApiKey?'已配置，留空以保留':''"></label><label class="field">主对话模型<input v-model="draft.model.chatModel"></label><label class="field">回复判断模型<input v-model="draft.model.decisionModel"></label><label class="field">视觉理解模型<input v-model="draft.model.visionModel"></label><label class="field">生图服务<select v-model="draft.model.imageProvider"><option value="chat">当前聊天模型接口</option><option value="agnes">Agnes 专用生图</option></select></label><label v-if="draft.model.imageProvider==='agnes'" class="field">生图 API 地址<input v-model="draft.model.imageBaseUrl"></label><label v-if="draft.model.imageProvider==='agnes'" class="field">生图密钥<input v-model="draft.model.imageApiKey" type="password" autocomplete="new-password" :placeholder="draft.model.hasImageApiKey?'已配置，留空以保留':'尚未配置'"></label><label class="field">图片模型<input v-model="draft.model.imageModel"></label></div>
    </div><button class="primary" @click="save">保存连接与模型设置</button>
  </section>
</template>
<style scoped>.connection-columns{display:grid;grid-template-columns:1fr 1fr;gap:24px}.connection-columns h4{color:#52645a;margin:14px 0}.connection-columns .field{margin:12px 0}.connection-columns input:not([type=checkbox]){border:1px solid #e1e7e2;border-radius:9px;padding:10px;background:#fbfcfb}.check{display:flex;gap:8px;align-items:center;font-size:13px;margin:10px 0}@media(max-width:700px){.connection-columns{grid-template-columns:1fr}}</style>
