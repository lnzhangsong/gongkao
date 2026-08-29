/**
 * 本地 API server（开发/测试用）：与 Vercel Functions 同路由同逻辑
 *   node scripts/api-server.mjs [port]   默认 8787
 * 路由：
 *   GET /api/articles
 *   GET /api/articles/:id
 *   GET /api/exams            申论真题试卷列表（?year=&level= 过滤；与文章同库）
 *   GET /api/exams/:id        试卷详情（材料 + 题目 + 答案）
 */
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 与 api/articles.ts 相同的查询逻辑（Vercel 打包只编译入口文件，这里本地自包含）
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let _db = null
function openDb() {
  if (_db) return _db
  _db = new DatabaseSync(path.join(PROJECT_ROOT, 'data', 'articles.db'), { readOnly: true })
  return _db
}
function mapMetaRow(r) {
  return {
    id: r.id, title: r.title, summary: r.summary, source: r.source, topic: r.topic,
    date: r.date, readTime: r.read_time, featured: Boolean(r.featured),
    ...(r.pullquote ? { pullquote: r.pullquote } : {}),
    ...(r.finish_note ? { finishNote: r.finish_note } : {}),
  }
}
// kw 非空时全文搜索（标题/摘要/正文；instr(content_json, kw)，与 api/articles.ts 同逻辑）
function queryMetaList(kw) {
  const d = openDb()
  if (kw) {
    const like = `%${kw}%`
    return d
      .prepare(`SELECT id, title, summary, source, topic, date, read_time, featured, pullquote, finish_note
                FROM articles
                WHERE title LIKE ? OR summary LIKE ? OR instr(content_json, ?) > 0
                ORDER BY date DESC, id`)
      .all(like, like, kw)
      .map(mapMetaRow)
  }
  return d
    .prepare('SELECT id, title, summary, source, topic, date, read_time, featured, pullquote, finish_note FROM articles ORDER BY date DESC, id')
    .all()
    .map(mapMetaRow)
}
function queryArticle(id) {
  const d = openDb()
  const r = d.prepare('SELECT id, title, summary, source, topic, date, read_time, content_json, pullquote, finish_note FROM articles WHERE id = ?').get(id)
  if (!r) return null
  return {
    id: r.id, title: r.title, summary: r.summary, content: JSON.parse(r.content_json),
    source: r.source, topic: r.topic, date: r.date, readTime: r.read_time,
    ...(r.pullquote ? { pullquote: r.pullquote } : {}),
    ...(r.finish_note ? { finishNote: r.finish_note } : {}),
  }
}

// —— 申论真题（与文章同库：data/articles.db 的 papers/materials/questions 三表）——
function openExamDb(opts) {
  const readOnly = !opts?.write
  if (_db && _dbReadOnly === readOnly) return _db
  if (_db) _db.close()
  _dbReadOnly = readOnly
  _db = new DatabaseSync(path.join(PROJECT_ROOT, 'data', 'articles.db'), { readOnly })
  return _db
}
let _dbReadOnly = true
function queryExamList() {
  const d = openExamDb()
  return d
    .prepare(`SELECT p.id, p.year, p.level, p.title, p.has_answer,
                     (SELECT COUNT(*) FROM questions q WHERE q.paper_id = p.id) AS question_count,
                     (SELECT COUNT(*) FROM materials m WHERE m.paper_id = p.id) AS material_count
              FROM papers p ORDER BY p.year DESC, p.level`)
    .all()
    .map((r) => ({ id: r.id, year: r.year, level: r.level, title: r.title, hasAnswer: Boolean(r.has_answer), questionCount: r.question_count, materialCount: r.material_count }))
}
function queryExam(id) {
  const d = openExamDb()
  const p = d.prepare('SELECT id, year, level, title, has_answer, answers_raw, warnings FROM papers WHERE id = ?').get(id)
  if (!p) return null
  const materials = d.prepare('SELECT idx, label, content FROM materials WHERE paper_id = ? ORDER BY idx').all(id)
  const questions = d.prepare('SELECT idx, type, stem, requirement, word_limit, word_limit_json, points, answer, answer_matched FROM questions WHERE paper_id = ? ORDER BY idx').all(id)
  return {
    id: p.id, year: p.year, level: p.level, title: p.title,
    ...(p.warnings ? { warnings: p.warnings } : {}),
    materials: materials.map((m) => ({ idx: m.idx, label: m.label, content: m.content })),
    questions: questions.map((q) => ({
      idx: q.idx, type: q.type, stem: q.stem, requirement: q.requirement,
      wordLimit: q.word_limit, points: q.points,
      answer: q.answer, answerMatched: Boolean(q.answer_matched),
    })),
    ...(p.answers_raw ? { answersRaw: p.answers_raw } : {}),
  }
}

