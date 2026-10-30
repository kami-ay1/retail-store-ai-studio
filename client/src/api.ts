import { z } from 'zod'

/** 所有 API 错误保留真实 HTTP 状态，不返回替代业务结果。 */
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** 请求与响应分别由共享业务协议校验。 */
export async function requestApi<S extends z.ZodType>(path: string, schema: S, options: RequestInit = {}) {
  const headers = new Headers(options.headers)
  if (options.body !== undefined && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api${path}`, { ...options, headers })
  const data: unknown = await response.json()
  if (!response.ok) throw new ApiError(response.status, z.object({ message: z.string() }).parse(data).message)
  return schema.parse(data)
}

/** 图片由当前账户的会话保护，商家之间不能互相读取。 */
export const assetUrl = (id: string) => `/api/assets/${encodeURIComponent(id)}/content`
