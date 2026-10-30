import { QdrantClient } from '@qdrant/js-client-rest'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { productSchema, productSearchStatusSchema, semanticSearchInputSchema, semanticSearchResultSchema } from '../shared/contracts.ts'
import { config } from './config.ts'
import { embedProductTexts, productEmbedding } from './embeddings.ts'
import { HttpError } from './errors.ts'

const jobSchema = z.object({ productId: z.string(), merchantId: z.string(), version: z.number().int() })
/** 远程 Qdrant 与本地服务使用相同接口，仅在服务端配置连接参数。 */
export type ProductSearchOptions = { url: string; apiKey?: string; collection: string }

/** Qdrant 保存语义索引；商品事实、权限和版本以 SQLite 为准。 */
export class ProductSearch {
  private client: QdrantClient
  private state: z.infer<typeof productSearchStatusSchema>['state'] = 'stopped'
  private error: string | null = null
  private timer?: ReturnType<typeof setInterval>
  private processing?: Promise<void>
  private preparation?: Promise<void>
  private stopped = true

  constructor(private database: DatabaseSync, private options: ProductSearchOptions = {
    url: config.QDRANT_URL, apiKey: config.QDRANT_API_KEY || undefined, collection: config.QDRANT_COLLECTION,
  }) {
    this.client = new QdrantClient({ url: options.url, apiKey: options.apiKey, timeout: 20_000, checkCompatibility: false })
  }

  /** 创建或校验真实索引集合，准备本地模型后开始处理持久化任务。 */
  start() {
    if (this.preparation) return this.preparation
    this.state = 'preparing'; this.error = null; this.stopped = false
    this.database.prepare("UPDATE productSearchIndex SET status='pending' WHERE status='processing'").run()
    const prepare = async () => {
      const exists = await this.client.collectionExists(this.options.collection)
      if (!exists.exists) {
        await this.client.createCollection(this.options.collection, {
          vectors: { size: productEmbedding.dimensions, distance: 'Cosine' },
        })
        // 新集合没有已有向量，本地记录必须重新排入真实同步任务。
        this.database.prepare("UPDATE productSearchIndex SET status='pending',indexedVersion=0,error=NULL").run()
      }
      const collection = await this.client.getCollection(this.options.collection)
      z.object({ size: z.literal(productEmbedding.dimensions), distance: z.literal('Cosine') }).parse(collection.config.params.vectors)
      await this.client.createPayloadIndex(this.options.collection, { field_name: 'merchantId', field_schema: { type: 'keyword', is_tenant: true }, wait: true })
      await this.client.createPayloadIndex(this.options.collection, { field_name: 'category', field_schema: 'keyword', wait: true })
      await this.client.createPayloadIndex(this.options.collection, { field_name: 'stock', field_schema: 'integer', wait: true })
      await embedProductTexts(['商品语义检索服务'])
      if (this.stopped) return
      this.state = 'ready'
      this.timer = setInterval(() => this.wake(), 1000)
      this.timer.unref()
      this.wake()
    }
    this.preparation = prepare().then(() => undefined, (error: unknown) => {
      this.state = 'failed'; this.error = error instanceof Error ? error.message : String(error)
      this.preparation = undefined
      throw error
    })
    return this.preparation
  }

