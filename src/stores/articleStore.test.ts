import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useArticleStore } from './articleStore'
import { useAnnotationStore } from './annotationStore'
import { useLearningEventStore } from './learningEventStore'
import { computeReadTime } from '../data'
import type { Article, ArticleInput, ReadingProgress } from '../types'

/**
 * 文章 store：阅读进度、收藏、本地录入/覆盖、删除墓碑、摘录联动。
 * 这些是「本地优先 + 云同步」的数据底座，出错的后果是丢进度或换账号串数据，
 * 因此用真实 store 动作（而非复刻逻辑）锁住不变量。
 */

const article = (id: string, title = '标题'): Article => ({
  id,
  title,
  summary: '摘要',
  content: ['第一段正文内容。', '第二段正文内容。'],
  source: '人民日报',
  topic: '基层治理',
  date: '2026-09-01',
  readTime: 1,
})

const input = (title = '新文章'): ArticleInput => ({
  title,
  summary: '摘要',
  content: ['段落一的内容。', '段落二的内容。'],
  source: '人民日报',
  topic: '民生保障',
  date: '2026-09-10',
})

function reset() {
  useArticleStore.setState({
    articles: [],
    localEdits: {},
    deletedIds: [],
    contentCache: {},
    progress: {},
    _apiReady: false,
  })
  useAnnotationStore.setState({ annotations: [], visible: true })
  useLearningEventStore.setState({ events: [] })
}

beforeEach(reset)

describe('articleStore 阅读进度', () => {
  it('saveProgress 夹取 percent 到 0–100 并取历史最大值（进度不回退）', () => {
    const s = () => useArticleStore.getState().getProgress('a1')
    useArticleStore.getState().saveProgress('a1', -20, 0)
    expect(s()?.percent).toBe(0)
    useArticleStore.getState().saveProgress('a1', 80, 120)
    expect(s()?.percent).toBe(80)
    /* 回滚到更小的百分比不应把进度改小 */
    useArticleStore.getState().saveProgress('a1', 20, 30)
    expect(s()?.percent).toBe(80)
    useArticleStore.getState().saveProgress('a1', 999, 200)
    expect(s()?.percent).toBe(100)
  })

  it('percent ≥95 记为读完，且只写一条 read-finish 学习事件', () => {
    useArticleStore.getState().saveProgress('a1', 95, 100)
    expect(useArticleStore.getState().getProgress('a1')?.completed).toBe(true)
    expect(useLearningEventStore.getState().events.map((e) => e.kind)).toEqual(['read-finish'])

    /* 已读完后继续滚动：completed 保持 true，不再重复记事件 */
    useArticleStore.getState().saveProgress('a1', 97, 110)
    expect(useLearningEventStore.getState().events.map((e) => e.kind)).toEqual(['read-finish'])
  })

  it('startReading 首次建进度，再次进入累加 readCount', () => {
    useArticleStore.getState().startReading('a1')
    expect(useArticleStore.getState().getProgress('a1')).toMatchObject({ readCount: 1 })
    expect(useArticleStore.getState().getProgress('a1')?.startedAt).toBeTruthy()
    useArticleStore.getState().startReading('a1')
    expect(useArticleStore.getState().getProgress('a1')?.readCount).toBe(2)
  })

  it('addReadingTime 累加实测时长，忽略非正数', () => {
    useArticleStore.getState().addReadingTime('a1', 30)
    useArticleStore.getState().addReadingTime('a1', 12.6)
    expect(useArticleStore.getState().getProgress('a1')?.timeSpentSec).toBe(43)
    useArticleStore.getState().addReadingTime('a1', 0)
    useArticleStore.getState().addReadingTime('a1', -5)
    expect(useArticleStore.getState().getProgress('a1')?.timeSpentSec).toBe(43)
  })

  it('toggleFavorite 反复切换', () => {
    useArticleStore.getState().toggleFavorite('a1')
    expect(useArticleStore.getState().getProgress('a1')?.favorite).toBe(true)
    useArticleStore.getState().toggleFavorite('a1')
    expect(useArticleStore.getState().getProgress('a1')?.favorite).toBe(false)
  })

  it('importProgress 按 articleId 合并覆盖', () => {
    useArticleStore.getState().saveProgress('a1', 10, 1)
    const p: ReadingProgress = {
      articleId: 'a1',
      percent: 60,
      lastPosition: 5,
      lastReadAt: '2026-09-01T00:00:00.000Z',
      completed: false,
      readCount: 3,
      favorite: true,
      timeSpentSec: 90,
    }
    useArticleStore.getState().importProgress({ a1: p, a2: { ...p, articleId: 'a2' } })
    expect(useArticleStore.getState().getProgress('a1')?.percent).toBe(60)
    expect(useArticleStore.getState().getProgress('a2')?.percent).toBe(60)
  })

  it('clearAll 清空进度（退出登录用）', () => {
    useArticleStore.getState().saveProgress('a1', 50, 1)
    useArticleStore.getState().clearAll()
    expect(useArticleStore.getState().progress).toEqual({})
  })
})

