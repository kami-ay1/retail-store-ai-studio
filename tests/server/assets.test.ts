import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openDatabase } from '../../server/database.ts'
import { getAsset, readAssetBytes, saveAsset, saveGeneratedImage } from '../../server/assets.ts'

test('实际 JPEG 截图经过解码后保存，读取保持字节一致并校验归属', async () => {
  const root = resolve('work/tests/assets'); mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(resolve(root, 'run-')), database = openDatabase(resolve(directory, 'test.sqlite'))
  const merchantId = randomUUID(), otherMerchant = randomUUID()
  database.prepare('INSERT INTO merchants VALUES(?,?,?)').run(merchantId, '图片存储验收', new Date().toISOString())
  const bytes = readFileSync(new URL('../fixtures/upload-image.jpg', import.meta.url))
  const asset = await saveAsset(database, directory, merchantId, 'product', '实际工作台截图.jpg', bytes)
  assert.equal(asset.mime, 'image/jpeg')
  assert.ok(asset.width >= 128 && asset.height >= 128)
  assert.deepEqual((await readAssetBytes(database, directory, merchantId, asset.id)).bytes, bytes)
  assert.throws(() => getAsset(database, otherMerchant, asset.id), { status: 404 })
  database.close()
})

test('参考图超过 5 MB 时在解码前拒绝请求', async () => {
  const root = resolve('work/tests/assets'); mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(resolve(root, 'run-')), database = openDatabase(resolve(directory, 'test.sqlite'))
  const merchantId = randomUUID()
  database.prepare('INSERT INTO merchants VALUES(?,?,?)').run(merchantId, '素材边界验收', new Date().toISOString())
  await assert.rejects(saveAsset(database, directory, merchantId, 'model', 'oversized-payload.bin', Buffer.alloc(5 * 1024 * 1024 + 1)), { status: 413 })
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM assets').get()?.count, 0)
  database.close()
})

test('生成结果禁止使用本机地址与未允许的域名', async () => {
  const root = resolve('work/tests/assets'); mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(resolve(root, 'run-')), database = openDatabase(resolve(directory, 'test.sqlite'))
  const merchantId = randomUUID()
  for (const url of ['http://127.0.0.1/private', 'https://example.com/image.jpg']) {
    await assert.rejects(saveGeneratedImage(database, directory, merchantId, url, 'boundary-check'), { status: 502 })
  }
  database.close()
})
