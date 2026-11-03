// SPDX-License-Identifier: Apache-2.0
import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { createApp } from '../src/server.ts'

let app: ReturnType<typeof createApp>
let dataDir: string
let token: string
let petId: string
let otherPetId: string

test.beforeAll(async () => {
  mkdirSync('output', { recursive: true })
  dataDir = mkdtempSync(path.join(tmpdir(), 'pet-panel-e2e-'))
  app = createApp({ dataDir, host: '127.0.0.1', port: 4781 })
  const pet = app.store.createPet({ name: 'E2E 示例宠物A', accountId: 'test-account', prompts: { persona: '初始测试人设' }, settings: {} })
  petId = pet.id
  otherPetId = app.store.createPet({ name: 'E2E 示例宠物B', accountId: 'test-account-2', prompts: {}, settings: {} }).id
  app.store.addTrace(petId, { triggerId: 'trigger-77', chatId: 'group-9', state: 'archived-only', decision: { reply: false, reason: 'preview-only' }, messages: [
    { role: 'system', content: '角色规则文本' },
    { role: 'user', content: JSON.stringify({ messageId: 'source-77', senderId: 'stable-user-42', senderName: '回归来源', sentAt: '2026-11-02T08:00:00.000Z', relation: 'current', segments: [{ type: 'text', text: '来自原消息' }] }) },
  ], mediaSources: [], memories: [] })
  token = readFileSync(app.auth.tokenPath, 'utf8').trim()
  await new Promise<void>(resolve => app.server.listen(4781, '127.0.0.1', resolve))
})

