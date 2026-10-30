import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { isUtf8 } from 'node:buffer'
import { parse } from 'csv-parse/sync'
import { z } from 'zod'
import { productInputSchema, productSchema, searchProductsSchema } from '../shared/contracts.ts'
import { HttpError } from './errors.ts'

const columns = 'id,sku,name,category,color,material,priceCents,stock,description,imageAssetId,version,updatedAt'
const csvRow = productInputSchema.omit({ imageAssetId: true }).extend({
  priceCents: z.string().trim().min(1, '售价不能为空').pipe(z.coerce.number<string>().int().min(0).max(100_000_000)),
  stock: z.string().trim().min(1, '库存不能为空').pipe(z.coerce.number<string>().int().min(0).max(10_000_000)),
}).strict()

/** 获取本店单件商品，跨商家 ID 同样返回不存在。 */
export function getProduct(database: DatabaseSync, merchantId: string, productId: string) {
  const row = database.prepare(`SELECT ${columns} FROM products WHERE merchantId=? AND id=?`).get(merchantId, productId)
  if (!row) throw new HttpError(404, '商品不存在或不属于当前商家')
  return productSchema.parse(row)
}

/** 商品列表和 Agent 使用同一查询边界，参数不允许指定商家。 */
export function searchProducts(database: DatabaseSync, merchantId: string, value: unknown) {
  const input = searchProductsSchema.parse(value)
  const term = `%${input.query}%`
  return database.prepare(`SELECT ${columns} FROM products WHERE merchantId=?
    AND (name LIKE ? OR sku LIKE ? OR category LIKE ? OR description LIKE ?)
    AND (?='' OR category=?) AND (?=0 OR stock>0) ORDER BY updatedAt DESC LIMIT ?`)
    .all(merchantId, term, term, term, term, input.category ?? '', input.category ?? '', Number(input.inStock), input.limit)
    .map(row => productSchema.parse(row))
}

/** 商家工作台读取完整商品资料，库存为零的商品仍保留记录。 */
export function listProducts(database: DatabaseSync, merchantId: string, query: string) {
  const term = `%${query}%`
  return database.prepare(`SELECT ${columns} FROM products WHERE merchantId=? AND (name LIKE ? OR sku LIKE ? OR category LIKE ?) ORDER BY updatedAt DESC`)
    .all(merchantId, term, term, term).map(row => productSchema.parse(row))
}

/** 新增与编辑商品均校验素材归属，编辑使用显式版本防止覆盖他人修改。 */
export function saveProduct(database: DatabaseSync, merchantId: string, value: unknown, id?: string) {
  const input = productInputSchema.extend({ version: z.number().int().positive().optional() }).parse(value)
  if (input.imageAssetId && !database.prepare("SELECT id FROM assets WHERE merchantId=? AND id=? AND kind='product'").get(merchantId, input.imageAssetId)) {
    throw new HttpError(400, '请选择当前商家的商品图片')
  }
  const existingSku = database.prepare('SELECT id FROM products WHERE merchantId=? AND sku=?').get(merchantId, input.sku)
  if (existingSku && existingSku.id !== id) throw new HttpError(409, '该商品编码已经存在')
  const productId = id ?? randomUUID(), updatedAt = new Date().toISOString()
  if (id) {
    getProduct(database, merchantId, id)
    if (!input.version) throw new HttpError(400, '编辑商品缺少版本信息')
    const result = database.prepare(`UPDATE products SET sku=?,name=?,category=?,color=?,material=?,priceCents=?,stock=?,description=?,imageAssetId=?,version=version+1,updatedAt=? WHERE merchantId=? AND id=? AND version=?`)
      .run(input.sku, input.name, input.category, input.color, input.material, input.priceCents, input.stock, input.description, input.imageAssetId, updatedAt, merchantId, id, input.version)
    if (result.changes !== 1) throw new HttpError(409, '商品已被修改，请重新加载后编辑')
  } else {
    database.prepare('INSERT INTO products(id,merchantId,sku,name,category,color,material,priceCents,stock,description,imageAssetId,version,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?)')
      .run(productId, merchantId, input.sku, input.name, input.category, input.color, input.material, input.priceCents, input.stock, input.description, input.imageAssetId, updatedAt)
  }
  return getProduct(database, merchantId, productId)
}

/** 使用成熟 CSV 库解析格式，校验完整文件后在同一事务中导入商品资料。 */
export function importProducts(database: DatabaseSync, merchantId: string, content: Buffer) {
  if (!isUtf8(content)) throw new HttpError(400, 'CSV 必须使用 UTF-8 编码，请从表格软件另存为 CSV UTF-8')
  const rows = z.array(csvRow).min(1, 'CSV 中没有商品记录').max(2000, '一次最多导入 2000 条商品')
    .parse(parse(content, { columns: true, bom: true, skip_empty_lines: true, trim: true }))
  if (new Set(rows.map(row => row.sku)).size !== rows.length) throw new HttpError(400, 'CSV 内存在重复商品编码，请修正后导入')
  const now = new Date().toISOString()
  const statement = database.prepare(`INSERT INTO products(id,merchantId,sku,name,category,color,material,priceCents,stock,description,imageAssetId,version,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,NULL,1,?) ON CONFLICT(merchantId,sku) DO UPDATE SET name=excluded.name,category=excluded.category,color=excluded.color,
    material=excluded.material,priceCents=excluded.priceCents,stock=excluded.stock,description=excluded.description,version=products.version+1,updatedAt=excluded.updatedAt`)
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const row of rows) statement.run(randomUUID(), merchantId, row.sku, row.name, row.category, row.color, row.material, row.priceCents, row.stock, row.description, now)
    database.exec('COMMIT')
  } finally {
    if (database.isTransaction) database.exec('ROLLBACK')
  }
  return { imported: rows.length }
}
