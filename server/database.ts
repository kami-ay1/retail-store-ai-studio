import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import { z } from 'zod'

/** 创建真实 SQLite 数据库，初始化只作用于项目自己的数据库文件。 */
export function openDatabase(filename: string) {
  mkdirSync(dirname(filename), { recursive: true })
  const database = new DatabaseSync(filename)
  database.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  return database
}

/** 数据变更通知只发送事件编号，事件内容从数据库按商家范围读取。 */
export const changes = new EventEmitter()

/** 将可审查的状态变化和 Agent 工具记录持久化。 */
export function appendEvent(database: DatabaseSync, merchantId: string, entityType: 'generation' | 'agent', entityId: string, kind: string, payload: unknown) {
  const result = database.prepare('INSERT INTO events (merchantId,entityType,entityId,kind,payload,createdAt) VALUES (?,?,?,?,?,?)')
    .run(merchantId, entityType, entityId, kind, JSON.stringify(payload), new Date().toISOString())
  changes.emit(merchantId, Number(result.lastInsertRowid))
}

/** SSE 重连按商家和游标读取事件，避免把其他商家的记录发送给客户端。 */
export function listEvents(database: DatabaseSync, merchantId: string, after: number) {
  return database.prepare('SELECT id,entityType,entityId,kind,payload,createdAt FROM events WHERE merchantId=? AND id>? ORDER BY id LIMIT 100')
    .all(merchantId, after).map(row => {
      const event = z.object({ id: z.number(), entityType: z.string(), entityId: z.string(), kind: z.string(), payload: z.string(), createdAt: z.string() }).parse(row)
      return { ...event, payload: JSON.parse(event.payload) }
    })
}