test.afterAll(async () => {
  await app?.close()
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

async function login(page: Page) {
  await page.goto('/')
  await page.getByPlaceholder('粘贴本地管理员令牌').fill(token)
  await page.getByRole('button', { name: '安全登录' }).click()
  await expect(page.getByRole('heading', { name: '运行总览' })).toBeVisible()
  await expect(page.getByRole('combobox')).toContainText('E2E 示例宠物A')
}

test('工具开关真实保存、重新加载并按宠物隔离',async({page})=>{
  await login(page)
  await page.getByRole('button',{name:'设置与备份'}).click()
  const tools=page.locator('.tool-settings')
  const master=tools.getByRole('checkbox',{name:/向宠物开放工具接口/})
  const drawing=tools.getByRole('checkbox',{name:/绘画与参考图/})
  await expect(master).not.toBeChecked()
  await expect(drawing).toBeDisabled()
  await master.check()
  await drawing.uncheck()
  await tools.getByRole('button',{name:'保存工具设置'}).click()
  await expect(page.getByText('工具设置已保存，立即生效')).toBeVisible()
  const saved=(await(await page.request.get(`/api/pets/${petId}`)).json()).data
  expect(saved.settings.toolsEnabled).toBe(true)
  expect(saved.settings.toolPermissions.drawing).toBe(false)
  await page.reload()
  await page.getByRole('button',{name:'设置与备份'}).click()
  await expect(master).toBeChecked()
  await expect(drawing).not.toBeChecked()
  await tools.screenshot({path:'output/tools-settings.png'})
  await page.getByRole('combobox').first().selectOption(otherPetId)
  await expect(master).not.toBeChecked()
  await page.setViewportSize({width:390,height:844})
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})

test('管理流程真实保存并在窄屏无横向溢出', async ({ page }) => {
  await login(page)
  await expect(page.locator('.preview-banner')).toContainText('当前在线旧版不受这些修改影响')
  await page.screenshot({ path: 'output/panel-overview.png', fullPage: true })

  await page.getByRole('button', { name: 'Pet 与提示词' }).click()
  await expect(page.locator('.preview-banner')).toBeVisible()
  await page.getByPlaceholder('编辑人设与语言风格…').fill('回归测试人设：温柔、简洁。')
  await page.getByRole('button', { name: '保存全部更改' }).click()
  await expect(page.getByText('已保存')).toBeVisible()
  let saved = await page.request.get(`/api/pets/${petId}`)
  let pet = (await saved.json()).data
  expect(pet.prompts.persona).toContain('回归测试人设')
  const savedVersion = pet.version
  await page.getByPlaceholder('编辑人设与语言风格…').fill('第二次版本，用于回滚验证。')
  await page.getByRole('button', { name: '保存全部更改' }).click()
  await page.getByRole('button', { name: '恢复' }).last().click()
  await expect.poll(async () => (await (await page.request.get(`/api/pets/${petId}`)).json()).data.prompts.persona).toBe('初始测试人设')

  const tinyPng = await sharp({ create: { width: 160, height: 110, channels: 3, background: { r: 151, g: 196, b: 177 } } }).png().toBuffer()
  await page.getByRole('button', { name: '图库' }).click()
  await expect(page.locator('.preview-banner')).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: tinyPng })
  await expect(page.getByRole('heading', { name: '新建图库' })).toBeVisible()
  await page.locator('.dialog label').filter({ hasText: 'title' }).locator('input').fill('回归图片')
  await page.locator('.dialog textarea').first().fill('["测试标签"]')
  await page.getByRole('button', { name: '保存更改' }).click()
  await expect(page.getByText('回归图片')).toBeVisible()
  await expect.poll(() => page.locator('.asset-card img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  await page.screenshot({ path: 'output/gallery.png', fullPage: true })
  const assetCard = page.locator('.asset-card').filter({ hasText: '回归图片' })
  await assetCard.getByRole('button', { name: '隐藏' }).click()
  await expect(assetCard.getByRole('button', { name: '恢复' })).toBeVisible()
  await assetCard.getByRole('button', { name: '恢复' }).click()
  await expect(assetCard.getByRole('button', { name: '隐藏' })).toBeVisible()

  await page.getByRole('button', { name: '记忆' }).click()
  await page.getByRole('button', { name: '＋ 新建' }).click()
  await page.locator('.dialog label').filter({ hasText: 'text' }).locator('input').fill('测试记忆内容')
  await page.getByRole('button', { name: '保存更改' }).click()
  await expect(page.getByText('测试记忆内容')).toBeVisible()

  await page.getByRole('button', { name: '人物与画像' }).click()
  await page.getByRole('button', { name: '＋ 新建' }).click()
  await page.locator('.dialog input').nth(0).fill('stable-user-42')
  await page.locator('.dialog input').nth(1).fill('测试联系人')
  await page.locator('.dialog textarea').nth(0).fill('["阿四"]')
  await page.locator('.dialog textarea').nth(1).fill('{"preferences":"喜欢茶"}')
  await page.locator('.dialog textarea').nth(2).fill('["preferences"]')
  await page.getByRole('button', { name: '保存更改' }).click()
  await expect(page.getByText('测试联系人')).toBeVisible()
  await page.getByRole('combobox').selectOption(otherPetId)
  await expect(page.getByText('暂无数据')).toBeVisible()
  const isolatedPeople = await page.request.get(`/api/pets/${otherPetId}/people`)
  expect((await isolatedPeople.json()).data).toHaveLength(0)
  await page.getByRole('combobox').selectOption(petId)
  await page.getByRole('button', { name: '编辑' }).click()
  await page.locator('.dialog textarea').nth(0).fill('["阿四","四哥"]')
  await page.locator('.dialog textarea').nth(1).fill('{"preferences":"更正后的偏好"}')
  await page.locator('.dialog textarea').nth(2).fill('["preferences","address"]')
  await page.getByRole('button', { name: '保存更改' }).click()
  const savedPerson = (await (await page.request.get(`/api/pets/${petId}/people`)).json()).data.find((person: any) => person.id === 'stable-user-42')
  expect(savedPerson.aliases).toEqual(['阿四', '四哥'])
  expect(savedPerson.lockedFields).toEqual(['preferences', 'address'])

  await page.getByRole('button', { name: '聊天检查' }).click()
  await expect(page.getByRole('heading', { name: '模型调用诊断' })).toBeVisible()
  await expect(page.getByText('系统上下文')).toBeVisible()
  await expect(page.locator('.context-message').filter({ hasText: '回归来源' })).toBeVisible()
  await expect(page.getByText('来自原消息', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '设置与备份' }).click()
  await page.getByText('允许主动回复').click()
  await page.locator('.setting-field input').nth(0).fill('30000')
  await page.locator('.setting-field input').nth(1).fill('120000')
  await page.getByRole('button', { name: '保存回复设置' }).click()
  const savedSettings = (await (await page.request.get(`/api/pets/${petId}`)).json()).data.settings
  expect(savedSettings.proactiveReply).toBe(true)
  expect(savedSettings.decisionIntervalMs).toBe(30000)
  expect(savedSettings.proactiveCooldownMs).toBe(120000)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(savedVersion).toBeGreaterThan(1)
})
