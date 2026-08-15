/**
 * GET /api/articles — 文章数据 API（Vercel Function，fetch Web Standard export）
 *
 * 用法：
 *   GET /api/articles           → 全部 meta（不含正文，轻量）
 *   GET /api/articles?id=p0001  → 单篇全文（含正文段落）
 *   GET /api/articles?q=..&topic=..&source=..&sort=..&limit=.. → 筛选/搜索
 *
 * 数据源：data/articles.db（SQLite，node:sqlite 只读）
 * 打包：data/articles.db 经 vercel.json functions.includeFiles 随函数部署
 * 注意：本文件自包含全部逻辑（不 import 兄弟模块）——Vercel 打包 api 函数时
 *       只编译入口文件，相对 import 的模块不会输出到 /var/task，会导致运行时
 *       ERR_MODULE_NOT_FOUND（此前 api/db.ts 的教训）。
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let db: DatabaseSync | null = null

/** 项目根：本文件（api/articles.ts）的父目录的父目录，即 /var/task（本地为项目根） */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function openDb(): DatabaseSync {
  if (db) return db
  const dbPath = path.join(PROJECT_ROOT, 'data', 'articles.db')
  db = new DatabaseSync(dbPath, { readOnly: true })
  return db
}

/** 列表 meta 查询（不含正文，轻量） */
function queryMetaList() {
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
function queryArticle(id: string) {
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

/** Vercel Function：GET handler */
export function GET(request: Request) {
  const url = new URL(request.url)
  const id = url.searchParams.get('id')

  // 单篇全文
  if (id) {
    const article = queryArticle(id)
    if (!article) {
      return json({ error: 'not found' }, 404)
    }
    return json(article)
  }

  // meta 列表 + 筛选
  const q = url.searchParams.get('q')?.trim() ?? ''
  const topic = url.searchParams.get('topic')?.trim() ?? ''
  const source = url.searchParams.get('source')?.trim() ?? ''
  const sort = url.searchParams.get('sort') ?? 'date'
  const limit = Number(url.searchParams.get('limit') ?? '0')

  let list = queryMetaList()
  if (q) {
    const kw = q.toLowerCase()
    list = list.filter(
      (a) => a.title.toLowerCase().includes(kw) || a.summary.toLowerCase().includes(kw),
    )
  }
  if (topic) list = list.filter((a) => a.topic === topic)
  if (source) list = list.filter((a) => a.source === source)
  if (sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  if (limit > 0) list = list.slice(0, limit)

  return json({ articles: list, total: list.length })
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 数据只读且更新频率低：边缘缓存 1 小时，浏览器缓存 5 分钟
      'cache-control': 'public, s-maxage=3600, max-age=300',
    },
  })
}