describe('articleStore 本地录入与删除', () => {
  it('addArticle 生成 id 并按正文重算 readTime', () => {
    const created = useArticleStore.getState().addArticle(input('本地新文'))
    expect(created.id.startsWith('u')).toBe(true)
    expect(created.readTime).toBe(computeReadTime(created.content ?? []))
    expect(useArticleStore.getState().articles.map((a) => a.id)).toContain(created.id)
    expect(useArticleStore.getState().localEdits[created.id]).toBeDefined()
  })

  it('updateArticle 覆盖正文并按新正文重算 readTime', () => {
    const created = useArticleStore.getState().addArticle(input('待改'))
    useArticleStore.getState().updateArticle(created.id, { ...input('改后'), content: ['只有一段。'] })
    const updated = useArticleStore.getState().articles.find((a) => a.id === created.id)
    expect(updated?.title).toBe('改后')
    expect(updated?.readTime).toBe(computeReadTime(['只有一段。']))
  })

  it('removeArticle 清进度、删摘录、并把年编文章记入 deletedIds 防复活', () => {
    useArticleStore.setState({ articles: [article('p0001')] })
    useArticleStore.getState().saveProgress('p0001', 50, 1)
    useAnnotationStore.getState().add({
      articleId: 'p0001',
      kind: 'highlight',
      text: 'x',
      start: 0,
      end: 1,
    })
    useAnnotationStore.getState().add({ articleId: 'p0002', kind: 'highlight', text: 'y', start: 0, end: 1 })

    useArticleStore.getState().removeArticle('p0001')

    const st = useArticleStore.getState()
    expect(st.articles.map((a) => a.id)).toEqual([])
    expect(st.deletedIds).toContain('p0001')
    expect(st.getProgress('p0001')).toBeUndefined()
    /* 只删该文章的摘录 */
    expect(useAnnotationStore.getState().annotations.map((a) => a.articleId)).toEqual(['p0002'])
  })

  it('upsertArticles 覆盖同 id 条目并追加新文章', () => {
    useArticleStore.setState({ articles: [article('p0001', '旧标题')] })
    useArticleStore.getState().upsertArticles([article('p0001', '新标题'), article('u-imported')])
    const list = useArticleStore.getState().articles
    expect(list.find((a) => a.id === 'p0001')?.title).toBe('新标题')
    expect(list.map((a) => a.id)).toContain('u-imported')
    expect(list).toHaveLength(2)
  })

  it('getArticle 优先返回已缓存的全文', () => {
    useArticleStore.setState({ articles: [article('a1', '列表里的')] })
    expect(useArticleStore.getState().getArticle('a1')?.title).toBe('列表里的')
    useArticleStore.setState({ contentCache: { a1: article('a1', '缓存全文') } })
    expect(useArticleStore.getState().getArticle('a1')?.title).toBe('缓存全文')
    expect(useArticleStore.getState().getArticle('missing')).toBeUndefined()
  })
})
