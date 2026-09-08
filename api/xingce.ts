/**
 * GET /api/xingce — 行测真题数据 API（Vercel Function，fetch Web Standard export）
 *
 * 用法：
 *   GET /api/xingce              → 全部行测卷 meta（按年份倒序）
 *   GET /api/xingce?id=xxx      → 单卷详情（题目 + 选项 + 答案 + 解析）
 *
 * 数据源：data/articles.db（SQLite，node:sqlite 只读；xg_papers/xg_questions 两表）
 * 自包含全部逻辑（不 import 兄弟模块）——Vercel 只打包入口文件（api/exams.ts 同款教训）。
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

  // 单卷详情：/api/xingce?id=xxx
  const singleId = url.searchParams.get('id')
  if (singleId) {
    const paper = d.prepare('SELECT * FROM xg_papers WHERE id = ?').get(singleId) as any
    if (!paper) return json({ error: 'not found' }, 404)
    const questions = (
      d
        .prepare(
          'SELECT idx, section, subtype, group_id, group_stem, group_image, stem, options, answer, explanation, image FROM xg_questions WHERE paper_id = ? ORDER BY idx',
        )
        .all(singleId) as any[]
    ).map((q) => ({
      idx: q.idx,
      section: q.section,
      subtype: q.subtype ?? null,
      groupId: q.group_id ?? null,
      groupStem: q.group_stem ?? null,
      groupImage: q.group_image ?? null,
      stem: q.stem,
      options: JSON.parse(q.options) as { key: string; text: string }[],
      answer: q.answer,
      explanation: q.explanation ?? null,
      image: q.image ?? null,
    }))
    return json({
      id: paper.id,
      year: paper.year,
      level: paper.level,
      title: paper.title,
      durationMin: paper.duration_min ?? null,
      questions,
      ...(paper.warnings ? { warnings: paper.warnings } : {}),
    })
  }

  // 列表：/api/xingce?year=&level=
  let list = (
    d
      .prepare('SELECT id, year, level, title, duration_min, question_count FROM xg_papers ORDER BY year DESC, id')
      .all() as any[]
  ).map((r) => ({
    id: r.id,
    year: r.year,
    level: r.level,
    title: r.title,
    durationMin: r.duration_min ?? null,
    questionCount: r.question_count,
  }))
  const year = url.searchParams.get('year')
  const level = url.searchParams.get('level')
  if (year) list = list.filter((x) => String(x.year) === year)
  if (level) list = list.filter((x) => x.level === level)
  return json({ papers: list, total: list.length })
}
