/**
 * GET /api/{articles|terms|exams|xingce} — 只读数据 API 合并入口（Vercel Function）
 *
 * 四个只读端点原先各占一个函数，每个都经 includeFiles 打包整份 data/articles.db
 * ——每个部署 4 份库的 Functions Storage 消耗，push 频繁时配额（Hobby 10GB）
 * 肉眼可见地涨。合并为单函数后每部署只打包一份（2026-09-16 移除 FTS 索引后库约 5MB）。
 *
 * 路由由 vercel.json 的 rewrites 指到本文件；request.url 保留原始路径，按
 * pathname 分发。URL 与响应形状与拆分版一致（api/api-server.test.ts 的 parity
 * 测试 + api/endpoints.test.ts / api/articles.test.ts 锁住）。
 *
 * 用法（不变）：
 *   GET /api/articles           → 文章 meta；?id= 单篇全文；?q=&topic=&source=&sort=&limit= 筛选
 *   GET /api/terms              → 规范词；?theme=&q= 过滤
 *   GET /api/exams              → 申论试卷列表（?year=&level=）；?id= 详情
 *   GET /api/xingce             → 行测试卷列表；?id= 详情
 *   GET /api/shenlun-book       → 《申论写作八讲》方法论书（meta + 渲染单元）
 *
 * 数据源：data/articles.db.gz（node:sqlite 只读）。includeFiles 只打包 gz（体积 1/3），
 *       冷启动解压到 /tmp 只读副本；本地开发原库文件存在则直接用。
 * 注意：本文件自包含全部逻辑（不 import 兄弟模块）——Vercel 只打包入口文件
 *       （此前 api/db.ts 的教训）。
 * 写接口仅本地 scripts/api-server.mjs 提供（见 docs/规范词与试卷写路径决策.md），生产只读。
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let db: DatabaseSync | null = null
function openDb(): DatabaseSync {
  if (db) return db
  // 线上打包的是 data/articles.db.gz（体积约 1/3），冷启动解到 /tmp 只读副本；
  // 本地开发原库文件存在，直接用
  let file = path.join(PROJECT_ROOT, 'data', 'articles.db')
  const gz = file + '.gz'
  if (!fs.existsSync(file) && fs.existsSync(gz)) {
    const tmp = '/tmp/articles.db'
    if (!fs.existsSync(tmp) || fs.statSync(tmp).mtimeMs < fs.statSync(gz).mtimeMs) {
      fs.writeFileSync(tmp, gunzipSync(fs.readFileSync(gz)))
    }
    file = tmp
  }
  db = new DatabaseSync(file, { readOnly: true })
  return db
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 数据只读且更新频率低：成功响应边缘缓存 1 小时、浏览器缓存 5 分钟；
      // 404 等错误不缓存——避免「查不到的 id」被 CDN / 浏览器记住
      'cache-control': status === 200 ? 'public, s-maxage=3600, max-age=300' : 'no-store',
    },
  })
}

// ---------- /api/articles ----------

interface ArticleMeta {
  id: string
  title: string
  summary: string
  source: string
  topic: string
  date: string
  readTime: number
  featured?: boolean
  pullquote?: string
  finishNote?: string
}

function mapMetaRow(r: any): ArticleMeta {
  return {
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
  }
}

/**
 * 列表 meta 查询（不含正文，轻量）；kw 非空时全文搜索（标题/摘要/正文）。
 * 语料只有 517 篇 / 0.72MB，LIKE 全扫亚毫秒级——曾经的 FTS5 trigram 索引
 * （中文文本膨胀 10 倍+，占了库文件的大头）已于 2026-09-16 移除，为 Function 打包瘦身。
 */
