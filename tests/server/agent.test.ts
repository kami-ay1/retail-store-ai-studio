import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve } from 'node:path'
import { openDatabase } from '../../server/database.ts'
import { saveProduct } from '../../server/catalog.ts'
import { executeAgentTool, getAgentRun } from '../../server/agent.ts'

test('端插件只能读取本店商品，未知工具被明确拒绝', () => {
  const root = resolve('work/tests/agent'); mkdirSync(root, { recursive: true })
  const database = openDatabase(resolve(mkdtempSync(resolve(root, 'run-')), 'test.sqlite'))
  const owner = randomUUID(), other = randomUUID(), runId = randomUUID()
  for (const id of [owner, other]) database.prepare('INSERT INTO merchants VALUES(?,?,?)').run(id, '工具权限验收', new Date().toISOString())
  database.prepare('INSERT INTO agentRuns VALUES(?,?,?,\'running\',?)').run(runId, owner, '准备通勤搭配', new Date().toISOString())
  const product = saveProduct(database, other, { sku: 'B1', name: '其他商家商品', category: '上衣', color: '蓝色', material: '棉', priceCents: 12000, stock: 2, description: '', imageAssetId: null })
  assert.throws(() => executeAgentTool(database, owner, runId, { id: 'cross-merchant', type: 'function', function: { name: 'get_product', arguments: JSON.stringify({ productId: product.id }) } }), { status: 404 })
  assert.throws(() => executeAgentTool(database, owner, runId, { id: 'unknown', type: 'function', function: { name: 'delete_all_products', arguments: '{}' } }), { status: 422 })
  database.close()
})

test('方案引用真实商品版本，保存方案不会产生图片任务', () => {
  const root = resolve('work/tests/agent'); mkdirSync(root, { recursive: true })
  const database = openDatabase(resolve(mkdtempSync(resolve(root, 'run-')), 'test.sqlite'))
  const merchantId = randomUUID(), runId = randomUUID()
  database.prepare('INSERT INTO merchants VALUES(?,?,?)').run(merchantId, '搭配方案验收', new Date().toISOString())
  database.prepare('INSERT INTO agentRuns VALUES(?,?,?,\'running\',?)').run(runId, merchantId, '准备通勤搭配', new Date().toISOString())
  const product = saveProduct(database, merchantId, { sku: 'A1', name: '棉质衬衫', category: '衬衫', color: '白色', material: '棉', priceCents: 10000, stock: 5, description: '', imageAssetId: null })
  const input = { productId: product.id, productVersion: product.version, title: '自然光通勤', scene: '城市街道', style: '自然真实', instructions: '保留棉质纹理', rationale: '使用店内有库存的白色棉质衬衫。' }
  executeAgentTool(database, merchantId, runId, { id: 'plan-1', type: 'function', function: { name: 'propose_outfit', arguments: JSON.stringify(input) } })
  assert.equal(getAgentRun(database, merchantId, runId).plans.length, 1)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM generations').get()?.count, 0)
  assert.throws(() => executeAgentTool(database, merchantId, runId, { id: 'plan-2', type: 'function', function: { name: 'propose_outfit', arguments: JSON.stringify({ ...input, productVersion: 99 }) } }), { status: 409 })
  database.close()
})
