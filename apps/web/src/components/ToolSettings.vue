<!-- SPDX-License-Identifier: Apache-2.0 -->
<template>
  <section class="panel tool-settings">
    <h3>宠物可用的工具</h3>
    <p class="muted">开启后，她可以根据聊天内容自行选择工具。设置仅作用于当前宠物。</p>
    <label class="setting-control">
      <input v-model="isEnabled" type="checkbox">
      <span><b>向宠物开放工具接口</b><small>总开关；关闭后只进行文字对话和来图理解。</small></span>
    </label>
    <fieldset class="tool-settings__list" :disabled="!isEnabled">
      <label v-for="(tool,key) in toolGroups" :key="key" class="setting-control">
        <input v-model="permissions[key]" type="checkbox">
        <span><b>{{tool.title}}</b><small>{{tool.description}}</small></span>
      </label>
    </fieldset>
    <p class="muted tiny">收录支持随消息附上的图片或明确引用的图片；主人可管理全部素材。她自主整理的范围限当前会话内自己收录的素材。删除可恢复。</p>
    <p class="muted tiny">签名、空间、频道、联网和本地程序工具尚未接入。</p>
    <button class="primary" @click="saveTools">保存工具设置</button>
  </section>
</template>
<script setup lang="ts">
import {reactive,ref,watch} from 'vue'
import {toolGroups,type ToolGroup} from '../../../../src/tool-policy.ts'

const props=defineProps<{settings:Record<string,any>}>()
const emit=defineEmits<{save:[settings:Record<string,any>]}>()
const isEnabled=ref(false)
const permissions=reactive<Record<ToolGroup,boolean>>({media:true,mediaManagement:true,history:true,mentions:true,drawing:true,memory:true})
watch(()=>props.settings,value=>{
  isEnabled.value=value?.toolsEnabled===true
  for(const key of Object.keys(toolGroups) as ToolGroup[])permissions[key]=value?.toolPermissions?.[key]!==false
},{immediate:true,deep:true})
function saveTools(){emit('save',{toolsEnabled:isEnabled.value,toolPermissions:{...permissions}})}
</script>
<style scoped>
.tool-settings__list{border:0;padding:0;margin:16px 0}
.tool-settings__list:disabled{opacity:.55}
.tool-settings .tiny{margin:12px 0;line-height:1.7}
</style>
