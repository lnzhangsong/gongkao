/**
 * GET /api/terms — 申论规范词 API（Vercel Function，fetch Web Standard export）
 *
 * 用法：
 *   GET /api/terms          → 全部规范词（按入库顺序，前端按主题分组/搜索）
 *   GET /api/terms?theme=   → 按主题过滤
 *   GET /api/terms?q=       → 词面或例句包含匹配
 *
 * 数据源：data/articles.db（SQLite，node:sqlite 只读；guifan_terms 表，
 *         由 scripts/import-guifanci.mjs 从规范词合集 md 全量重建）
 * 注意：本文件自包含全部逻辑（不 import 兄弟模块）——Vercel 只打包入口文件
 *       （api/articles.ts 同款教训）。仅读，无写接口。
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

export function GET(request: Request): Response {
  let list = (
    openDb().prepare('SELECT theme, term, example FROM guifan_terms ORDER BY id').all() as any[]
  ).map((r) => ({ theme: r.theme, term: r.term, example: r.example }))
  const url = new URL(request.url)
  const theme = url.searchParams.get('theme')
  const q = url.searchParams.get('q')?.trim()
  if (theme) list = list.filter((t) => t.theme === theme)
  if (q) list = list.filter((t) => t.term.includes(q) || t.example.includes(q))
  return new Response(JSON.stringify({ terms: list, total: list.length }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, s-maxage=3600' },
  })
}
