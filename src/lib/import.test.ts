import { describe, expect, it } from 'vite-plus/test'
import { parseImportData } from './import'
import { TOPICS } from '../data'
import type { Annotation } from '../types'

/**
 * 导入解析：两种格式（整包 / 裸摘录数组）、逐字段容错、非法数据过滤。
 * 导入是跨设备迁移的唯一入口，坏数据必须被挡在 store 之外而不是污染本地。
 */

const ann = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'x1',
  articleId: 'a1',
  kind: 'highlight',
  text: '原文',
  start: 0,
  end: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

/** 整包格式里带正文的文章条目 */
const articleEntry = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  title: '标题',
  content: ['第一段', '第二段'],
  date: '2026-01-01',
  ...over,
})

describe('parseImportData：错误路径', () => {
  it('不是合法 JSON → 友好错误', () => {
    expect(parseImportData('{ not json')).toEqual({ error: '文件不是有效的 JSON，请选择导出的 .json 文件' })
  })

  it('既非数组也非对象 → 无法识别', () => {
    expect(parseImportData('42')).toEqual({ error: '无法识别的数据格式' })
    expect(parseImportData('null')).toEqual({ error: '无法识别的数据格式' })
    expect(parseImportData('"str"')).toEqual({ error: '无法识别的数据格式' })
  })

  it('数组里没有一条合法摘录 → 错误', () => {
    expect(parseImportData('[]')).toEqual({ error: '文件中没有可识别的摘录数据' })
    expect(parseImportData(JSON.stringify([{ foo: 1 }, null]))).toEqual({ error: '文件中没有可识别的摘录数据' })
  })

  it('整包但没有任何认识得出来的字段 → 错误', () => {
    expect(parseImportData(JSON.stringify({ hello: 'world' }))).toEqual({
      error: '文件内容与读本导出的数据格式不匹配',
    })
  })
})

describe('parseImportData：裸摘录数组（格式 2）', () => {
  it('合法摘录被接收，非法条目被过滤', () => {
    const r = parseImportData(JSON.stringify([ann({ id: 'ok' }), { id: 'bad' }, ann({ id: 'ok2', kind: 'note' })]))
    expect('annotations' in r && r.annotations.map((a) => a.id)).toEqual(['ok', 'ok2'])
  })

  it('kind 只认 highlight / underline / note', () => {
    const r = parseImportData(JSON.stringify([ann({ kind: 'bogus' as unknown as Annotation['kind'] })]))
    expect(r).toEqual({ error: '文件中没有可识别的摘录数据' })
  })
})

describe('parseImportData：整包（格式 1）', () => {
  it('主题 / 阅读设置 / 进度 / 摘录 / 学习结构 / 事件 全部识别', () => {
    const r = parseImportData(
      JSON.stringify({
        theme: 'night',
        readerSettings: { fontSize: 18, reducedMotion: true, 未知字段: 1 },
        articles: [{ id: 'a1', progress: { articleId: 'a1', percent: 42 } }],
        annotations: [ann()],
        shenlun: [{ articleId: 'a1', status: 'learning' }],
        learningEvents: [{ id: 'e1', objectId: 'o1', kind: 'read-finish', at: '2026-01-01T00:00:00.000Z' }],
      }),
    )
    if ('error' in r) throw new Error(r.error)

    expect(r.theme).toBe('night')
    expect(r.readerSettings).toEqual({ fontSize: 18, reducedMotion: true })
    expect(r.progress?.a1.percent).toBe(42)
    expect(r.annotations.map((a) => a.id)).toEqual(['x1'])
    expect(r.shenlun?.map((s) => s.articleId)).toEqual(['a1'])
    expect(r.learningEvents?.map((e) => e.id)).toEqual(['e1'])
  })

  it('非法主题被忽略，但其他合法字段仍算「已识别」', () => {
    const r = parseImportData(JSON.stringify({ theme: '不存在的主题', annotations: [ann()] }))
    if ('error' in r) throw new Error(r.error)
    expect(r.theme).toBeUndefined()
    expect(r.annotations).toHaveLength(1)
  })

  it('阅读设置里类型不对的字段被丢弃（不整包拒收）', () => {
    const r = parseImportData(
      JSON.stringify({ readerSettings: { fontSize: '18', lineHeight: 1.8, fontFamily: 7 }, annotations: [ann()] }),
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.readerSettings).toEqual({ lineHeight: 1.8 })
  })

  it('进度条目缺 articleId / percent 时被跳过', () => {
    const r = parseImportData(
      JSON.stringify({
        articles: [
          { id: 'a1', progress: { percent: 10 } },
          { id: 'a2', progress: { articleId: 'a2' } },
          { id: 'a3', progress: { articleId: 'a3', percent: 30 } },
        ],
      }),
    )
    if ('error' in r) throw new Error(r.error)
    expect(Object.keys(r.progress ?? {})).toEqual(['a3'])
  })

  it('学习结构：status 非法则不收', () => {
    const r = parseImportData(
      JSON.stringify({
        shenlun: [
          { articleId: 'a1', status: '混乱' },
          { articleId: 'a2', status: 'mastered' },
        ],
      }),
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.shenlun?.map((s) => s.articleId)).toEqual(['a2'])
  })

  it('学习事件：kind 不在证据表里则拒收', () => {
    const r = parseImportData(
      JSON.stringify({
        learningEvents: [
          { id: 'e1', objectId: 'o', kind: '编的', at: '2026-01-01T00:00:00.000Z' },
          { id: 'e2', objectId: 'o', kind: 'memorize', at: '2026-01-01T00:00:00.000Z' },
        ],
      }),
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.learningEvents?.map((e) => e.id)).toEqual(['e2'])
  })
})

describe('parseImportData：文章正文（parseArticles）', () => {
  it('非字符串段落被剔除，readTime 重新计算', () => {
    const r = parseImportData(JSON.stringify({ articles: [articleEntry({ content: ['文字', 42, null, '更多'] })] }))
    if ('error' in r) throw new Error(r.error)
    expect(r.articles?.[0].content).toEqual(['文字', '更多'])
    expect(r.articles?.[0].readTime).toBeGreaterThan(0)
  })

  it('正文为空（或全是非字符串）的文章被跳过', () => {
    const r = parseImportData(
      JSON.stringify({
        articles: [
          articleEntry({ id: 'empty', content: [] }),
          articleEntry({ id: 'bad', content: [1, 2] }),
          articleEntry({ id: 'ok' }),
        ],
      }),
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.articles?.map((a) => a.id)).toEqual(['ok'])
  })

  it('缺 id / title / content 的条目被跳过', () => {
    const r = parseImportData(
      JSON.stringify({ articles: [{ title: '无 id', content: ['x'] }, { id: 'a', content: ['x'] }, articleEntry()] }),
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.articles?.map((a) => a.id)).toEqual(['a1'])
  })

  it('topic / source 非法时兜底，日期缺失也能导入', () => {
    const r = parseImportData(
      JSON.stringify({ articles: [articleEntry({ topic: '瞎写的', source: '未知来源', date: undefined })] }),
    )
    if ('error' in r) throw new Error(r.error)
    /* 兜底到第一个合法主题（不写死具体值，避免主题表调整时测试假失败） */
    expect(TOPICS).toContain(r.articles?.[0].topic)
    expect(r.articles?.[0].source).toBe('人民日报')
    expect(r.articles?.[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
