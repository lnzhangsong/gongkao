/**
 * 本地 API server（开发/测试用）：与 Vercel Functions 同路由同逻辑
 *   node scripts/api-server.mjs [port]   默认 8787
 * 路由：
 *   GET /api/articles
 *   GET /api/articles/:id
 */
import { createServer } from 'node:http'
import { queryMetaList, queryArticle } from '../api/_db.ts'

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
    let list = queryMetaList()
    if (q) {
      const kw = q.toLowerCase()
      list = list.filter((a) => a.title.toLowerCase().includes(kw) || a.summary.toLowerCase().includes(kw))
    }
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
