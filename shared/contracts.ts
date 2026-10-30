import { z } from 'zod'

/** 账户注册同时创建独立的商家资料。 */
export const registerSchema = z.object({
  merchantName: z.string().trim().min(2).max(60),
  email: z.email().max(160).transform(value => value.toLowerCase()),
  password: z.string().min(10).max(128),
})
/** 登录只接受账户凭据，商家身份由服务端会话确定。 */
export const loginSchema = registerSchema.pick({ email: true, password: true })
/** 商家商品的业务输入，价格使用整数分保存。 */
export const productInputSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(40),
  color: z.string().trim().max(40),
  material: z.string().trim().max(100),
  priceCents: z.number().int().min(0).max(100_000_000),
  stock: z.number().int().min(0).max(10_000_000),
  description: z.string().trim().max(1500),
  imageAssetId: z.uuid().nullable(),
})
/** API 返回的商品保留服务端版本，生成前核对商品是否发生变更。 */
export const productSchema = productInputSchema.extend({ id: z.uuid(), version: z.number().int().positive(), updatedAt: z.string() })
/** 所有素材均由实际上传创建。 */
export const assetSchema = z.object({
  id: z.uuid(), name: z.string(), mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  kind: z.enum(['model', 'product', 'result']), width: z.number().int().positive(), height: z.number().int().positive(),
  size: z.number().int().positive(), createdAt: z.string(),
})
/** 生图任务使用当前商家的商品和素材，重复请求使用同一幂等标识。 */
export const generationInputSchema = z.object({
  requestKey: z.uuid(), productId: z.uuid(), productVersion: z.number().int().positive(),
  modelAssetId: z.uuid(), productAssetId: z.uuid(),
  scene: z.string().trim().min(1).max(500), style: z.string().trim().min(1).max(200),
  instructions: z.string().trim().max(2000), ratio: z.literal('3:4'),
  planId: z.uuid().optional(),
})
/** 任务状态来自持久化记录，不使用估算进度。 */
export const generationSchema = z.object({
  id: z.uuid(), status: z.enum(['queued', 'running', 'succeeded', 'failed', 'interrupted']),
  input: generationInputSchema, product: productSchema, prompt: z.string(),
  resultAssetIds: z.array(z.uuid()), error: z.string().nullable(), debugUrl: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string(),
})
/** 搭配策划结果只引用本店实际商品，用户采纳后才能发起生图。 */
export const planInputSchema = z.object({
  productId: z.uuid(), productVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(100), scene: z.string().trim().min(1).max(500),
  style: z.string().trim().min(1).max(200), instructions: z.string().trim().max(2000),
  rationale: z.string().trim().min(1).max(1500),
})
/** Agent 生成方案的持久化记录。 */
export const planSchema = planInputSchema.extend({ id: z.uuid(), createdAt: z.string() })
/** Agent 工具事件记录可供商家检查使用了哪些业务资料。 */
export const agentEventSchema = z.object({
  id: z.number().int(), kind: z.enum(['status', 'tool_call', 'tool_result', 'answer', 'error']),
  text: z.string(), tool: z.string().optional(), data: z.unknown().optional(), createdAt: z.string(),
})
/** Agent 请求记录与运行状态。 */
export const agentRunSchema = z.object({
  id: z.uuid(), request: z.string(), status: z.enum(['running', 'completed', 'failed', 'interrupted']),
  events: z.array(agentEventSchema), plans: z.array(planSchema), createdAt: z.string(),
})
/** 当前登录账户与商家信息。 */
export const sessionSchema = z.object({ id: z.uuid(), merchantId: z.uuid(), merchantName: z.string(), email: z.email() })
/** 只公开连接状态，API Token 始终保留在服务端。 */
export const integrationSchema = z.object({
  imageReady: z.boolean(), agentReady: z.boolean(), workflowId: z.string().nullable(), botId: z.string().nullable(),
  workflowPublished: z.boolean(), agentPublished: z.boolean(),
})
/** Agent 搜索本店商品的工具参数。 */
export const searchProductsSchema = z.object({
  query: z.string().trim().max(100), category: z.string().trim().max(40).optional(),
  inStock: z.boolean().default(true), limit: z.number().int().min(1).max(12).default(8),
})
/** Agent 查询单件商品的工具参数。 */
export const getProductSchema = z.object({ productId: z.uuid() })

/** 语义搜索只接受业务筛选条件，商家身份始终来自登录会话。 */
export const semanticSearchInputSchema = searchProductsSchema.extend({ query: z.string().trim().min(1).max(100) }).strict()
/** 返回真实商品资料和向量相关性分数，分数不表示匹配概率。 */
export const semanticSearchResultSchema = z.object({
  query: z.string(), model: z.string(), elapsedMs: z.number().nonnegative(),
  results: z.array(z.object({ product: productSchema, score: z.number().finite() })),
})
/** 当前商家的索引状态与本机检索服务状态。 */
export const productSearchStatusSchema = z.object({
  state: z.enum(['stopped', 'preparing', 'ready', 'failed']),
  total: z.number().int().nonnegative(), indexed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
  error: z.string().nullable(), model: z.string(), dimensions: z.number().int().positive(),
  collection: z.string(),
})

/** 前后端共用的商品类型。 */
export type Product = z.infer<typeof productSchema>
/** 前后端共用的素材类型。 */
export type Asset = z.infer<typeof assetSchema>
/** 前后端共用的任务类型。 */
export type Generation = z.infer<typeof generationSchema>
/** 前后端共用的任务输入。 */
export type GenerationInput = z.infer<typeof generationInputSchema>
/** 前后端共用的策划结果类型。 */
export type OutfitPlan = z.infer<typeof planSchema>
/** 前后端共用的 Agent 运行类型。 */
export type AgentRun = z.infer<typeof agentRunSchema>
/** 前后端共用的会话类型。 */
export type MerchantSession = z.infer<typeof sessionSchema>
