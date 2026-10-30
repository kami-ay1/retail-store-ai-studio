import { CozeAPI, WorkflowEventType } from '@coze/api'
import { z } from 'zod'
import { config, integrationStatus } from './config.ts'
import { HttpError } from './errors.ts'

/** 服务端独占 Coze 令牌，使用官方 SDK 处理网络协议。 */
export function getCozeClient(capability: 'image' | 'agent') {
  const ready = integrationStatus()
  if (capability === 'image' && !ready.workflowPublished) throw new HttpError(503, '生图工作流当前保留为草稿，暂未启用 API 调用')
  if (capability === 'agent' && !ready.agentPublished) throw new HttpError(503, '搭配 Agent 当前保留为草稿，暂未启用 API 调用')
  if (capability === 'image' && !ready.imageReady) throw new HttpError(503, '尚未连接 Coze 生图工作流，请完成接入配置')
  if (capability === 'agent' && !ready.agentReady) throw new HttpError(503, '尚未连接 Coze 搭配 Agent，请完成接入配置')
  return new CozeAPI({ token: config.COZE_API_TOKEN, baseURL: 'https://api.coze.cn', axiosOptions: { timeout: 600_000 }, debug: false })
}

/** 工作流结束节点必须返回明确的 image_url，不接受自由文本或演示结果。 */
export const imageOutputSchema = z.object({ image_url: z.url() })

/** 通过官方流式工作流接口等待真实结果，无需依赖异步接口的套餐权限。 */
export async function runImageWorkflow(parameters: Record<string, unknown>, report: (text: string) => void) {
  const client = getCozeClient('image')
  let output: string | undefined
  let completed = false
  const stream = client.workflows.runs.stream({ workflow_id: config.COZE_WORKFLOW_ID, parameters }, { signal: AbortSignal.timeout(600_000) })
  for await (const event of stream) {
    if (event.event === WorkflowEventType.ERROR) {
      if (!event.data || !('error_message' in event.data)) throw new Error('Coze 工作流返回无效错误事件')
      throw new HttpError(502, `Coze 生图失败：${event.data.error_message}`)
    }
    if (event.event === WorkflowEventType.INTERRUPT) throw new HttpError(502, '生图工作流发生中断，请检查是否包含需要额外输入的节点')
    if (event.event === WorkflowEventType.MESSAGE) {
      if (!event.data || !('content' in event.data)) throw new Error('Coze 工作流返回无效消息事件')
      if (event.data.node_is_finish) output = event.data.content
      report(event.data.node_is_finish ? '工作流已返回输出' : '工作流正在处理图片')
    }
    if (event.event === WorkflowEventType.DONE) completed = true
  }
  if (!completed || !output) throw new HttpError(502, 'Coze 未返回完整的工作流结果')
  return imageOutputSchema.parse(JSON.parse(output))
}
