/**
 * GET /api/exams — 申论真题数据 API（Vercel Function，fetch Web Standard export）
 *
 * 用法：
 *   GET /api/exams              → 全部试卷 meta（按年份倒序）
 *   GET /api/exams?year=&level= → 筛选
 * 单卷详情见 api/exams/[id].ts
 *
 * 数据源：data/articles.db（SQLite，node:sqlite 只读；papers/materials/questions 表）
 * 注意：本文件自包含全部逻辑（不 import 兄弟模块）——Vercel 只打包入口文件，
 *       相对 import 的模块不会输出到 /var/task（api/articles.ts 同款教训）。
 * 写接口（新增/保存/删除）仅本地 scripts/api-server.mjs 提供，生产只读。
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let db: DatabaseSync | null = null
function openDb(): DatabaseSync {
  if (db) return db
  db = new DatabaseSync(path.join(PROJECT_ROOT, 'data', 'articles.db'), { readOnly: true })
  return db
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, s-maxage=3600' },
  })

export function GET(request: Request): Response {
  const url = new URL(request.url)
  const d = openDb()

  // 列表：/api/exams?year=&level=
  let list = (
    d
      .prepare(
        `SELECT p.id, p.year, p.level, p.title,
           (SELECT COUNT(*) FROM materials m WHERE m.paper_id = p.id) AS material_count,
           (SELECT COUNT(*) FROM questions q WHERE q.paper_id = p.id) AS question_count,
           (SELECT COUNT(*) FROM questions q WHERE q.paper_id = p.id AND q.answer IS NOT NULL) AS answered
         FROM papers p ORDER BY p.year DESC, p.id`,
      )
      .all() as any[]
  ).map((r) => ({
    id: r.id,
    year: r.year,
    level: r.level,
    title: r.title,
    hasAnswer: r.answered > 0,
    questionCount: r.question_count,
    materialCount: r.material_count,
  }))
  const year = url.searchParams.get('year')
  const level = url.searchParams.get('level')
  if (year) list = list.filter((x) => String(x.year) === year)
  if (level) list = list.filter((x) => x.level === level)
  return json({ papers: list, total: list.length })
}
