import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { z } from 'zod'

export const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const envPath = resolve(projectRoot, '.env')
if (existsSync(envPath)) process.loadEnvFile(envPath)

/** 配置在启动时校验；Coze 凭据为空时明确禁用 AI 接口。 */
export const config = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(4317),
  WEB_ORIGIN: z.url().default('http://127.0.0.1:5173'),
  DATA_DIR: z.string().min(1).default('.data'),
  COZE_API_TOKEN: z.string().default(''),
  COZE_WORKFLOW_ID: z.string().regex(/^\d*$/).default(''),
  COZE_BOT_ID: z.string().regex(/^\d*$/).default(''),
  COZE_WORKFLOW_PUBLISHED: z.stringbool().default(false),
  COZE_AGENT_PUBLISHED: z.stringbool().default(false),
  QDRANT_URL: z.url().default('http://127.0.0.1:6333'),
  QDRANT_API_KEY: z.string().default(''),
  QDRANT_COLLECTION: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).default('moyou_products_bge_small_zh_v1_5'),
}).parse(process.env)

/** 项目数据仅保存到独立的数据目录。 */
export const dataDirectory = resolve(projectRoot, config.DATA_DIR)

/** 提供不包含任何访问令牌的连接状态。 */
export const integrationStatus = () => ({
  imageReady: Boolean(config.COZE_WORKFLOW_PUBLISHED && config.COZE_API_TOKEN && config.COZE_WORKFLOW_ID),
  agentReady: Boolean(config.COZE_AGENT_PUBLISHED && config.COZE_API_TOKEN && config.COZE_BOT_ID),
  workflowPublished: config.COZE_WORKFLOW_PUBLISHED,
  agentPublished: config.COZE_AGENT_PUBLISHED,
  workflowId: config.COZE_WORKFLOW_ID || null,
  botId: config.COZE_BOT_ID || null,
})
