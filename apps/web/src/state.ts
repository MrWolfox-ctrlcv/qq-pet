// SPDX-License-Identifier: Apache-2.0
import { computed, ref } from 'vue'

type Pet = { id: string; name: string; accountId: string; prompts: Record<string, string>; settings: Record<string, any>; version: number; updatedAt: string }
type Row = Record<string, any>
export const csrf = ref(''), authenticated = ref(false), token = ref(''), pets = ref<Pet[]>([]), petId = ref(''), pet = ref<Pet | null>(null), page = ref('overview'), data = ref<Row[]>([]), error = ref(''), notice = ref(''), search = ref(''), categoryFilter = ref(''), scopeFilter = ref(''), selected = ref<Row | null>(null), form = ref<Row>({}), preview = ref(''), previewResult = ref<Row | null>(null), status = ref<Row | null>(null), backups = ref<Row[]>([]), connection = ref<Row>({ connection: {}, model: {} }), revisions = ref<Row[]>([]), traces = ref<Row[]>([]), modelTest = ref(''), summaries = ref<Row[]>([])
export const nav = [['overview', '运行总览', '◉'], ['prompt', 'Pet 与提示词', '✎'], ['gallery', '图库', '▧'], ['stickers', '表情包', '☻'], ['memories', '记忆', '◷'], ['people', '人物与画像', '♙'], ['chat', '聊天检查', '▤'], ['settings', '设置与备份', '⚙']]
export const currentPet = computed(() => pets.value.find(item => item.id === petId.value) || null)