const PORT = Number(process.argv[2] ?? 8787)

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, max-age=300',
      ...extra,
    },
  })

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const respond = async (resp) => {
    res.writeHead(resp.status, Object.fromEntries(resp.headers))
    res.end(await resp.text())
  }

  if (url.pathname === '/api/articles' && req.method === 'GET') {
    // 单篇全文：?id=p0001
    const singleId = url.searchParams.get('id')
    if (singleId) {
      const article = queryArticle(singleId)
      if (!article) {
        void respond(json({ error: 'not found' }, 404))
        return
      }
      void respond(json(article))
      return
    }
    const q = url.searchParams.get('q')?.trim() ?? ''
    const topic = url.searchParams.get('topic')?.trim() ?? ''
    const source = url.searchParams.get('source')?.trim() ?? ''
    const sort = url.searchParams.get('sort') ?? 'date'
    const limit = Number(url.searchParams.get('limit') ?? '0')
    // q 的全文检索（标题/摘要/正文）已在 queryMetaList 内完成
    let list = queryMetaList(q || undefined)
    if (topic) list = list.filter((a) => a.topic === topic)
    if (source) list = list.filter((a) => a.source === source)
    if (sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh'))
    if (limit > 0) list = list.slice(0, limit)
    void respond(json({ articles: list, total: list.length }))
    return
  }

  if (url.pathname === '/api/exams' && req.method === 'GET') {
    let list = queryExamList()
    const year = url.searchParams.get('year')
    const level = url.searchParams.get('level')
    if (year) list = list.filter((x) => String(x.year) === year)
    if (level) list = list.filter((x) => x.level === level)
    void respond(json({ papers: list, total: list.length }))
    return
  }

  if (url.pathname.startsWith('/api/exams/') && req.method === 'GET') {
    const exam = queryExam(decodeURIComponent(url.pathname.slice('/api/exams/'.length)))
    if (!exam) {
      void respond(json({ error: 'not found' }, 404))
      return
    }
    void respond(json(exam))
    return
  }

  // 编辑保存（仅本地 api-server；Vercel 生产不提供写接口）
  if (url.pathname.startsWith('/api/exams/') && req.method === 'POST') {
    const id = decodeURIComponent(url.pathname.slice('/api/exams/'.length))
    const d = openExamDb({ write: true })
    const exists = d.prepare('SELECT id FROM papers WHERE id = ?').get(id)
    if (!exists) {
      void respond(json({ error: 'not found' }, 404))
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const updPaper = d.prepare('UPDATE papers SET title = ?, warnings = ? WHERE id = ?')
        const updMat = d.prepare('UPDATE materials SET content = ? WHERE paper_id = ? AND idx = ?')
        const updQ = d.prepare(
          'UPDATE questions SET type = ?, stem = ?, requirement = ?, word_limit = ?, word_limit_json = ?, points = ?, answer = ? WHERE paper_id = ? AND idx = ?',
        )
        d.exec('BEGIN')
        if (typeof data.title === 'string') updPaper.run(data.title, typeof data.warnings === 'string' ? data.warnings : null, id)
        for (const m of data.materials ?? [])
          if (typeof m.content === 'string') updMat.run(m.content, id, m.idx)
        for (const q of data.questions ?? []) {
          if (typeof q.stem !== 'string') continue
          const wl = q.wordLimit ?? null
          updQ.run(
            q.type || null, q.stem, q.requirement || '', wl,
            wl ? JSON.stringify({ max: wl }) : null,
            q.points ?? null, q.answer ?? null, id, q.idx,
          )
        }
        d.exec('COMMIT')
        void respond(json({ ok: true }))
      } catch (err) {
        try { d.exec('ROLLBACK') } catch {}
        void respond(json({ error: String(err) }, 400))
      }
    })
    return
  }

  void respond(json({ error: 'not found' }, 404))
})

server.listen(PORT, () => {
  console.log(`API server 就绪 → http://localhost:${PORT}/api/articles`)
})
