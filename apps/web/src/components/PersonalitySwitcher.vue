<!-- SPDX-License-Identifier: Apache-2.0 -->
<template>
  <section v-if="value.members?.length>1" class="panel personality-switcher">
    <div><h3>同号人格</h3><p class="muted">当前人格：{{activeName}}。每个人格的记忆、图库、表情包、画像、好感度和上下文独立。</p><small v-if="viewing!==value.activePetId">你正在查看另一人格的资料，查看不会触发切换。</small></div>
    <div class="actions"><button v-for="member in value.members" :key="member.id" :class="member.active?'outline':'primary'" :disabled="member.active||busy" @click="handleActivate(member.id)">{{member.active?'当前：':'切换为'}}{{member.name}}</button></div>
    <p class="muted tiny">主人可在聊天中发送“#人格 名字”切换；“#人格”查看列表。切换作用于这个 QQ 的全部会话。</p>
  </section>
</template>
<script setup lang="ts">
import {computed} from 'vue'
const props=defineProps<{value:Record<string,any>;viewing:string;busy?:boolean}>()
const emit=defineEmits<{activate:[id:string]}>()
const activeName=computed(()=>props.value.members?.find((m:any)=>m.active)?.name||'未激活')
function handleActivate(id:string){emit('activate',id)}
</script>
<style scoped>
.personality-switcher{margin-bottom:24px}
.personality-switcher .actions{flex-wrap:wrap;margin-top:16px}
.personality-switcher small{display:block;line-height:1.6}
.personality-switcher .tiny{margin-bottom:0;line-height:1.6}
</style>
