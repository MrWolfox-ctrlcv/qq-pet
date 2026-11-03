<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import {reactive,watch} from 'vue'
const props=defineProps<{settings:Record<string,any>}>()
const emit=defineEmits<{save:[settings:Record<string,any>]}>()
const draft=reactive({contextWindowMessages:10,contextAssessTokens:10000,contextForceTokens:50000,contextHardTokens:60000})
watch(()=>props.settings,value=>{for(const key of Object.keys(draft) as (keyof typeof draft)[])draft[key]=Number(value[key])||({contextWindowMessages:10,contextAssessTokens:10000,contextForceTokens:50000,contextHardTokens:60000}[key])},{immediate:true,deep:true})
</script>
<template>
  <section class="panel context-settings">
    <h3>上下文与压缩</h3>
    <p class="muted">最近消息是基础窗口，完整话题、引用和原图可继续保留。压缩不会删除原始聊天。</p>
    <label class="field setting-field">基础消息条数<input v-model.number="draft.contextWindowMessages" type="number" min="4" max="40"></label>
    <label class="field setting-field">开始评估压缩的真实输入 Token<input v-model.number="draft.contextAssessTokens" type="number" min="1000" max="50000" step="1000"></label>
    <label class="field setting-field">强制压缩阈值<input v-model.number="draft.contextForceTokens" type="number" min="1000" max="56000" step="1000"></label>
    <label class="field setting-field">总窗口上限<input v-model.number="draft.contextHardTokens" type="number" min="12000" max="60000" step="1000"></label>
    <p class="muted tiny">达到评估阈值后，每增长约3000 Token再评估。用量仅显示模型服务实际返回的数据；请求前的本地保护值不作为真实 Token。强制腾空间时优先保留当前问题、引用和原图。</p>
    <button class="primary" @click="emit('save',{...draft})">保存上下文设置</button>
  </section>
</template>
<style scoped>.context-settings{margin:18px 0}.context-settings .tiny{line-height:1.7;margin-bottom:16px}</style>
