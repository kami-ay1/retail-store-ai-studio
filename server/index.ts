import { resolve } from 'node:path'
import { openDatabase } from './database.ts'
import { config, dataDirectory } from './config.ts'
import { createApp } from './app.ts'
import { GenerationWorker } from './generations.ts'
import { ProductSearch } from './product-search.ts'

const database = openDatabase(resolve(dataDirectory, 'moyou.sqlite'))
const productSearch = new ProductSearch(database)
const app = createApp(database, dataDirectory, productSearch)
const worker = new GenerationWorker(database, dataDirectory)
const server = app.listen(config.PORT, '127.0.0.1', () => {
  database.prepare("UPDATE agentRuns SET status='interrupted' WHERE status='running'").run()
  worker.start()
  void productSearch.start().then(undefined, (error: unknown) => { console.error('商品检索服务启动失败', error) })
  console.log(`店搭 AI 门店服务：http://127.0.0.1:${config.PORT}`)
})
server.on('error', error => { throw error })
process.once('SIGTERM', () => { worker.stop(); void productSearch.stop(); server.close() })
process.once('SIGINT', () => { worker.stop(); void productSearch.stop(); server.close() })
