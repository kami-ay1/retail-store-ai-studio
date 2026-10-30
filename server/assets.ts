import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { z } from 'zod'
import { assetSchema } from '../shared/contracts.ts'
import { HttpError } from './errors.ts'

const storedAssetSchema = assetSchema.extend({ filename: z.string() })
const mimeFormats = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/** 读取素材时始终核验商家归属，磁盘路径由系统生成。 */
export function getAsset(database: DatabaseSync, merchantId: string, assetId: string) {
  const row = database.prepare('SELECT * FROM assets WHERE merchantId=? AND id=?').get(merchantId, assetId)
  if (!row) throw new HttpError(404, '图片不存在或不属于当前商家')
  return storedAssetSchema.parse(row)
}

/** 验证真实图片格式和尺寸后保留原文件，不生成占位图片。 */
export async function saveAsset(database: DatabaseSync, directory: string, merchantId: string, kind: 'model' | 'product' | 'result', name: string, buffer: Buffer) {
  const sizeLimit = kind === 'result' ? 12 : 5
  if (buffer.length > sizeLimit * 1024 * 1024) throw new HttpError(413, `单张图片不能超过 ${sizeLimit} MB`)
  const metadata = await sharp(buffer, { limitInputPixels: 24_000_000 }).metadata()
  const format = z.enum(['jpeg', 'png', 'webp']).parse(metadata.format)
  if (!metadata.width || !metadata.height || metadata.width < 128 || metadata.height < 128) throw new HttpError(400, '图片宽高需要至少 128 像素')
  const id = randomUUID(), filename = `${id}.${format}`
  const asset = assetSchema.parse({ id, name: name.slice(0, 200), mime: mimeFormats[format], kind, width: metadata.width, height: metadata.height, size: buffer.length, createdAt: new Date().toISOString() })
  await mkdir(resolve(directory, 'uploads'), { recursive: true })
  await writeFile(resolve(directory, 'uploads', filename), buffer, { flag: 'wx' })
  database.prepare('INSERT INTO assets(id,merchantId,name,mime,kind,width,height,size,filename,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, merchantId, asset.name, asset.mime, kind, asset.width, asset.height, asset.size, filename, asset.createdAt)
  return asset
}

/** 仅向授权调用方读取素材字节。 */
export async function readAssetBytes(database: DatabaseSync, directory: string, merchantId: string, assetId: string) {
  const asset = getAsset(database, merchantId, assetId)
  return { asset, bytes: await readFile(resolve(directory, 'uploads', asset.filename)) }
}

/** 素材库按实际上传时间显示。 */
export function listAssets(database: DatabaseSync, merchantId: string) {
  return database.prepare('SELECT * FROM assets WHERE merchantId=? ORDER BY createdAt DESC LIMIT 300').all(merchantId)
    .map(row => assetSchema.parse(row))
}

/** Coze 返回的图片只从图像服务 CDN 下载，禁止访问任意内部地址。 */
export async function saveGeneratedImage(database: DatabaseSync, directory: string, merchantId: string, url: string, taskId: string) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port
      || !['byteimg.com', 'volces.com', 'volcengine.com'].some(host => parsed.hostname.endsWith(`.${host}`))) {
    throw new HttpError(502, '图像结果未返回支持的 Coze 图片 CDN 地址')
  }
  const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new HttpError(502, `生成图片下载失败（${response.status}）`)
  if (Number(response.headers.get('content-length')) > 12 * 1024 * 1024) throw new HttpError(502, '生成图片超过大小限制')
  const chunks: Uint8Array[] = []
  let size = 0
  if (!response.body) throw new HttpError(502, '生成图片响应为空')
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > 12 * 1024 * 1024) throw new HttpError(502, '生成图片超过大小限制')
    chunks.push(chunk)
  }
  return saveAsset(database, directory, merchantId, 'result', `搭配图-${taskId.slice(0, 8)}`, Buffer.concat(chunks))
}
