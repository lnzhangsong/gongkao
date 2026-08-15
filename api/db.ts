/**
 * 共享：只读打开 data/articles.db
 * Vercel Functions 文件系统只读 → 必须 readOnly 打开
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let db: DatabaseSync | null = null

/** 项目根：api/db.ts 的父目录的父目录（本地与 Vercel 部署均适用） */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function openDb(): DatabaseSync {
  if (db) return db
  // 只读打开（Vercel 函数文件系统只读；数据构建期写入，运行时只查）
  const dbPath = path.join(PROJECT_ROOT, 'data', 'articles.db')
  db = new DatabaseSync(dbPath, { readOnly: true })
  return db
}

/** 列表 meta 查询（不含正文，轻量） */
export function queryMetaList() {
  const d = openDb()
  return d
    .prepare(
      `SELECT id, title, summary, source, topic, date, read_time, featured, pullquote, finish_note
       FROM articles ORDER BY date DESC, id`,
    )
    .all()
    .map((r: any) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      source: r.source,
      topic: r.topic,
      date: r.date,
      readTime: r.read_time,
      featured: Boolean(r.featured),
      ...(r.pullquote ? { pullquote: r.pullquote } : {}),
      ...(r.finish_note ? { finishNote: r.finish_note } : {}),
    }))
}

/** 单篇全文（含正文段落） */
export function queryArticle(id: string) {
  const d = openDb()
  const r: any = d
    .prepare(
      `SELECT id, title, summary, source, topic, date, read_time, content_json, pullquote, finish_note
       FROM articles WHERE id = ?`,
    )
    .get(id)
  if (!r) return null
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    content: JSON.parse(r.content_json),
    source: r.source,
    topic: r.topic,
    date: r.date,
    readTime: r.read_time,
    ...(r.pullquote ? { pullquote: r.pullquote } : {}),
    ...(r.finish_note ? { finishNote: r.finish_note } : {}),
  }
}
