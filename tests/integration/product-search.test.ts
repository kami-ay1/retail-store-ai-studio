import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve } from 'node:path'
import { QdrantClient } from '@qdrant/js-client-rest'
import { openDatabase } from '../../server/database.ts'
import { getProduct, importProducts, saveProduct, searchProducts } from '../../server/catalog.ts'
import { createApp } from '../../server/app.ts'
import { executeAgentTool } from '../../server/agent.ts'
import { ProductSearch } from '../../server/product-search.ts'
import { productSchema, productSearchStatusSchema, semanticSearchResultSchema, sessionSchema } from '../../shared/contracts.ts'

test('真实 Qdrant、中文模型、商品同步与 HTTP 检索联调', { timeout: 240_000 }, async context => {
  const root = resolve('work/tests/semantic'); mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(resolve(root, 'run-')), database = openDatabase(resolve(directory, 'test.sqlite'))
  const collection = `moyou_acceptance_${randomUUID().replaceAll('-', '')}`
  const options = { url: 'http://127.0.0.1:6333', collection }
  const client = new QdrantClient({ url: options.url, checkCompatibility: false })
  let search = new ProductSearch(database, options)
  const merchantA = randomUUID(), merchantB = randomUUID()
  for (const merchantId of [merchantA, merchantB]) database.prepare('INSERT INTO merchants VALUES(?,?,?)').run(merchantId, '向量检索集成验收', new Date().toISOString())
  const shirt = saveProduct(database, merchantA, { sku: 'A-SHIRT', name: '云絮衬衣', category: '上衣', color: '白色', material: '薄棉', priceCents: 19900, stock: 8, imageAssetId: null,
    description: '春夏通勤衬衫，轻薄柔软，吸湿透气，适合办公、上班和日常穿搭。' })
  const coat = saveProduct(database, merchantA, { sku: 'A-COAT', name: '极寒防风外套', category: '外套', color: '黑色', material: '羽绒', priceCents: 99900, stock: 3, imageAssetId: null,
    description: '冬季高山户外穿着，厚实保暖，适合零下严寒天气。' })
  const unavailable = saveProduct(database, merchantA, { ...shirt, sku: 'A-NO-STOCK', name: '清风夏衬', stock: 0 })
  const foreign = saveProduct(database, merchantB, { ...shirt, sku: 'B-SHIRT' })
  const query = '夏季办公室日常穿着，清爽不闷热'
  assert.equal(searchProducts(database, merchantA, { query }).length, 0)
  await assert.rejects(search.search(merchantA, { query }), { status: 503 })
  await search.start()
  const server = createApp(database, directory, search).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  context.after(async () => { server.closeAllConnections(); server.close(); await search.stop(); database.close() })

  // 等待真实后台任务完成，任何索引错误立即使验收失败。
  const waitForIndex = async (merchantId: string) => {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const state = search.status(merchantId)
      assert.equal(state.failed, 0, state.error ?? '商品索引失败')
      if (state.state === 'ready' && state.pending === 0) { assert.equal(state.indexed, state.total); return }
      await new Promise(resolveWait => setTimeout(resolveWait, 100))
    }
    throw new Error('真实商品索引未在限定时间内完成')
  }
  await waitForIndex(merchantA); await waitForIndex(merchantB)

  await context.test('自然语言检索命中业务相关商品，排除其他商家和无库存商品', async () => {
    const result = await search.search(merchantA, { query })
    assert.equal(result.results[0]?.product.id, shirt.id)
    assert.ok(result.results.every(item => item.product.id !== foreign.id && item.product.id !== unavailable.id))
    assert.ok(result.results.every(item => Number.isFinite(item.score) && item.product.stock > 0))
    const stored = await client.retrieve(collection, { ids: [shirt.id], with_vector: true })
    assert.equal(stored.length, 1); assert.ok(Array.isArray(stored[0].vector))
    assert.equal(stored[0].vector.length, 512)
    console.log(JSON.stringify({ query, firstMatch: result.results[0]?.product.name, elapsedMs: result.elapsedMs, collection }))
  })

  await context.test('品类和库存筛选与当前商家范围同时生效', async () => {
    const coats = await search.search(merchantA, { query: '严冬户外御寒', category: '外套' })
    assert.deepEqual(coats.results.map(item => item.product.id), [coat.id])
    const noStock = await search.search(merchantA, { query, inStock: false })
    assert.ok(noStock.results.some(item => item.product.id === unavailable.id))
    const own = await search.search(merchantB, { query })
    assert.deepEqual(own.results.map(item => item.product.id), [foreign.id])
  })

  await context.test('单个中文字符也是有效的商品检索要求', async () => {
    const result = await search.search(merchantA, { query: '衣' })
    assert.ok(result.results.length > 0)
    assert.ok(result.results.every(item => item.product.id !== foreign.id && item.product.stock > 0))
  })

  await context.test('商品修改后明确等待同步，并返回最新版本、库存和售价', async () => {
    const updated = saveProduct(database, merchantA, { ...shirt, stock: 0, priceCents: 20900 }, shirt.id)
    assert.equal(search.status(merchantA).pending, 1)
    await assert.rejects(search.search(merchantA, { query }), { status: 409 })
    search.wake(); await waitForIndex(merchantA)
    const inStock = await search.search(merchantA, { query })
    assert.ok(inStock.results.every(item => item.product.id !== shirt.id))
    const all = await search.search(merchantA, { query, inStock: false })
    const found = all.results.find(item => item.product.id === shirt.id)
    assert.equal(found?.product.version, updated.version); assert.equal(found?.product.priceCents, 20900)
    const [point] = await client.retrieve(collection, { ids: [shirt.id], with_payload: true })
    assert.equal(point.payload?.version, updated.version); assert.equal(point.payload?.stock, 0)
  })

  await context.test('CSV 按 SKU 更新后自动产生索引任务，搜索使用更新后的商品资料', async () => {
    importProducts(database, merchantA, Buffer.from('sku,name,category,color,material,priceCents,stock,description\nA-SHIRT,暖冬高领毛衣,针织,米白,羊绒,32900,6,寒冷天气穿着的厚实针织衫\n'))
    search.wake(); await waitForIndex(merchantA)
    const result = await search.search(merchantA, { query: '冬天保暖的羊绒服装', category: '针织' })
    assert.equal(result.results[0]?.product.id, shirt.id)
    assert.equal(result.results[0]?.product.name, '暖冬高领毛衣')
    assert.equal(result.results[0]?.product.version, 3)
  })

  await context.test('Agent 商品检索工具调用同一真实语义检索服务', async () => {
    const result = await executeAgentTool(database, merchantA, randomUUID(), { id: randomUUID(), type: 'function', function: {
      name: 'search_products', arguments: JSON.stringify({ query: '严冬户外御寒', category: '外套', inStock: true, limit: 8 }),
    } }, search)
    assert.ok('products' in result && result.products)
    assert.deepEqual(result.products.map(item => item.id), [coat.id])
    const listed = await executeAgentTool(database, merchantB, randomUUID(), { id: randomUUID(), type: 'function', function: { name: 'search_products', arguments: '{"query":""}' } }, search)
    assert.ok('products' in listed && listed.products); assert.deepEqual(listed.products.map(item => item.id), [foreign.id])
  })

  await context.test('真实 HTTP 登录鉴权、参数校验与商家隔离', async () => {
    const anonymous = await fetch(`${base}/api/products/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
    assert.equal(anonymous.status, 401)
    const registered = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      merchantName: '语义接口验收商家', email: `${randomUUID()}@example.com`, password: 'Semantic-Acceptance-2026!',
    }) })
    assert.equal(registered.status, 201)
    const account = sessionSchema.parse(await registered.json()), cookie = registered.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)
    const headers = { 'Content-Type': 'application/json', Cookie: cookie }
    const created = await fetch(`${base}/api/products`, { method: 'POST', headers, body: JSON.stringify({ ...coat, sku: 'HTTP-SUIT', name: '商务西装', category: '西装', description: '适合会议、面试和正式商务场合', stock: 4 }) })
    assert.equal(created.status, 201)
    const product = productSchema.parse(await created.json())
    await waitForIndex(account.merchantId)
    const response = await fetch(`${base}/api/products/search`, { method: 'POST', headers, body: JSON.stringify({ query: '开会穿的正式服装' }) })
    assert.equal(response.status, 200)
    const result = semanticSearchResultSchema.parse(await response.json())
    assert.deepEqual(result.results.map(item => item.product.id), [product.id])
    const status = await fetch(`${base}/api/products/search-index`, { headers })
    assert.equal(productSearchStatusSchema.parse(await status.json()).total, 1)
    const injected = await fetch(`${base}/api/products/search`, { method: 'POST', headers, body: JSON.stringify({ query, merchantId: merchantA }) })
    assert.equal(injected.status, 400)
  })

  await context.test('业务资料版本不匹配的向量不能作为搜索结果返回', async () => {
    await client.setPayload(collection, { wait: true, points: [coat.id], payload: { version: 999 } })
    const result = await search.search(merchantA, { query: '严冬户外御寒', category: '外套' })
    assert.equal(result.results.length, 0)
    const current = getProduct(database, merchantA, coat.id)
    saveProduct(database, merchantA, current, current.id)
    search.wake(); await waitForIndex(merchantA)
    assert.equal((await search.search(merchantA, { query: '严冬户外御寒', category: '外套' })).results[0]?.product.id, coat.id)
  })

  await context.test('检索服务重启后复用持久化集合与索引记录', async () => {
    await search.stop()
    search = new ProductSearch(database, options)
    await search.start(); await waitForIndex(merchantA)
    const result = await search.search(merchantA, { query: '严冬户外御寒', category: '外套' })
    assert.equal(result.results[0]?.product.id, coat.id)
  })

  await context.test('连接新集合时从业务资料重新建立已有商品索引', async () => {
    await search.stop()
    search = new ProductSearch(database, { ...options, collection: `moyou_rebuild_${randomUUID().replaceAll('-', '')}` })
    await search.start(); await waitForIndex(merchantA)
    const result = await search.search(merchantA, { query: '严冬户外御寒', category: '外套' })
    assert.equal(result.results[0]?.product.id, coat.id)
  })

  await context.test('连接错误明确返回失败状态，不切换成关键词搜索', async () => {
    const disconnected = new ProductSearch(database, { ...options, url: 'http://127.0.0.1:1' })
    await assert.rejects(disconnected.start())
    assert.equal(disconnected.status(merchantA).state, 'failed')
    assert.ok(disconnected.status(merchantA).error)
    await assert.rejects(disconnected.search(merchantA, { query }), { status: 503 })
    await disconnected.stop()
  })
})
