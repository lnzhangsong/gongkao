import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useAnnotationStore } from './annotationStore'
import { useLearningEventStore } from './learningEventStore'
import type { Annotation } from '../types'

/**
 * 标注 store：素材标记链路的核心（P1）。这里锁住三件容易回归的事：
 * 1. 增删改的基本不变量（add 生成 id/时间、update 只动目标、removeForArticle 不误删别的文章）
 * 2. 素材类型/背记/掌握度变化会**恰好一次**写入学习事件（重复打标不应重复记）
 * 3. 导入按 id 去重（跨设备合并时不能产生重复摘录）
 */

const base = (articleId: string, text = '选中的原文'): Omit<Annotation, 'id' | 'createdAt'> => ({
  articleId,
  kind: 'highlight',
  text,
  start: 0,
  end: text.length,
  color: 'yellow',
})

function reset() {
  useAnnotationStore.setState({ annotations: [], visible: true })
  useLearningEventStore.setState({ events: [] })
}

beforeEach(reset)

describe('annotationStore 增删改', () => {
  it('add 生成 id / createdAt / updatedAt，并前插到列表头部', () => {
    const first = useAnnotationStore.getState().add(base('a1', '第一条'))
    const second = useAnnotationStore.getState().add(base('a1', '第二条'))
    const list = useAnnotationStore.getState().annotations

    expect(first.id).toBeTruthy()
    expect(first.createdAt).toBeTruthy()
    expect(first.updatedAt).toBe(first.createdAt)
    expect(second.id).not.toBe(first.id)
    /* 新标注在前：阅读页按偏移渲染时最近添加的优先命中 */
    expect(list.map((a) => a.id)).toEqual([second.id, first.id])
  })

  it('update 只改目标条目并刷新 updatedAt', () => {
    const a = useAnnotationStore.getState().add(base('a1'))
    const b = useAnnotationStore.getState().add(base('a1'))
    useAnnotationStore.getState().update(a.id, { noteText: '补充笔记' })

    const list = useAnnotationStore.getState().annotations
    expect(list.find((x) => x.id === a.id)?.noteText).toBe('补充笔记')
    expect(list.find((x) => x.id === b.id)?.noteText).toBeUndefined()
  })

  it('remove / removeMany 按 id 精确删除', () => {
    const a = useAnnotationStore.getState().add(base('a1'))
    const b = useAnnotationStore.getState().add(base('a1'))
    const c = useAnnotationStore.getState().add(base('a1'))
    useAnnotationStore.getState().remove(a.id)
    expect(useAnnotationStore.getState().annotations.map((x) => x.id)).toEqual([c.id, b.id])
    useAnnotationStore.getState().removeMany([b.id, c.id])
    expect(useAnnotationStore.getState().annotations).toEqual([])
  })

  it('removeForArticle 只清该文章，其它文章不动', () => {
    useAnnotationStore.getState().add(base('a1'))
    const keep = useAnnotationStore.getState().add(base('a2'))
    useAnnotationStore.getState().removeForArticle('a1')
    expect(useAnnotationStore.getState().annotations.map((x) => x.id)).toEqual([keep.id])
  })

  it('clearAll 清空标注并重置显示开关', () => {
    useAnnotationStore.getState().add(base('a1'))
    useAnnotationStore.getState().setVisible(false)
    useAnnotationStore.getState().clearAll()
    expect(useAnnotationStore.getState().annotations).toEqual([])
    expect(useAnnotationStore.getState().visible).toBe(true)
  })
})

describe('annotationStore 导入去重', () => {
  it('按 id 跳过已存在的摘录，只追加新条目', () => {
    const mine = useAnnotationStore.getState().add(base('a1', '本地已有'))
    const incoming: Annotation = {
      ...base('a1', '导入的'),
      id: mine.id,
      createdAt: '2026-09-01T00:00:00.000Z',
    }
    const fresh: Annotation = {
      ...base('a2', '导入的新条目'),
      id: 'ann-imported-1',
      createdAt: '2026-09-01T00:00:00.000Z',
    }
    useAnnotationStore.getState().importAnnotations([incoming, fresh])

    const list = useAnnotationStore.getState().annotations
    expect(list).toHaveLength(2)
    expect(list.map((x) => x.id).sort()).toEqual([mine.id, 'ann-imported-1'].sort())
    /* 已存在的条目保持本地版本，不被导入覆盖 */
    expect(list.find((x) => x.id === mine.id)?.text).toBe('本地已有')
  })

  it('全部重复时不改变列表引用（避免无意义重渲染）', () => {
    const mine = useAnnotationStore.getState().add(base('a1'))
    const before = useAnnotationStore.getState().annotations
    useAnnotationStore.getState().importAnnotations([{ ...mine }])
    expect(useAnnotationStore.getState().annotations).toBe(before)
  })
})

describe('annotationStore 学习事件采集', () => {
  it('首次打素材类型记一条 tag-material，重复打标不再记', () => {
    const a = useAnnotationStore.getState().add(base('a1'))
    useAnnotationStore.getState().update(a.id, { materialType: 'thesis' })
    expect(useLearningEventStore.getState().events.map((e) => e.kind)).toEqual(['tag-material'])

    /* 已标记过再改类型（thesis → quote）：不应再记 */
    useAnnotationStore.getState().update(a.id, { materialType: 'quote' })
    expect(useLearningEventStore.getState().events.map((e) => e.kind)).toEqual(['tag-material'])
  })

  it('首次加入背记记一条 memorize', () => {
    const a = useAnnotationStore.getState().add(base('a1'))
    useAnnotationStore.getState().update(a.id, { memorized: true })
    useAnnotationStore.getState().update(a.id, { memorized: true })
    expect(useLearningEventStore.getState().events.map((e) => e.kind)).toEqual(['memorize'])
  })

  it('掌握度自评会记 mastery-self', () => {
    const a = useAnnotationStore.getState().add(base('a1'))
    useAnnotationStore.getState().update(a.id, { mastery: 2 })
    expect(useLearningEventStore.getState().events.map((e) => e.kind)).toEqual(['mastery-self'])
  })

  it('更新不存在的 id 不产生事件也不抛错', () => {
    expect(() => useAnnotationStore.getState().update('__nope__', { materialType: 'thesis' })).not.toThrow()
    expect(useLearningEventStore.getState().events).toEqual([])
  })
})
