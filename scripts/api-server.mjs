/**
 * 本地 API server（开发/测试用）：与 Vercel Functions 同路由同逻辑
 *   node scripts/api-server.mjs [port]   默认 8787
 * 路由：
 *   GET /api/articles
 *   GET /api/articles/:id
 *   GET /api/exams            申论真题试卷列表（?year=&level= 过滤；与文章同库）
 *   GET /api/exams/:id        试卷详情（材料 + 题目 + 答案）
 *   GET /api/terms            申论规范词全集（?theme=&q= 过滤；guifan_terms 表）
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

// —— 申论规范词（guifan_terms 表，import-guifanci.mjs 全量重建）——
function queryTerms() {
  return openDb()
    .prepare('SELECT id, theme, term, example FROM guifan_terms ORDER BY id')
    .all()
    .map((r) => ({ id: r.id, theme: r.theme, term: r.term, example: r.example }))
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

  if (url.pathname === '/api/terms' && req.method === 'GET') {
    // 规范词全集；theme / q（词与例句包含匹配）服务端过滤
    let list = queryTerms()
    const theme = url.searchParams.get('theme')
    const q = url.searchParams.get('q')?.trim()
    if (theme) list = list.filter((t) => t.theme === theme)
    if (q) list = list.filter((t) => t.term.includes(q) || t.example.includes(q))
    void respond(json({ terms: list, total: list.length }))
    return
  }

  // 新增规范词（body: { theme, term, example? }）
  if (url.pathname === '/api/terms' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const term = String(data.term || '').trim()
        const theme = String(data.theme || '').trim() || '综合其他'
        const example = String(data.example || '').trim()
        if (!term) {
          void respond(json({ error: 'term 必填' }, 400))
          return
        }
        const d = openExamDb({ write: true })
        const { lastInsertRowid } = d.prepare('INSERT INTO guifan_terms (theme, term, example) VALUES (?, ?, ?)').run(theme, term, example)
        void respond(json({ ok: true, id: Number(lastInsertRowid) }))
      } catch (err) {
        void respond(json({ error: String(err) }, 400))
      }
    })
    return
  }

  // 修改规范词（部分更新：传了哪个字段改哪个）
  if (url.pathname.startsWith('/api/terms/') && req.method === 'PATCH') {
    const id = Number(decodeURIComponent(url.pathname.slice('/api/terms/'.length)))
    if (!Number.isInteger(id) || id <= 0) {
      void respond(json({ error: '无效 id' }, 400))
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const sets = []
        const vals = []
        for (const key of ['theme', 'term', 'example']) {
          if (typeof data[key] === 'string') {
            const v = data[key].trim()
            if (key !== 'example' && !v) {
              void respond(json({ error: `${key} 不能为空` }, 400))
              return
            }
            sets.push(`${key} = ?`)
            vals.push(v)
          }
        }
        if (sets.length === 0) {
          void respond(json({ error: '没有可更新的字段' }, 400))
          return
        }
        const d = openExamDb({ write: true })
        const r = d.prepare(`UPDATE guifan_terms SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
        if (r.changes === 0) {
          void respond(json({ error: 'not found' }, 404))
          return
        }
        void respond(json({ ok: true }))
      } catch (err) {
        void respond(json({ error: String(err) }, 400))
      }
    })
    return
  }

  // 删除规范词
  if (url.pathname.startsWith('/api/terms/') && req.method === 'DELETE') {
    const id = Number(decodeURIComponent(url.pathname.slice('/api/terms/'.length)))
    if (!Number.isInteger(id) || id <= 0) {
      void respond(json({ error: '无效 id' }, 400))
      return
    }
    try {
      const d = openExamDb({ write: true })
      const r = d.prepare('DELETE FROM guifan_terms WHERE id = ?').run(id)
      if (r.changes === 0) {
        void respond(json({ error: 'not found' }, 404))
        return
      }
      void respond(json({ ok: true }))
    } catch (err) {
      void respond(json({ error: String(err) }, 400))
    }
    return
  }

  if (url.pathname === '/api/exams' && req.method === 'GET') {
    // 与线上 api/exams.ts 相同的 ?id= 查询参数取详情（避免子路径路由差异）
    const singleId = url.searchParams.get('id')
    if (singleId) {
      const exam = queryExam(singleId)
      if (!exam) {
        void respond(json({ error: 'not found' }, 404))
        return
      }
      void respond(json(exam))
      return
    }
    let list = queryExamList()
    const year = url.searchParams.get('year')
    const level = url.searchParams.get('level')
    if (year) list = list.filter((x) => String(x.year) === year)
    if (level) list = list.filter((x) => x.level === level)
    void respond(json({ papers: list, total: list.length }))
    return
  }
  // 编辑保存（仅本地 api-server；Vercel 生产不提供写接口）
  // 新增试卷（body: { year, level, title }）
  if (url.pathname === '/api/exams' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const year = parseInt(data.year, 10)
        const level = String(data.level || '未分级')
        const title = String(data.title || '').trim()
        if (!year || !title) {
          void respond(json({ error: 'year 与 title 必填' }, 400))
          return
        }
        const d = openExamDb({ write: true })
        const id = `guokao-shenlun-${year}-${level}`
        if (d.prepare('SELECT id FROM papers WHERE id = ?').get(id)) {
          void respond(json({ error: `已存在同年份同层级的试卷：${id}` }, 409))
          return
        }
        d.prepare(
          `INSERT INTO papers (id, year, level, title, subject, source_file)
           VALUES (?, ?, ?, ?, '申论', ?)`,
        ).run(id, year, level, title, `manual/${id}.md`)
        void respond(json({ ok: true, id }))
      } catch (err) {
        void respond(json({ error: String(err) }, 400))
      }
    })
    return
  }

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
        // 年份/级别可调：变化时同步改 papers.id 并迁移 materials/questions
        const d = openExamDb({ write: true })
        const paper = d.prepare('SELECT * FROM papers WHERE id = ?').get(id)
        if (!paper) {
          void respond(json({ error: 'not found' }, 404))
          return
        }
        const newYear = data.year ? parseInt(data.year, 10) : paper.year
        const newLevel = typeof data.level === 'string' && data.level.trim() ? data.level.trim() : paper.level
        const newId = `guokao-shenlun-${newYear}-${newLevel}`
        if (newId !== id && d.prepare('SELECT id FROM papers WHERE id = ?').get(newId)) {
          void respond(json({ error: `已存在同年份同层级的试卷：${newId}` }, 409))
          return
        }
        const updPaper = d.prepare('UPDATE papers SET id = ?, year = ?, level = ?, title = ?, warnings = ? WHERE id = ?')
        const delMats = d.prepare('DELETE FROM materials WHERE paper_id = ?')
        const insMat = d.prepare('INSERT INTO materials (id, paper_id, idx, label, content, chars) VALUES (?, ?, ?, ?, ?, ?)')
        const delQs = d.prepare('DELETE FROM questions WHERE paper_id = ?')
        const insQ = d.prepare(
          'INSERT INTO questions (id, paper_id, idx, type, stem, requirement, word_limit, word_limit_json, points, answer, answer_matched) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        d.exec('BEGIN')
        updPaper.run(
          newId, newYear, newLevel,
          typeof data.title === 'string' ? data.title : '',
          typeof data.warnings === 'string' ? data.warnings : null,
          id,
        )
        if (newId !== id) {
          d.prepare('UPDATE materials SET paper_id = ? WHERE paper_id = ?').run(newId, id)
          d.prepare('UPDATE questions SET paper_id = ? WHERE paper_id = ?').run(newId, id)
        }
        // 整卷替换：materials/questions 按提交顺序重排 idx（支持新增与删除行）
        delMats.run(newId)
        for (const [i, m] of (data.materials ?? []).entries()) {
          if (typeof m.content !== 'string') continue
          insMat.run(`${newId}-m${i + 1}`, newId, i + 1, m.label || `材料${i + 1}`, m.content, m.content.length)
        }
        delQs.run(newId)
        for (const [i, q] of (data.questions ?? []).entries()) {
          if (typeof q.stem !== 'string') continue
          const wl = q.wordLimit ?? null
          insQ.run(
            `${newId}-q${i + 1}`, newId, i + 1,
            q.type || null, q.stem, q.requirement || '', wl,
            wl ? JSON.stringify({ max: wl }) : null,
            q.points ?? null, q.answer ?? null, q.answer ? 1 : 0,
          )
        }
        d.exec('COMMIT')
        void respond(json({ ok: true, id: newId }))
      } catch (err) {
        try { d.exec('ROLLBACK') } catch {}
        void respond(json({ error: String(err) }, 400))
      }
    })
    return
  }

  // 删除试卷（连同其材料与题目）
  if (url.pathname.startsWith('/api/exams/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.pathname.slice('/api/exams/'.length))
    const d = openExamDb({ write: true })
    const delPaper = d.prepare('DELETE FROM papers WHERE id = ?')
    const delMats = d.prepare('DELETE FROM materials WHERE paper_id = ?')
    const delQs = d.prepare('DELETE FROM questions WHERE paper_id = ?')
    d.exec('BEGIN')
    try {
      delMats.run(id)
      delQs.run(id)
      const info = delPaper.run(id)
      if (info.changes === 0) {
        d.exec('ROLLBACK')
        void respond(json({ error: 'not found' }, 404))
        return
      }
      d.exec('COMMIT')
      void respond(json({ ok: true }))
    } catch (err) {
      try { d.exec('ROLLBACK') } catch {}
      void respond(json({ error: String(err) }, 400))
    }
    return
  }

  void respond(json({ error: 'not found' }, 404))
})

server.listen(PORT, () => {
  console.log(`API server 就绪 → http://localhost:${PORT}/api/articles`)
})