export async function api<T = any>(url: string, method = 'GET', body?: any): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (csrf.value) headers['X-CSRF-Token'] = csrf.value
  const response = await fetch(url, { method, headers, credentials: 'include', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw Error(result?.error?.message || `请求失败 (${response.status})`)
  return result.data
}
export async function session() { const result = await api<any>('/api/session'); authenticated.value = result.authenticated; csrf.value = result.csrfToken || ''; if (authenticated.value) await loadPets() }
export async function login() { try { await api('/api/login', 'POST', { token: token.value }); token.value = ''; await session() } catch (cause: any) { error.value = cause.message } }
export async function logout() { await api('/api/logout', 'POST', {}); authenticated.value = false; pets.value = [] }
export async function loadPets() { pets.value = await api('/api/pets'); if (!petId.value && pets.value.length) petId.value = pets.value[0].id; await loadPet() }
export async function loadPet() { if (!petId.value) return; pet.value = await api(`/api/pets/${petId.value}`); try { status.value = await api(`/api/pets/${petId.value}/status`) } catch (cause: any) { error.value = cause.message }; await loadPage() }
export const collectionPath = computed(() => ({ gallery: 'assets?kind=gallery&includeHidden=true', stickers: 'assets?kind=sticker&includeHidden=true', memories: 'memories?includeHidden=true', people: 'people', chat: 'messages?limit=100' } as Record<string, string>)[page.value])
export async function loadPage() {
  if (!petId.value) return
  error.value = ''
  try {
    if (page.value === 'overview') status.value = await api(`/api/pets/${petId.value}/status`)
    else if (page.value === 'chat') { data.value = await api(`/api/pets/${petId.value}/messages?limit=100`); traces.value = await api(`/api/pets/${petId.value}/traces`); summaries.value = await api(`/api/pets/${petId.value}/summaries`) }
    else if (collectionPath.value) data.value = await api(`/api/pets/${petId.value}/${collectionPath.value}`)
    else if (page.value === 'settings') { backups.value = await api('/api/backups'); connection.value = await api(`/api/pets/${petId.value}/connection`) }
    else if (page.value === 'prompt') revisions.value = await api(`/api/revisions?entityType=pet&entityId=${petId.value}&petId=${petId.value}`)
  } catch (cause: any) { error.value = cause.message }
}
export function go(target: string) { page.value = target; selected.value = null; search.value = ''; categoryFilter.value = ''; scopeFilter.value = ''; void loadPage() }
export const filtered = computed(() => data.value.filter(item => JSON.stringify(item).toLowerCase().includes(search.value.toLowerCase()) && (!categoryFilter.value || item.category === categoryFilter.value) && (!scopeFilter.value || item.scope === scopeFilter.value)))
export function openEdit(row?: Row) {
  selected.value = row || {}
  if (row) { form.value = { ...row }; return }
  const defaults: Record<string, Row> = {
    memories: { text: '', personId: '', scope: 'private', kind: 'fact', sourceMessageIds: [], confidence: 1, locked: false },
    people: { id: '', displayName: '', aliases: [], fields: { affinity:10, address: '', preferences: '', relationship: '', impression: '', profile: '' }, lockedFields: [] },
  }
  form.value = { ...(defaults[page.value] || {}) }
}
export async function saveRow() { if (!petId.value) return; try { const path = ['gallery', 'stickers'].includes(page.value) ? 'assets' : page.value; const url = `/api/pets/${petId.value}/${path}${selected.value?.id ? `/${selected.value.id}` : ''}`; const payload = selected.value?.id ? { ...form.value, version: selected.value.version } : { ...form.value }; await api(url, selected.value?.id ? 'PATCH' : 'POST', payload); notice.value = '已保存'; selected.value = null; await loadPage() } catch (cause: any) { error.value = cause.message } }
export async function hideRow(row: Row) { try { const path = ['gallery', 'stickers'].includes(page.value) ? 'assets' : page.value; const url = `/api/pets/${petId.value}/${path}/${row.id}`; if (row.hidden) await api(url, 'PATCH', { version: row.version, hidden: false }); else await api(url, 'DELETE', { version: row.version }); await loadPage() } catch (cause: any) { error.value = cause.message } }
export async function savePet() { if (!pet.value) return; try { pet.value = await api(`/api/pets/${petId.value}`, 'PATCH', { version: pet.value.version, prompts: pet.value.prompts, settings: pet.value.settings }); notice.value = '已保存'; await loadPage() } catch (cause: any) { error.value = cause.message; if (cause.message.includes('409')) await loadPet() } }
export async function saveTools(settings:Record<string,any>) { if(!pet.value)return;try{pet.value=await api(`/api/pets/${petId.value}`,'PATCH',{version:pet.value.version,settings});notice.value='工具设置已保存，立即生效'}catch(cause:any){error.value=cause.message} }
export async function previewPrompt() { try { previewResult.value = await api<any>(`/api/pets/${petId.value}/preview`, 'POST', { text: preview.value || '你好' }); notice.value = `本地预览完成 · prompt 版本 ${previewResult.value?.promptVersion ?? '当前'} · 未调用模型` } catch (cause: any) { error.value = cause.message } }
export async function testModel() { try { const result = await api(`/api/pets/${petId.value}/test-model`, 'POST', { text: modelTest.value }); notice.value = '模型测试完成；接口约束为不执行外部动作'; data.value = [result] } catch (cause: any) { error.value = cause.message } }
export async function control(action: string) { try { await api(`/api/pets/${petId.value}/control`, 'POST', { action }); await loadPage() } catch (cause: any) { error.value = cause.message } }
export async function importFile(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; if (file.size > 9 * 1024 * 1024) { error.value = '文件超过 9 MiB 上传限制'; return } const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) }); form.value = { filename: file.name, base64, kind: page.value === 'stickers' ? 'sticker' : 'gallery', category: page.value === 'stickers' ? 'sticker' : 'reference', title: file.name.replace(/\.[^.]+$/, ''), tags: [], description: '', scope: 'private' }; selected.value = {} }
export async function backup() { try { await api('/api/backups', 'POST', {}); notice.value = '备份已创建'; await loadPage() } catch (cause: any) { error.value = cause.message } }
export async function restoreRevision(revision: Row) { if (!pet.value) return; try { pet.value = await api(`/api/revisions/${revision.id}/restore`, 'POST', { petId: petId.value, entityType: 'pet', entityId: petId.value, version: pet.value.version }); notice.value = '提示词版本已恢复'; await loadPage() } catch (cause: any) { error.value = cause.message } }
export async function saveConnection(payload: Row) { try { connection.value = await api(`/api/pets/${petId.value}/connection`, 'PATCH', payload); notice.value = '连接与模型设置已保存' } catch (cause: any) { error.value = cause.message } }
export async function restore(backup: Row) { if (!confirm('确定恢复此备份？当前数据将被覆盖。')) return; try { await api(`/api/backups/${backup.id}/restore`, 'POST', { confirmation: 'RESTORE' }); notice.value = '恢复已完成' } catch (cause: any) { error.value = cause.message } }
