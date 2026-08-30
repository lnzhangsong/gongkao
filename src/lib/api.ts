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

/** 写接口令牌（可选）：本地 api-server 设置 WRITE_TOKEN 后，
 *  在浏览器 localStorage 写入同值 key 即可继续使用增删改 */
function writeToken(): Record<string, string> {
  try {
    const t = localStorage.getItem('readbook:write-token')
    return t ? { 'x-write-token': t } : {}
  } catch {
    return {}
  }
}

const DEFAULT_TIMEOUT_MS = 20000

/**
 * GET 会话缓存 + 并发去重：
 * - 同一次打开站点内，试卷/规范词等列表与详情二次进入直接复用，不再重复请求转圈
 * - 同一 URL 的并发请求合并为一次
 * - 所有写操作（POST/PATCH/DELETE）成功后调 invalidateCache 清掉对应前缀，保证写后读到新数据
 */
const sessionCache = new Map<string, unknown>()
const inflightGets = new Map<string, Promise<unknown>>()

function cachedGet<T>(url: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = sessionCache.get(url)
  if (hit !== undefined) return Promise.resolve(hit as T)
  const pending = inflightGets.get(url)
  if (pending) return pending as Promise<T>
  const req = fetcher()
    .then((data) => {
      sessionCache.set(url, data)
      return data
    })
    .finally(() => {
      inflightGets.delete(url)
    })
  inflightGets.set(url, req)
  return req
}

/** 使会话缓存失效：命中任一前缀（按 URL 开头匹配）的条目被清除 */
export function invalidateCache(prefixes: string[]): void {
  for (const key of [...sessionCache.keys()]) {
    if (prefixes.some((p) => key.startsWith(p))) sessionCache.delete(key)
  }
}


/**
 * 统一请求封装：
 * - 超时中断（AbortController），避免离线时请求悬挂
 * - 错误响应先读 text 再尝试 JSON：网关返回非 JSON（如 502 HTML 页）时
 *   不会因 res.json() 抛 SyntaxError 而掩盖真实状态码
 * - label：错误信息前缀（如「保存失败」）
 */
async function request<T>(url: string, init?: RequestInit, label?: string): Promise<T> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS)
  try {
    const method = (init?.method ?? 'GET').toUpperCase()
    const extra = method === 'GET' ? {} : { headers: { ...writeToken(), ...(init?.headers ?? {}) } }
    const res = await fetch(url, { ...init, ...extra, signal: init?.signal ?? ctrl.signal })
    const body = await res.text()
    if (!res.ok) {
      let detail = String(res.status)
      try {
        detail = (JSON.parse(body) as { error?: string }).error ?? detail
      } catch {
        /* 非 JSON 响应体（网关错误页等），直接用状态码 */
      }
      throw new Error(label ? `${label} ${detail}` : `API ${detail}: ${url}`)
    }
    return (body ? JSON.parse(body) : undefined) as T
  } finally {
    window.clearTimeout(timer)
  }
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
  return request<MetaListResponse>(`/api/articles${qs ? `?${qs}` : ''}`)
}

/** 单篇全文 */
export function fetchArticle(id: string): Promise<Article> {
  return request<Article>(`/api/articles?id=${encodeURIComponent(id)}`)
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

/** 申论真题试卷列表（按年份倒序；cache:'reload' 绕过 HTTP 缓存，会话缓存由 cachedGet 负责） */
export function fetchExamList(params?: { year?: number; level?: string }): Promise<{ papers: ExamPaperMeta[]; total: number }> {
  const sp = new URLSearchParams()
  if (params?.year) sp.set('year', String(params.year))
  if (params?.level) sp.set('level', params.level)
  const qs = sp.toString()
  const url = `/api/exams${qs ? `?${qs}` : ''}`
  return cachedGet(url, () => request(url, { cache: 'reload' }))
}

/** 申论真题试卷详情（材料 + 题目 + 答案）；用 ?id= 查询参数，与线上 Function 路由行为一致 */
export function fetchExam(id: string): Promise<ExamDetail> {
  const url = `/api/exams?id=${encodeURIComponent(id)}`
  return cachedGet(url, () => request<ExamDetail>(url))
}

/** 申论规范词条目 */
export interface GuiFanTerm {
  id: number
  theme: string
  term: string
  example: string
}

/** 申论规范词全集（?theme=&q= 服务端过滤；前端通常一次拉全量本地分组/搜索） */
export function fetchTerms(params?: { theme?: string; q?: string }): Promise<{ terms: GuiFanTerm[]; total: number }> {
  const sp = new URLSearchParams()
  if (params?.theme) sp.set('theme', params.theme)
  if (params?.q) sp.set('q', params.q)
  const qs = sp.toString()
  const url = `/api/terms${qs ? `?${qs}` : ''}`
  return cachedGet(url, () => request(url))
}

/** 新增规范词（仅本地 api-server 提供写入） */
export function addTerm(data: { theme: string; term: string; example?: string }): Promise<{ ok: boolean; id: number }> {
  invalidateCache(['/api/terms'])
  return request('/api/terms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }, '保存失败')
}

/** 修改规范词（部分更新；仅本地 api-server 提供写入） */
export function updateTerm(id: number, data: { theme?: string; term?: string; example?: string }): Promise<{ ok: boolean }> {
  invalidateCache(['/api/terms'])
  return request(`/api/terms/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }, '保存失败')
}

/** 删除规范词（仅本地 api-server 提供写入） */
export function deleteTerm(id: number): Promise<{ ok: boolean }> {
  invalidateCache(['/api/terms'])
  return request(`/api/terms/${id}`, { method: 'DELETE' }, '删除失败')
}

/** 保存试卷编辑（仅本地 api-server 提供写入） */
export function saveExam(
  id: string,
  data: Pick<ExamDetail, 'year' | 'level' | 'title'> & {
    materials: { idx: number; content: string }[]
    questions: { idx: number; type: string | null; stem: string; requirement: string; wordLimit: number | null; points: number | null; answer: string | null }[]
  },
): Promise<{ ok: boolean; id: string }> {
  invalidateCache(['/api/exams'])
  return request(`/api/exams/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }, '保存失败')
}

/** 新增空白试卷（仅本地 api-server） */
export function createExam(paper: { year: number; level: string; title: string }): Promise<{ ok: boolean; id: string }> {
  invalidateCache(['/api/exams'])
  return request('/api/exams', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(paper) }, '创建失败')
}

/** 删除试卷（连同材料与题目，仅本地 api-server） */
export function deleteExam(id: string): Promise<{ ok: boolean }> {
  invalidateCache(['/api/exams'])
  return request(`/api/exams/${encodeURIComponent(id)}`, { method: 'DELETE' }, '删除失败')
}
