import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openDatabase } from '../../server/database.ts'
import { createApp } from '../../server/app.ts'

test('真实 HTTP 注册、商品保存和商家隔离', async context => {
  const root = resolve('work/tests/http'); mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(resolve(root, 'run-')), database = openDatabase(resolve(directory, 'test.sqlite'))
  const server = createApp(database, directory).listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  context.after(() => { server.closeAllConnections(); server.close(); database.close() })
  const specification = await fetch(`${base}/openapi.yaml`)
  assert.equal(specification.status, 200)
  assert.equal(await specification.text(), readFileSync(new URL('../../docs/coze-plugin.yaml', import.meta.url), 'utf8'))
  const register = async (email: string) => {
    const result = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ merchantName: '接口验收工作室', email, password: 'Acceptance-2026!' }) })
    assert.equal(result.status, 201)
    const cookie = result.headers.get('set-cookie'); assert.ok(cookie)
    return cookie.split(';')[0]
  }
  const cookieA = await register('merchant-a@example.com'), cookieB = await register('merchant-b@example.com')
  const created = await fetch(`${base}/api/products`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieA }, body: JSON.stringify({ sku: 'HTTP-001', name: '衬衫', category: '上衣', color: '白色', material: '棉', priceCents: 19900, stock: 8, description: '通勤款', imageAssetId: null }) })
  assert.equal(created.status, 201)
  const listA = await fetch(`${base}/api/products`, { headers: { Cookie: cookieA } }), listB = await fetch(`${base}/api/products`, { headers: { Cookie: cookieB } })
  assert.equal((await listA.json()).length, 1); assert.equal((await listB.json()).length, 0)
  const unauthorized = await fetch(`${base}/api/generations`); assert.equal(unauthorized.status, 401)
  const wrongOrigin = await fetch(`${base}/api/products`, { method: 'POST', headers: { Cookie: cookieA, Origin: 'https://outside.example' } })
  assert.equal(wrongOrigin.status, 403)
})

test('同一邮箱并发注册只创建一个账户，失败后事务已经结束', async context => {
  const root = resolve('work/tests/http'); mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(resolve(root, 'run-')), database = openDatabase(resolve(directory, 'test.sqlite'))
  const server = createApp(database, directory).listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  context.after(() => { server.closeAllConnections(); server.close(); database.close() })
  const request = () => fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ merchantName: '并发注册验收', email: 'same@example.com', password: 'Acceptance-2026!' }) })
  const results = await Promise.all([request(), request()])
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409])
  assert.equal(database.isTransaction, false)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM merchants').get()?.count, 1)
})
