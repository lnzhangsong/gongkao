/**
 * 本地 API server（开发/测试用）：与 Vercel Functions 同路由同逻辑
 *   node scripts/api-server.mjs [port]   默认 8787
 * 路由：
 *   GET /api/articles
 *   GET /api/articles/:id
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

  void respond(json({ error: 'not found' }, 404))
})

server.listen(PORT, () => {
  console.log(`API server 就绪 → http://localhost:${PORT}/api/articles`)
})
