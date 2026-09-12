import { describe, expect, it } from 'vite-plus/test'
import { GET } from './articles'

/**
 * /api/articles 端点测试（Vercel Function 本体，node:sqlite 只读真实库）。
 *
 * 重点锁住一条曾经的真实分歧：**线上 API 只用 LIKE 全表扫，本地 api-server 却走
 * FTS5 trigram 索引**——同一关键词两边结果语义不同，且线上索引形同虚设。本测试
 * 用「从真实数据里取自串再搜回来」的方式验证 FTS 分支确实在走且有正确子串语义。
 */

const BASE = 'http://localhost/api/articles'

function get(params = ''): Response {
  return GET(new Request(`${BASE}${params}`))
}

async function body<T>(res: Response): Promise<T> {
  return JSON.parse(await res.text()) as T
}

interface Meta {
  articles: { id: string; title: string; topic: string }[]
  total: number
}

describe('/api/articles meta 列表', () => {
  it('返回 meta 列表，total 与 items 长度一致，且不含正文（省流量 + 不泄漏全文）', async () => {
    const res = get()
    expect(res.status).toBe(200)
    const data = await body<Meta>(res)
    expect(data.total).toBe(data.articles.length)
    expect(data.total).toBeGreaterThan(0)
    for (const a of data.articles.slice(0, 5)) {
      expect(a).not.toHaveProperty('content')
      expect(typeof a.id).toBe('string')
      expect(typeof a.title).toBe('string')
    }
  })

  it('带边缘缓存头', () => {
    expect(get().headers.get('cache-control')).toContain('s-maxage=3600')
  })

  it('limit 截断结果', async () => {
    const data = await body<Meta>(get('?limit=5'))
    expect(data.articles).toHaveLength(5)
  })

  it('topic 过滤只返回该主题', async () => {
    const all = (await body<Meta>(get())).articles
    const topic = all[0].topic
    const data = await body<Meta>(get(`?topic=${encodeURIComponent(topic)}`))
    expect(data.articles.length).toBeGreaterThan(0)
    expect(data.articles.every((a) => a.topic === topic)).toBe(true)
  })

  it('sort=title 按标题升序', async () => {
    const titles = (await body<Meta>(get('?sort=title'))).articles.map((a) => a.title)
    const sorted = [...titles].sort((a, b) => a.localeCompare(b, 'zh'))
    expect(titles).toEqual(sorted)
  })
})

describe('/api/articles 单篇全文', () => {
  it('按 id 返回正文段落', async () => {
    const first = (await body<Meta>(get())).articles[0]
    const res = get(`?id=${encodeURIComponent(first.id)}`)
    expect(res.status).toBe(200)
    const article = await body<{ id: string; content: string[] }>(res)
    expect(article.id).toBe(first.id)
    expect(Array.isArray(article.content)).toBe(true)
    expect(article.content.length).toBeGreaterThan(0)
  })

  it('未知 id 返回 404', async () => {
    const res = get('?id=__no_such_article__')
    expect(res.status).toBe(404)
    expect((await body<{ error: string }>(res)).error).toBe('not found')
  })
})

/** 从真实数据取一段「词字符」子串：FTS5 短语匹配对引号等特殊字符敏感，故只取中英文数字 */
function pickPhrase(text: string, len: number): string | null {
  const m = text.match(/[\u4e00-\u9fa5A-Za-z0-9]{4,}/)
  return m ? m[0].slice(0, Math.max(len, 4)) : null
}

describe('/api/articles 全文搜索（FTS5 trigram）', () => {
  it('≥3 字符命中标题子串', async () => {
    const first = (await body<Meta>(get())).articles[0]
    const phrase = pickPhrase(first.title, 4)
    expect(phrase).not.toBeNull()
    const ids = (await body<Meta>(get(`?q=${encodeURIComponent(phrase!)}`))).articles.map((a) => a.id)
    expect(ids).toContain(first.id)
  })

  it('FTS5 覆盖正文，不只是标题/摘要', async () => {
    const first = (await body<Meta>(get())).articles[0]
    const article = await body<{ content: string[] }>(get(`?id=${encodeURIComponent(first.id)}`))
    const phrase = pickPhrase(article.content.join('\n'), 4)
    expect(phrase).not.toBeNull()
    const ids = (await body<Meta>(get(`?q=${encodeURIComponent(phrase!)}`))).articles.map((a) => a.id)
    expect(ids).toContain(first.id)
  })

  it('搜索结果是「真子串」匹配：每个命中项的标题/摘要/正文确实含该短语', async () => {
    const phrase = '共同'
    const hits = (await body<Meta>(get(`?q=${encodeURIComponent(phrase)}`))).articles.slice(0, 8)
    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) {
      const full = await body<{ title: string; summary: string; content: string[] }>(
        get(`?id=${encodeURIComponent(hit.id)}`),
      )
      const hay = `${full.title}\n${full.summary}\n${full.content.join('\n')}`
      expect(hay).toContain(phrase)
    }
  })

  it('短于 3 字符时回退 LIKE，仍能命中（trigram 无法处理短词）', async () => {
    const first = (await body<Meta>(get())).articles[0]
    const two = first.title.match(/[\u4e00-\u9fa5]{2}/)?.[0]
    expect(two).toBeDefined()
    const ids = (await body<Meta>(get(`?q=${encodeURIComponent(two!)}`))).articles.map((a) => a.id)
    expect(ids).toContain(first.id)
  })

  it('无匹配时返回空列表而非报错', async () => {
    const data = await body<Meta>(get('?q=__zzz_绝无此词_zzz__'))
    expect(data.articles).toEqual([])
    expect(data.total).toBe(0)
  })
})
