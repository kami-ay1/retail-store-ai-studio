import express, { type ErrorRequestHandler } from 'express'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import { CsvError } from 'csv-parse'
import { z, ZodError } from 'zod'
import type { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { config, integrationStatus, projectRoot } from './config.ts'
import { login, logout, readSession, register, requireMerchant } from './auth.ts'
import { listProducts, saveProduct, importProducts } from './catalog.ts'
import { getAsset, listAssets, saveAsset } from './assets.ts'
import { createGeneration, getGeneration, listGenerations } from './generations.ts'
import { getAgentRun, listAgentRuns, startAgentRun } from './agent.ts'
import { changes, listEvents } from './database.ts'
import { HttpError } from './errors.ts'
import { ProductSearch } from './product-search.ts'

/** 创建业务 HTTP 应用，测试和实际服务使用同一个实现。 */
export function createApp(database: DatabaseSync, directory: string, productSearch = new ProductSearch(database)) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '2mb' }))
  app.use(cookieParser())
  app.use('/api', (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const origin = request.headers.origin
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin && origin !== config.WEB_ORIGIN) throw new HttpError(403, '请求来源不受允许')
    next()
  })
  app.get('/api/health', (_request, response) => { response.json({ status: 'ok' }) })
  app.get('/openapi.yaml', (_request, response) => { response.type('application/yaml').sendFile(resolve(projectRoot, 'docs/coze-plugin.yaml')) })
  app.get('/api/auth/session', (request, response) => { response.json(readSession(database, request)) })
  app.post('/api/auth/register', async (request, response) => { response.status(201).json(await register(database, request.body, response)) })
  app.post('/api/auth/login', async (request, response) => { response.json(await login(database, request.body, response)) })
  app.post('/api/auth/logout', (request, response) => { logout(database, request, response); response.json({ success: true }) })
  app.use('/api', requireMerchant(database))
  app.get('/api/integration', (_request, response) => { response.json(integrationStatus()) })
  app.get('/api/products', (request, response) => { response.json(listProducts(database, response.locals.merchant.merchantId, z.string().max(100).parse(request.query.query ?? ''))) })
  app.post('/api/products', (request, response) => {
    const product = saveProduct(database, response.locals.merchant.merchantId, request.body)
    productSearch.wake()
    response.status(201).json(product)
  })
  app.patch('/api/products/:id', (request, response) => {
    const product = saveProduct(database, response.locals.merchant.merchantId, request.body, z.uuid().parse(request.params.id))
    productSearch.wake()
    response.json(product)
  })
  app.get('/api/products/search-index', (_request, response) => { response.json(productSearch.status(response.locals.merchant.merchantId)) })
  app.post('/api/products/search-index/retry', async (_request, response) => { response.status(202).json(await productSearch.retry(response.locals.merchant.merchantId)) })
  app.post('/api/products/search', async (request, response) => { response.json(await productSearch.search(response.locals.merchant.merchantId, request.body)) })
  app.get('/api/products/template', (_request, response) => {
    response.type('text/csv; charset=utf-8').attachment('moyou-products.csv').send('\ufeffsku,name,category,color,material,priceCents,stock,description\r\n')
  })
  const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } })
  app.post('/api/products/import', csvUpload.single('file'), (request, response) => {
    if (!request.file) throw new HttpError(400, '请选择 CSV 商品文件')
    const result = importProducts(database, response.locals.merchant.merchantId, request.file.buffer)
    productSearch.wake()
    response.json(result)
  })
  app.get('/api/assets', (_request, response) => { response.json(listAssets(database, response.locals.merchant.merchantId)) })
  const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
  app.post('/api/assets', imageUpload.single('file'), async (request, response) => {
    if (!request.file) throw new HttpError(400, '请选择图片文件')
    const kind = z.enum(['model', 'product']).parse(request.body.kind)
    response.status(201).json(await saveAsset(database, directory, response.locals.merchant.merchantId, kind, request.file.originalname, request.file.buffer))
  })
  app.get('/api/assets/:id/content', (request, response) => {
    const asset = getAsset(database, response.locals.merchant.merchantId, z.uuid().parse(request.params.id))
    response.type(asset.mime)
    if (request.query.download === '1') response.attachment(`moyou-${asset.id}.${asset.mime.split('/')[1]}`)
    response.sendFile(resolve(directory, 'uploads', asset.filename))
  })
  app.get('/api/generations', (_request, response) => { response.json(listGenerations(database, response.locals.merchant.merchantId)) })
  app.get('/api/generations/:id', (request, response) => { response.json(getGeneration(database, response.locals.merchant.merchantId, z.uuid().parse(request.params.id))) })
  app.post('/api/generations', (request, response) => { response.status(202).json(createGeneration(database, response.locals.merchant.merchantId, request.body)) })
  app.get('/api/agent/runs', (_request, response) => { response.json(listAgentRuns(database, response.locals.merchant.merchantId)) })
  app.get('/api/agent/runs/:id', (request, response) => { response.json(getAgentRun(database, response.locals.merchant.merchantId, z.uuid().parse(request.params.id))) })
  app.post('/api/agent/runs', (request, response) => { response.status(202).json(startAgentRun(database, response.locals.merchant.merchantId, request.body, productSearch)) })
  app.get('/api/events', (request, response) => {
    const merchantId = response.locals.merchant.merchantId
    let cursor = z.coerce.number().int().min(0).parse(request.headers['last-event-id'] ?? 0)
    response.status(200).set({ 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    response.flushHeaders()
    const send = () => {
      let batch = listEvents(database, merchantId, cursor)
      while (batch.length) {
        for (const event of batch) { response.write(`id: ${event.id}\nevent: workspace\ndata: ${JSON.stringify(event)}\n\n`); cursor = event.id }
        if (batch.length < 100) break
        batch = listEvents(database, merchantId, cursor)
      }
    }
    send()
    changes.on(merchantId, send)
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000)
    request.on('close', () => { clearInterval(heartbeat); changes.off(merchantId, send) })
  })
  app.use('/api', () => { throw new HttpError(404, '接口不存在') })
  app.use(express.static(resolve(projectRoot, 'client/dist')))
  const boundary: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.headersSent) { next(error); return }
    if (error instanceof HttpError) { response.status(error.status).json({ message: error.message }); return }
    if (error instanceof ZodError) { response.status(400).json({ message: error.issues.map(issue => `${issue.path.join('.') || '输入'}：${issue.message}`).join('；') }); return }
    if (error instanceof CsvError) { response.status(400).json({ message: `CSV 格式错误：${error.message}` }); return }
    if (error instanceof multer.MulterError) { response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message: '上传文件数量或大小超过限制' }); return }
    console.error('HTTP 请求失败', error)
    response.status(500).json({ message: '服务发生错误，请查看服务端日志' })
  }
  app.use(boundary)
  return app
}