  /** 停止领取新任务，等待已经发出的索引写入结束。 */
  async stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    await this.processing
    this.state = 'stopped'; this.preparation = undefined
  }

  /** 索引数量和错误只读取当前商家的记录。 */
  status(merchantId: string) {
    const counts = this.database.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(status='indexed' AND version=indexedVersion),0) AS indexed,
      COALESCE(SUM(status IN ('pending','processing')),0) AS pending,
      COALESCE(SUM(status='failed'),0) AS failed FROM productSearchIndex WHERE merchantId=?`).get(merchantId)
    const failure = this.database.prepare("SELECT error FROM productSearchIndex WHERE merchantId=? AND status='failed' ORDER BY updatedAt DESC LIMIT 1").get(merchantId)
    return productSearchStatusSchema.parse({ ...counts, state: this.state, error: this.error ?? failure?.error ?? null,
      model: productEmbedding.model, dimensions: productEmbedding.dimensions, collection: this.options.collection })
  }

  /** 用户明确重试时重新连接服务，并重新排入本店失败任务。 */
  async retry(merchantId: string) {
    if (this.state === 'failed' || this.state === 'stopped') await this.start()
    this.database.prepare("UPDATE productSearchIndex SET status='pending',error=NULL WHERE merchantId=? AND status='failed'").run(merchantId)
    this.wake()
    return this.status(merchantId)
  }

  /** 批量领取真实商品的索引任务，后台不自动重试失败请求。 */
  wake() {
    if (this.stopped || this.state !== 'ready' || this.processing) return
    const jobs = z.array(jobSchema).parse(this.database.prepare(`UPDATE productSearchIndex SET status='processing',error=NULL
      WHERE productId IN (SELECT productId FROM productSearchIndex WHERE status='pending' ORDER BY updatedAt LIMIT 16)
      RETURNING productId,merchantId,version`).all())
    if (!jobs.length) return
    this.processing = this.indexBatch(jobs).then(() => { this.processing = undefined; this.wake() }, (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      for (const job of jobs) this.database.prepare("UPDATE productSearchIndex SET status='failed',error=? WHERE productId=? AND version=? AND status='processing'")
        .run(message, job.productId, job.version)
      this.processing = undefined
      console.error('商品索引同步失败', message)
      this.wake()
    })
  }

  private async indexBatch(jobs: z.infer<typeof jobSchema>[]) {
    const products = jobs.map(job => ({ job, product: productSchema.parse(this.database.prepare('SELECT * FROM products WHERE merchantId=? AND id=? AND version=?')
      .get(job.merchantId, job.productId, job.version)) }))
    const vectors = await embedProductTexts(products.map(({ product }) => [
      `商品名称：${product.name}`, `品类：${product.category}`, `颜色：${product.color}`, `材质：${product.material}`, `商品描述：${product.description}`,
    ].join('\n')))
    const points = products.map(({ job, product }, index) => {
      const vector = vectors[index]
      if (!vector) throw new Error('商品向量数量与输入不一致')
      return { id: product.id, vector, payload: { merchantId: job.merchantId, productId: product.id, version: product.version,
        category: product.category, stock: product.stock } }
    })
    await this.client.upsert(this.options.collection, { wait: true, points })
    for (const { job } of products) this.database.prepare("UPDATE productSearchIndex SET indexedVersion=?,status='indexed',error=NULL WHERE productId=? AND version=? AND status='processing'")
      .run(job.version, job.productId, job.version)
  }

  private assertSearchable(merchantId: string) {
    const status = this.status(merchantId)
    if (status.state !== 'ready') throw new HttpError(503, `商品检索服务尚未就绪${status.error ? `：${status.error}` : '，请稍后重试'}`)
    if (status.failed) throw new HttpError(503, '部分商品索引同步失败，请在商品页面重试同步')
    if (status.pending) throw new HttpError(409, '商品资料正在同步，请稍后重新检索')
  }

  /** 按登录商家过滤候选结果，返回前再次核对业务库中的版本和库存。 */
  async search(merchantId: string, value: unknown) {
    const input = semanticSearchInputSchema.parse(value)
    this.assertSearchable(merchantId)
    const started = performance.now()
    const [vector] = await embedProductTexts([input.query], true)
    if (!vector) throw new Error('查询向量为空')
    const candidates = await this.client.query(this.options.collection, {
      query: vector, limit: input.limit * 3, with_payload: true,
      filter: { must: [
        { key: 'merchantId', match: { value: merchantId } },
        ...(input.category ? [{ key: 'category', match: { value: input.category } }] : []),
        ...(input.inStock ? [{ key: 'stock', range: { gt: 0 } }] : []),
      ] },
    })
    const results = []
    for (const point of candidates.points) {
      const payload = z.object({ merchantId: z.string(), productId: z.uuid(), version: z.number().int() }).parse(point.payload)
      if (payload.merchantId !== merchantId) throw new Error('检索结果超出当前商家范围')
      const row = this.database.prepare(`SELECT p.* FROM products p JOIN productSearchIndex s ON p.id=s.productId
        WHERE p.merchantId=? AND p.id=? AND p.version=? AND s.indexedVersion=p.version AND s.status='indexed'`)
        .get(merchantId, payload.productId, payload.version)
      if (!row) continue
      const product = productSchema.parse(row)
      if ((input.inStock && product.stock < 1) || (input.category && product.category !== input.category)) continue
      results.push({ product, score: point.score })
      if (results.length === input.limit) break
    }
    this.assertSearchable(merchantId)
    return semanticSearchResultSchema.parse({ query: input.query, model: productEmbedding.model, results, elapsedMs: Math.round(performance.now() - started) })
  }
}
