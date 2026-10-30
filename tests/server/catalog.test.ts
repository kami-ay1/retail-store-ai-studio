import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve } from 'node:path'
import { openDatabase } from '../../server/database.ts'
import { getProduct, importProducts, listProducts, saveProduct, searchProducts } from '../../server/catalog.ts'

const root = resolve('work/tests/catalog'); mkdirSync(root, { recursive: true })

test('CSV 引号与中文内容按格式解析，重复编码更新商品版本', () => {
  const database = openDatabase(resolve(mkdtempSync(resolve(root, 'run-')), 'test.sqlite'))
  const merchantId = randomUUID(); database.prepare('INSERT INTO merchants VALUES(?,?,?)').run(merchantId, '商品导入验收', new Date().toISOString())
  const csv = Buffer.from('sku,name,category,color,material,priceCents,stock,description\nSKU-001,亚麻连衣裙,连衣裙,米白,亚麻,29900,8,"自然纹理,可搭配草编包"\n')
  assert.equal(importProducts(database, merchantId, csv).imported, 1)
  const first = listProducts(database, merchantId, '')[0]
  assert.ok(first); assert.equal(first.description, '自然纹理,可搭配草编包'); assert.equal(first.priceCents, 29900)
  importProducts(database, merchantId, csv)
  const updated = getProduct(database, merchantId, first.id)
  assert.equal(updated.id, first.id); assert.equal(updated.version, 2)
  database.close()
})

test('CSV 中缺少库存或售价时明确拒绝，不能自动转换成零', () => {
  const database = openDatabase(resolve(mkdtempSync(resolve(root, 'run-')), 'test.sqlite'))
  const merchantId = randomUUID(); database.prepare('INSERT INTO merchants VALUES(?,?,?)').run(merchantId, '必填资料验收', new Date().toISOString())
  for (const row of ['A1,上衣,上衣,黑色,棉,,3,通勤', 'A2,上衣,上衣,黑色,棉,10000,,通勤']) {
    assert.throws(() => importProducts(database, merchantId, Buffer.from(`sku,name,category,color,material,priceCents,stock,description\n${row}\n`)))
  }
  assert.equal(listProducts(database, merchantId, '').length, 0)
  database.close()
})

test('CSV 编码无效时拒绝写入，避免商品资料出现替换字符', () => {
  const database = openDatabase(resolve(mkdtempSync(resolve(root, 'run-')), 'test.sqlite'))
  const merchantId = randomUUID(); database.prepare('INSERT INTO merchants VALUES(?,?,?)').run(merchantId, '编码校验验收', new Date().toISOString())
  const invalid = Buffer.concat([Buffer.from('sku,name,category,color,material,priceCents,stock,description\nUTF8-001,上衣,上衣,黑色,棉,10000,1,资料'), Buffer.from([0xff])])
  assert.throws(() => importProducts(database, merchantId, invalid), { status: 400 })
  assert.equal(listProducts(database, merchantId, '').length, 0)
  database.close()
})

test('成功导入超过一千条商品后列表仍返回完整资料', () => {
  const database = openDatabase(resolve(mkdtempSync(resolve(root, 'run-')), 'test.sqlite'))
  const merchantId = randomUUID(); database.prepare('INSERT INTO merchants VALUES(?,?,?)').run(merchantId, '完整列表验收', new Date().toISOString())
  const rows = Array.from({ length: 1001 }, (_, index) => `IMPORT-${index},导入验收上衣${index},上衣,黑色,棉,10000,1,列表完整性验收`)
  importProducts(database, merchantId, Buffer.from(['sku,name,category,color,material,priceCents,stock,description', ...rows].join('\n')))
  assert.equal(listProducts(database, merchantId, '').length, 1001)
  database.close()
})

test('CSV 任意一行无效时整份文件不写入', () => {
  const database = openDatabase(resolve(mkdtempSync(resolve(root, 'run-')), 'test.sqlite'))
  const merchantId = randomUUID(); database.prepare('INSERT INTO merchants VALUES(?,?,?)').run(merchantId, '导入校验验收', new Date().toISOString())
  const csv = Buffer.from('sku,name,category,color,material,priceCents,stock,description\nSKU-A,棉质衬衫,衬衫,白色,棉,10000,3,通勤\nSKU-B,针织衫,上衣,蓝色,羊毛,15000,-1,秋季\n')
  assert.throws(() => importProducts(database, merchantId, csv))
  assert.equal(listProducts(database, merchantId, '').length, 0)
  assert.equal(database.isTransaction, false)
  database.close()
})

test('商品编辑版本冲突被拒绝，查询始终限定当前商家', () => {
  const database = openDatabase(resolve(mkdtempSync(resolve(root, 'run-')), 'test.sqlite'))
  const merchantA = randomUUID(), merchantB = randomUUID()
  for (const merchantId of [merchantA, merchantB]) database.prepare('INSERT INTO merchants VALUES(?,?,?)').run(merchantId, '商家隔离验收', new Date().toISOString())
  const product = saveProduct(database, merchantA, { sku: 'A1', name: '白色衬衫', category: '衬衫', color: '白色', material: '棉', priceCents: 10000, stock: 5, description: '通勤', imageAssetId: null })
  saveProduct(database, merchantA, { ...product, name: '白色长袖衬衫' }, product.id)
  assert.throws(() => saveProduct(database, merchantA, { ...product, name: '过期的修改' }, product.id), { status: 409 })
  assert.throws(() => getProduct(database, merchantB, product.id), { status: 404 })
  assert.equal(searchProducts(database, merchantB, { query: '衬衫' }).length, 0)
  assert.equal(getProduct(database, merchantA, product.id).name, '白色长袖衬衫')
  database.close()
})