function queryMetaList(kw?: string): ArticleMeta[] {
  const d = openDb()
  if (kw) {
    const like = `%${kw}%`
    // instr(content_json, kw)：正文检索（content_json 为 JSON 文本，中文原样存储）
    return d
      .prepare(
        `SELECT id, title, summary, source, topic, date, read_time, featured, pullquote, finish_note
         FROM articles
         WHERE title LIKE ? OR summary LIKE ? OR instr(content_json, ?) > 0
         ORDER BY date DESC, id`,
      )
      .all(like, like, kw)
      .map(mapMetaRow)
  }
  return d
    .prepare(
      `SELECT id, title, summary, source, topic, date, read_time, featured, pullquote, finish_note
       FROM articles ORDER BY date DESC, id`,
    )
    .all()
    .map(mapMetaRow)
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

function articlesGet(request: Request): Response {
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

  // q 的全文检索（标题/摘要/正文）已在 queryMetaList 的 SQL 中完成
  let list = queryMetaList(q || undefined)
  if (topic) list = list.filter((a) => a.topic === topic)
  if (source) list = list.filter((a) => a.source === source)
  if (sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  if (limit > 0) list = list.slice(0, limit)

  return json({ articles: list, total: list.length })
}

// ---------- /api/terms ----------

function termsGet(request: Request): Response {
  // id 必须带出：前端 TermsPage 以 t.id 作为编辑态/删除/key/见过标记的标识，
  // 缺了会让所有卡片共享 undefined 键（历史上漏过，靠 api-server parity 测试锁住）
  let list = (openDb().prepare('SELECT id, theme, term, example FROM guifan_terms ORDER BY id').all() as any[]).map(
    (r) => ({ id: r.id, theme: r.theme, term: r.term, example: r.example }),
  )
  const url = new URL(request.url)
  const theme = url.searchParams.get('theme')
  const q = url.searchParams.get('q')?.trim()
  if (theme) list = list.filter((t) => t.theme === theme)
  if (q) list = list.filter((t) => t.term.includes(q) || t.example.includes(q))
  return json({ terms: list, total: list.length })
}

// ---------- /api/exams ----------

function examsGet(request: Request): Response {
  const url = new URL(request.url)
  const d = openDb()

  // 单卷详情：/api/exams?id=xxx（查询参数形式，避免动态路由与 SPA rewrites 的匹配问题）
  const singleId = url.searchParams.get('id')
  if (singleId) {
    const paper = d.prepare('SELECT * FROM papers WHERE id = ?').get(singleId) as any
    if (!paper) return json({ error: 'not found' }, 404)
    const materials = (
      d.prepare('SELECT idx, label, content FROM materials WHERE paper_id = ? ORDER BY idx').all(singleId) as any[]
    ).map((m) => ({ idx: m.idx, label: m.label, content: m.content }))
    const questions = (
      d
        .prepare(
          'SELECT idx, type, stem, requirement, word_limit, points, answer, answer_matched FROM questions WHERE paper_id = ? ORDER BY idx',
        )
        .all(singleId) as any[]
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
    return json({
      id: paper.id,
      year: paper.year,
      level: paper.level,
      title: paper.title,
      ...(paper.warnings ? { warnings: paper.warnings } : {}),
      materials,
      questions,
      ...(paper.answers_raw ? { answersRaw: paper.answers_raw } : {}),
    })
  }

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

// ---------- /api/xingce ----------

function xingceGet(request: Request): Response {
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

// ---------- /api/shenlun-book ----------

/** 《申论写作八讲》：meta（shenlun_book 单行 JSON）+ 渲染单元（shenlun_book_units，
 *  一个单元 = 一个标题 + 其下内容块）。整书一次返回（~500KB），前端会话缓存。 */
function shenlunBookGet(): Response {
  const d = openDb()
  const meta = d.prepare('SELECT value FROM shenlun_book WHERE key = ?').get('meta') as any
  if (!meta) return json({ error: 'not found' }, 404)
  const units = (
    d
      .prepare(
        `SELECT id, lecture, idx, level, title, kind, blocks_json
         FROM shenlun_book_units ORDER BY lecture, idx`,
      )
      .all() as any[]
  ).map((u) => ({
    id: u.id,
    lecture: u.lecture,
    idx: u.idx,
    level: u.level,
    title: u.title,
    kind: u.kind,
    blocks: JSON.parse(u.blocks_json),
  }))
  return json({ ...JSON.parse(meta.value), units })
}

// ---------- 路由分发 ----------

export function GET(request: Request): Response {
  const pathname = new URL(request.url).pathname
  if (pathname === '/api/articles') return articlesGet(request)
  if (pathname === '/api/terms') return termsGet(request)
  if (pathname === '/api/exams') return examsGet(request)
  if (pathname === '/api/xingce') return xingceGet(request)
  if (pathname === '/api/shenlun-book') return shenlunBookGet()
  return json({ error: 'not found' }, 404)
}
