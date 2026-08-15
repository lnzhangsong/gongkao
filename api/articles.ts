/**
 * GET /api/articles — 全部文章 meta（不含正文，轻量，供首页/文章库/搜索）
 * 可选查询参数：q（标题/摘要搜索）、topic、source、sort（date|title）、limit
 */
import { queryMetaList } from './_db'

export const config = { runtime: 'nodejs' }

export default async function handler(req: Request) {
  const url = new URL(req.url)
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
  // 默认按 date DESC（queryMetaList 已排）

  if (limit > 0) list = list.slice(0, limit)

  return new Response(JSON.stringify({ articles: list, total: list.length }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 数据只读且更新频率低：边缘缓存 1 小时，浏览器缓存 5 分钟
      'cache-control': 'public, s-maxage=3600, max-age=300',
    },
  })
}
