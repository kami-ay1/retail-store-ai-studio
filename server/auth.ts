import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Request, Response, RequestHandler } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { loginSchema, registerSchema, sessionSchema, type MerchantSession } from '../shared/contracts.ts'
import { HttpError } from './errors.ts'

declare global {
  namespace Express {
    interface Locals { merchant: MerchantSession }
  }
}

const cookieName = 'moyou_session'
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

/** 会话令牌只在 HttpOnly Cookie 中返回，数据库保存其摘要。 */
function establishSession(database: DatabaseSync, userId: string, response: Response) {
  const token = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000
  database.prepare('INSERT INTO sessions(tokenHash,userId,expiresAt) VALUES(?,?,?)').run(tokenHash(token), userId, expiresAt)
  response.cookie(cookieName, token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', expires: new Date(expiresAt), path: '/' })
}

/** 读取当前有效会话，账户所属商家不能由请求参数覆盖。 */
export function readSession(database: DatabaseSync, request: Request) {
  const cookie = z.record(z.string(), z.unknown()).parse(request.cookies)
  const token = cookie[cookieName]
  if (typeof token !== 'string') throw new HttpError(401, '请先登录商家账户')
  const row = database.prepare(`SELECT u.id,u.merchantId,u.email,m.name AS merchantName FROM sessions s
    JOIN users u ON s.userId=u.id JOIN merchants m ON m.id=u.merchantId WHERE s.tokenHash=? AND s.expiresAt>?`)
    .get(tokenHash(token), Date.now())
  if (!row) throw new HttpError(401, '登录已过期，请重新登录')
  return sessionSchema.parse(row)
}

/** Express 身份边界，在所有业务路由前校验真实会话。 */
export const requireMerchant = (database: DatabaseSync): RequestHandler => (request, response, next) => {
  response.locals.merchant = readSession(database, request)
  next()
}

/** 注册独立商家与所属账户，重复邮箱明确返回冲突。 */
export async function register(database: DatabaseSync, body: unknown, response: Response) {
  const input = registerSchema.parse(body)
  if (database.prepare('SELECT id FROM users WHERE email=?').get(input.email)) throw new HttpError(409, '该邮箱已注册')
  const merchantId = randomUUID(), userId = randomUUID(), now = new Date().toISOString()
  const passwordHash = await bcrypt.hash(input.password, 12)
  database.exec('BEGIN IMMEDIATE')
  try {
    // 密码计算包含异步等待，写入事务后重新核验并发注册。
    if (database.prepare('SELECT id FROM users WHERE email=?').get(input.email)) throw new HttpError(409, '该邮箱已注册')
    database.prepare('INSERT INTO merchants(id,name,createdAt) VALUES(?,?,?)').run(merchantId, input.merchantName, now)
    database.prepare('INSERT INTO users(id,merchantId,email,passwordHash,createdAt) VALUES(?,?,?,?,?)').run(userId, merchantId, input.email, passwordHash, now)
    database.exec('COMMIT')
  } finally {
    if (database.isTransaction) database.exec('ROLLBACK')
  }
  establishSession(database, userId, response)
  return { id: userId, merchantId, merchantName: input.merchantName, email: input.email }
}

/** 登录使用密码摘要校验，不创建预置或演示账户。 */
export async function login(database: DatabaseSync, body: unknown, response: Response) {
  const input = loginSchema.parse(body)
  const row = database.prepare('SELECT id,passwordHash FROM users WHERE email=?').get(input.email)
  if (!row) throw new HttpError(401, '邮箱或密码不正确')
  const account = z.object({ id: z.string(), passwordHash: z.string() }).parse(row)
  if (!await bcrypt.compare(input.password, account.passwordHash)) throw new HttpError(401, '邮箱或密码不正确')
  establishSession(database, account.id, response)
  return sessionSchema.parse(database.prepare('SELECT u.id,u.merchantId,u.email,m.name AS merchantName FROM users u JOIN merchants m ON m.id=u.merchantId WHERE u.id=?').get(account.id))
}

/** 注销仅撤销当前会话，其他设备和业务资料保持独立。 */
export function logout(database: DatabaseSync, request: Request, response: Response) {
  const cookie = z.record(z.string(), z.unknown()).parse(request.cookies)
  const token = cookie[cookieName]
  if (typeof token === 'string') database.prepare('DELETE FROM sessions WHERE tokenHash=?').run(tokenHash(token))
  response.clearCookie(cookieName, { path: '/' })
}
