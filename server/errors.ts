/** HTTP 边界使用的业务错误，原始失败会记录并返回明确状态。 */
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
