/**
 * GET /api/articles — 文章数据 API（Vercel Function，fetch Web Standard export）
 *
 * 用法：
 *   GET /api/articles           → 全部 meta（不含正文，轻量）
 *   GET /api/articles?id=p0001  → 单篇全文（含正文段落）
 *   GET /api/articles?q=..&topic=..&source=..&sort=..&limit=.. → 筛选/搜索
 *
 * 数据源：data/articles.db（SQLite，node:sqlite 只读）
 * 打包：data/articles.db 需通过 vercel.json functions.includeFiles 随函数部署
 */
import { queryMetaList, queryArticle } from './_db'

/** Vercel Function：GET handler */
export function GET(request: Request) {
  const url = new URL(request.url)
  const id = url.searchParams.get('id')

  // 单篇全文
  if (id) {
    const article = queryArticle(id)
    if (!article) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })
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
