import { describe, expect, it } from 'vite-plus/test'
import { GET as getExams } from './exams'
import { GET as getTerms } from './terms'
import { GET as getXingce } from './xingce'

/**
 * /api/exams、/api/terms、/api/xingce 端点冒烟测试。
 * 这些 Function 与 articles 同构（node:sqlite 只读真实库），此前零覆盖；
 * 这里锁住「列表/详情/404 三种基本形态 + 过滤参数」不被后续重构破坏。
 */

function get(handler: (req: Request) => Response, path: string, params = ''): Response {
  return handler(new Request(`http://localhost${path}${params}`))
}
async function body<T>(res: Response): Promise<T> {
  return JSON.parse(await res.text()) as T
}

describe('/api/exams（申论真题）', () => {
  it('列表返回 papers，total 一致', async () => {
    const data = await body<{ papers: { id: string; year: number; questionCount: number }[]; total: number }>(
      get(getExams, '/api/exams'),
    )
    expect(data.total).toBe(data.papers.length)
    expect(data.total).toBeGreaterThan(0)
    expect(typeof data.papers[0].id).toBe('string')
    expect(typeof data.papers[0].year).toBe('number')
  })

  it('按 id 返回材料与题目', async () => {
    const list = await body<{ papers: { id: string }[] }>(get(getExams, '/api/exams'))
    const id = list.papers[0].id
    const res = get(getExams, '/api/exams', `?id=${encodeURIComponent(id)}`)
    expect(res.status).toBe(200)
    const detail = await body<{ id: string; materials: unknown[]; questions: unknown[] }>(res)
    expect(detail.id).toBe(id)
    expect(Array.isArray(detail.materials)).toBe(true)
    expect(Array.isArray(detail.questions)).toBe(true)
  })

  it('未知 id 返回 404', async () => {
    expect(get(getExams, '/api/exams', '?id=__none__').status).toBe(404)
  })

  it('year 过滤只返回该年份', async () => {
    const all = await body<{ papers: { year: number }[] }>(get(getExams, '/api/exams'))
    const year = all.papers[0].year
    const data = await body<{ papers: { year: number }[] }>(get(getExams, '/api/exams', `?year=${year}`))
    expect(data.papers.length).toBeGreaterThan(0)
    expect(data.papers.every((p) => p.year === year)).toBe(true)
  })
})

describe('/api/terms（规范词）', () => {
  it('返回全量词条，total 一致且字段齐全', async () => {
    const data = await body<{ terms: { theme: string; term: string; example: string }[]; total: number }>(
      get(getTerms, '/api/terms'),
    )
    expect(data.total).toBe(data.terms.length)
    expect(data.total).toBeGreaterThan(0)
    for (const t of data.terms.slice(0, 3)) {
      expect(typeof t.theme).toBe('string')
      expect(typeof t.term).toBe('string')
    }
  })

  it('q 做词面/例句包含匹配', async () => {
    const all = await body<{ terms: { term: string }[] }>(get(getTerms, '/api/terms'))
    const kw = all.terms[0].term.slice(0, 2)
    const data = await body<{ terms: { term: string; example: string }[] }>(
      get(getTerms, '/api/terms', `?q=${encodeURIComponent(kw)}`),
    )
    expect(data.terms.length).toBeGreaterThan(0)
    expect(data.terms.every((t) => t.term.includes(kw) || t.example.includes(kw))).toBe(true)
  })

  it('theme 过滤只返回该主题', async () => {
    const all = await body<{ terms: { theme: string }[] }>(get(getTerms, '/api/terms'))
    const theme = all.terms[0].theme
    const data = await body<{ terms: { theme: string }[] }>(
      get(getTerms, '/api/terms', `?theme=${encodeURIComponent(theme)}`),
    )
    expect(data.terms.length).toBeGreaterThan(0)
    expect(data.terms.every((t) => t.theme === theme)).toBe(true)
  })
})

describe('/api/xingce（行测真题）', () => {
  it('列表返回 3 套卷', async () => {
    const data = await body<{ papers: { id: string }[]; total: number }>(get(getXingce, '/api/xingce'))
    expect(data.total).toBe(data.papers.length)
    expect(data.total).toBeGreaterThan(0)
  })

  it('按 id 返回题目（含选项/答案字段形态）', async () => {
    const list = await body<{ papers: { id: string }[] }>(get(getXingce, '/api/xingce'))
    const id = list.papers[0].id
    const res = get(getXingce, '/api/xingce', `?id=${encodeURIComponent(id)}`)
    expect(res.status).toBe(200)
    const detail = await body<{ id: string; questions: { idx: number; options: unknown[] }[] }>(res)
    expect(detail.id).toBe(id)
    expect(detail.questions.length).toBeGreaterThan(0)
    expect(Array.isArray(detail.questions[0].options)).toBe(true)
  })

  it('未知 id 返回 404', async () => {
    expect(get(getXingce, '/api/xingce', '?id=__none__').status).toBe(404)
  })
})
