import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { ChatEventType, RoleType, type CreateChatData, type StreamChatData, type ToolCallType } from '@coze/api'
import { z } from 'zod'
import { agentRunSchema, getProductSchema, planInputSchema, planSchema, searchProductsSchema } from '../shared/contracts.ts'
import { appendEvent } from './database.ts'
import { getProduct, searchProducts } from './catalog.ts'
import { config } from './config.ts'
import { getCozeClient } from './coze.ts'
import { HttpError } from './errors.ts'
import { ProductSearch } from './product-search.ts'

/** Agent 工具只接受有限业务参数，商家身份由当前运行上下文固定。 */
export function executeAgentTool(database: DatabaseSync, merchantId: string, runId: string, tool: ToolCallType, productSearch = new ProductSearch(database)) {
  const argumentsValue: unknown = JSON.parse(tool.function.arguments)
  if (tool.function.name === 'search_products') {
    const input = searchProductsSchema.parse(argumentsValue)
    // 空查询明确表示列出本店商品；有自然语言要求时执行真实向量检索。
    if (!input.query) return { products: searchProducts(database, merchantId, input) }
    return productSearch.search(merchantId, input).then(result => ({ products: result.results.map(item => item.product) }))
  }
  if (tool.function.name === 'get_product') return { product: getProduct(database, merchantId, getProductSchema.parse(argumentsValue).productId) }
  if (tool.function.name === 'propose_outfit') {
    const input = planInputSchema.parse(argumentsValue)
    const product = getProduct(database, merchantId, input.productId)
    if (product.version !== input.productVersion || product.stock < 1) throw new HttpError(409, '方案中的商品已变化或暂不可售，请重新读取商品')
    const plan = planSchema.parse({ ...input, id: randomUUID(), createdAt: new Date().toISOString() })
    database.prepare('INSERT INTO plans(id,merchantId,agentRunId,data,createdAt) VALUES(?,?,?,?,?)')
      .run(plan.id, merchantId, runId, JSON.stringify(plan), plan.createdAt)
    return { plan, requiresMerchantReview: true }
  }
  throw new HttpError(422, `Agent 请求了未授权的工具：${tool.function.name}`)
}

/** 获取一次 Agent 运行及其实际工具调用记录。 */
export function getAgentRun(database: DatabaseSync, merchantId: string, id: string) {
  const row = database.prepare('SELECT id,request,status,createdAt FROM agentRuns WHERE merchantId=? AND id=?').get(merchantId, id)
  if (!row) throw new HttpError(404, 'Agent 记录不存在')
  const events = database.prepare("SELECT id,kind,payload,createdAt FROM events WHERE merchantId=? AND entityId=? AND entityType='agent' ORDER BY id")
    .all(merchantId, id).map(event => {
      const stored = z.object({ id: z.number(), kind: z.string(), payload: z.string(), createdAt: z.string() }).parse(event)
      return { id: stored.id, kind: stored.kind, createdAt: stored.createdAt, ...z.record(z.string(), z.unknown()).parse(JSON.parse(stored.payload)) }
    })
  const plans = database.prepare('SELECT data FROM plans WHERE merchantId=? AND agentRunId=? ORDER BY createdAt').all(merchantId, id)
    .map(item => planSchema.parse(JSON.parse(z.string().parse(item.data))))
  return agentRunSchema.parse({ ...row, events, plans })
}

/** 商家可以重新查看已有策划记录。 */
export function listAgentRuns(database: DatabaseSync, merchantId: string) {
  return database.prepare('SELECT id FROM agentRuns WHERE merchantId=? ORDER BY createdAt DESC LIMIT 20').all(merchantId)
    .map(item => getAgentRun(database, merchantId, z.string().parse(item.id)))
}

/** 发起真实 Coze Agent 对话，并在服务端执行端插件请求。 */
export function startAgentRun(database: DatabaseSync, merchantId: string, value: unknown, productSearch = new ProductSearch(database)) {
  const client = getCozeClient('agent')
  const input = z.object({ request: z.string().trim().min(2).max(2000) }).parse(value)
  if (database.prepare("SELECT id FROM agentRuns WHERE merchantId=? AND status='running'").get(merchantId)) throw new HttpError(409, '当前还有搭配策划正在进行')
  const id = randomUUID()
  database.prepare("INSERT INTO agentRuns(id,merchantId,request,status,createdAt) VALUES(?,?,?,'running',?)").run(id, merchantId, input.request, new Date().toISOString())
  appendEvent(database, merchantId, 'agent', id, 'status', { text: '正在理解搭配要求并查询本店商品' })
  const run = async () => {
    let stream: AsyncIterable<StreamChatData> = client.chat.stream({
      bot_id: config.COZE_BOT_ID, user_id: merchantId, auto_save_history: true,
      additional_messages: [{ role: RoleType.User, content_type: 'text', content: input.request }],
    }, { signal: AbortSignal.timeout(180_000) })
    let toolCount = 0
    let finished = false
    for (let round = 0; round < 8; round += 1) {
      let action: CreateChatData | undefined
      for await (const event of stream) {
        if (event.event === ChatEventType.CONVERSATION_CHAT_REQUIRES_ACTION) action = event.data
        if (event.event === ChatEventType.CONVERSATION_MESSAGE_COMPLETED && event.data.type === 'answer') {
          appendEvent(database, merchantId, 'agent', id, 'answer', { text: event.data.content })
        }
        if (event.event === ChatEventType.CONVERSATION_CHAT_COMPLETED) finished = true
        if (event.event === ChatEventType.CONVERSATION_CHAT_FAILED) throw new HttpError(502, event.data.last_error?.msg || 'Coze Agent 执行失败')
        if (event.event === ChatEventType.ERROR) throw new HttpError(502, event.data.msg)
      }
      if (finished) break
      if (!action?.required_action?.submit_tool_outputs.tool_calls.length) throw new HttpError(502, 'Coze Agent 未完成对话，也未返回有效工具请求')
      const outputs = []
      for (const tool of action.required_action.submit_tool_outputs.tool_calls) {
        toolCount += 1
        if (toolCount > 16) throw new HttpError(502, 'Agent 超过单次工具调用上限')
        appendEvent(database, merchantId, 'agent', id, 'tool_call', { text: '正在调用业务工具', tool: tool.function.name, data: JSON.parse(tool.function.arguments) })
        const result = await executeAgentTool(database, merchantId, id, tool, productSearch)
        appendEvent(database, merchantId, 'agent', id, 'tool_result', { text: '业务工具已返回真实数据', tool: tool.function.name, data: result })
        outputs.push({ tool_call_id: tool.id, output: JSON.stringify(result) })
      }
      stream = client.chat.submitToolOutputs({ conversation_id: action.conversation_id, chat_id: action.id, tool_outputs: outputs, stream: true, auto_save_history: true }, { signal: AbortSignal.timeout(180_000) })
    }
    if (!finished) throw new HttpError(502, 'Agent 未在限定轮次内完成策划')
    database.prepare("UPDATE agentRuns SET status='completed' WHERE id=?").run(id)
    appendEvent(database, merchantId, 'agent', id, 'status', { text: '搭配策划已完成，请检查并采纳方案' })
  }
  void run().then(undefined, (error: unknown) => {
    const message = error instanceof Error ? error.message : 'Agent 发生未知错误'
    database.prepare("UPDATE agentRuns SET status='failed' WHERE id=?").run(id)
    appendEvent(database, merchantId, 'agent', id, 'error', { text: message })
    console.error('Agent 策划失败', id, message)
  })
  return getAgentRun(database, merchantId, id)
}
