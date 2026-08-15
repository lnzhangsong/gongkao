/**
 * GET /api/articles/:id — 单篇全文（含正文段落）
 */
import { queryArticle } from '../_db'

export const config = { runtime: 'nodejs' }

export default async function handler(req: Request, ctx: { params: { id: string } }) {
  const { id } = ctx.params
  const article = queryArticle(id)
  if (!article) {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }
  return new Response(JSON.stringify(article), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, max-age=300',
    },
  })
}
