/**
 * GET /api/exams/:id — 申论真题单卷详情（Vercel Function，fetch Web Standard export）
 *
 * 数据源：data/articles.db（SQLite，node:sqlite 只读；papers/materials/questions 表）
 * 注意：本文件自包含全部逻辑（不 import 兄弟模块）——Vercel 只打包入口文件，
 *       相对 import 的模块不会输出到 /var/task（api/articles.ts 同款教训）。
 * 写接口（保存）仅本地 scripts/api-server.mjs 提供，生产只读。
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let db: DatabaseSync | null = null
function openDb(): DatabaseSync {
  if (db) return db
  db = new DatabaseSync(path.join(PROJECT_ROOT, 'data', 'articles.db'), { readOnly: true })
  return db
}

export function GET(request: Request): Response {
  const id = decodeURIComponent(new URL(request.url).pathname.split('/').pop() ?? '')
  const paper = openDb().prepare('SELECT * FROM papers WHERE id = ?').get(id) as any
  if (!paper) {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }
  const materials = (
    openDb().prepare('SELECT idx, label, content FROM materials WHERE paper_id = ? ORDER BY idx').all(id) as any[]
  ).map((m) => ({ idx: m.idx, label: m.label, content: m.content }))
  const questions = (
    openDb()
      .prepare(
        'SELECT idx, type, stem, requirement, word_limit, points, answer, answer_matched FROM questions WHERE paper_id = ? ORDER BY idx',
      )
      .all(id) as any[]
  ).map((q) => ({
    idx: q.idx,
    type: q.type ?? null,
    stem: q.stem,
    requirement: q.requirement ?? '',
    wordLimit: q.word_limit ?? null,
    points: q.points ?? null,
    answer: q.answer ?? null,
    answerMatched: !!q.answer_matched,
  }))
  return new Response(
    JSON.stringify({
      id: paper.id,
      year: paper.year,
      level: paper.level,
      title: paper.title,
      ...(paper.warnings ? { warnings: paper.warnings } : {}),
      materials,
      questions,
      ...(paper.answers_raw ? { answersRaw: paper.answers_raw } : {}),
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, s-maxage=3600' } },
  )
}
