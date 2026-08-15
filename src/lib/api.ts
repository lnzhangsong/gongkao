import type { Article } from '../types'

/**
 * 前端 API 客户端：Vercel Functions / 本地 api-server（dev proxy）提供
 * - GET /api/articles          全部 meta（不含正文）
 * - GET /api/articles/:id      单篇全文
 */

interface MetaListResponse {
  articles: Article[]
  total: number
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`)
  return res.json() as Promise<T>
}

/** 全部文章 meta（不含正文） */
export function fetchMetaList(params?: { q?: string; topic?: string; source?: string; sort?: string; limit?: number }): Promise<MetaListResponse> {
  const sp = new URLSearchParams()
  if (params?.q) sp.set('q', params.q)
  if (params?.topic) sp.set('topic', params.topic)
  if (params?.source) sp.set('source', params.source)
  if (params?.sort) sp.set('sort', params.sort)
  if (params?.limit) sp.set('limit', String(params.limit))
  const qs = sp.toString()
  return getJSON<MetaListResponse>(`/api/articles${qs ? `?${qs}` : ''}`)
}

/** 单篇全文 */
export function fetchArticle(id: string): Promise<Article> {
  return getJSON<Article>(`/api/articles/${encodeURIComponent(id)}`)
}
