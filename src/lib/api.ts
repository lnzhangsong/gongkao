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
  return getJSON<Article>(`/api/articles?id=${encodeURIComponent(id)}`)
}

// —— 申论真题（data/articles.db）——

export interface ExamPaperMeta {
  id: string
  year: number
  level: string
  title: string
  hasAnswer: boolean
  questionCount: number
  materialCount: number
}

export interface ExamQuestion {
  idx: number
  type: string | null
  stem: string
  requirement: string
  wordLimit: number | null
  points: number | null
  answer: string | null
  answerMatched: boolean
}

export interface ExamDetail {
  id: string
  year: number
  level: string
  title: string
  warnings?: string
  materials: { idx: number; label: string; content: string }[]
  questions: ExamQuestion[]
  answersRaw?: string
}

/** 申论真题试卷列表（按年份倒序） */
export function fetchExamList(params?: { year?: number; level?: string }): Promise<{ papers: ExamPaperMeta[]; total: number }> {
  const sp = new URLSearchParams()
  if (params?.year) sp.set('year', String(params.year))
  if (params?.level) sp.set('level', params.level)
  const qs = sp.toString()
  return getJSON(`/api/exams${qs ? `?${qs}` : ''}`)
}

/** 申论真题试卷详情（材料 + 题目 + 答案） */
export function fetchExam(id: string): Promise<ExamDetail> {
  return getJSON(`/api/exams/${encodeURIComponent(id)}`)
}

/** 保存试卷编辑（仅本地 api-server 提供写入） */
export async function saveExam(
  id: string,
  data: Pick<ExamDetail, 'title'> & {
    materials: { idx: number; content: string }[]
    questions: { idx: number; type: string | null; stem: string; requirement: string; wordLimit: number | null; points: number | null; answer: string | null }[]
  },
): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/exams/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`保存失败 API ${res.status}`)
  return res.json() as Promise<{ ok: boolean }>
}

/** 新增空白试卷（仅本地 api-server） */
export async function createExam(paper: { year: number; level: string; title: string }): Promise<{ ok: boolean; id: string }> {
  const res = await fetch('/api/exams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(paper),
  })
  if (!res.ok) throw new Error(`创建失败 ${(await res.json()).error ?? res.status}`)
  return res.json() as Promise<{ ok: boolean; id: string }>
}
