import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useShenlunStore } from './shenlunStore'
import { useLearningEventStore } from './learningEventStore'

/**
 * 申论拆解 store：状态自动推进、钉住、子论点增删改、范文精读（段意/骨架）。
 * 自动推进与「钉住」是 docs/学习者数据模型设计.md 的推导规则，最易在重构中被破坏。
 */

function reset() {
  useShenlunStore.setState({ study: {} })
  useLearningEventStore.setState({ events: [] })
}

beforeEach(reset)

describe('shenlunStore 状态推进与钉住', () => {
  it('upsert 建立带默认值的拆解记录', () => {
    useShenlunStore.getState().upsert('a1', {})
    const st = useShenlunStore.getState().getStudy('a1')
    expect(st).toMatchObject({ articleId: 'a1', status: 'new', mastery: 0, subTheses: [] })
    expect(st?.createdAt).toBeTruthy()
    expect(st?.updatedAt).toBeTruthy()
  })

  it('未学文章写入实质内容后自动推进为「学习中」，并记一条 deconstruct 事件', () => {
    useShenlunStore.getState().setCoreThesis('a1', '核心观点')
    expect(useShenlunStore.getState().getStudy('a1')?.status).toBe('learning')
    expect(useLearningEventStore.getState().events.map((e) => e.kind)).toEqual(['deconstruct'])
  })

  it('钉住（setStatus）会阻止自动推进，unpin 后恢复', () => {
    useShenlunStore.getState().setStatus('a1', 'new')
    expect(useShenlunStore.getState().getStudy('a1')?.pinned).toBe(true)

    useShenlunStore.getState().setCoreThesis('a1', '有内容了')
    /* 钉住中：即使有内容也保持 new */
    expect(useShenlunStore.getState().getStudy('a1')?.status).toBe('new')

    useShenlunStore.getState().unpin('a1')
    useShenlunStore.getState().setCoreThesis('a1', '有内容的第二版')
    expect(useShenlunStore.getState().getStudy('a1')?.status).toBe('learning')
  })

  it('setMastery 写入 0–3 星', () => {
    useShenlunStore.getState().setMastery('a1', 3)
    expect(useShenlunStore.getState().getStudy('a1')?.mastery).toBe(3)
  })
})

describe('shenlunStore 分论点增删改', () => {
  it('add / update / remove 保持顺序与内容', () => {
    const s = useShenlunStore.getState()
    s.addSubThesis('a1', '论点一')
    s.addSubThesis('a1', '论点二')
    expect(useShenlunStore.getState().getStudy('a1')?.subTheses).toEqual(['论点一', '论点二'])

    useShenlunStore.getState().updateSubThesis('a1', 1, '论点二（改）')
    expect(useShenlunStore.getState().getStudy('a1')?.subTheses).toEqual(['论点一', '论点二（改）'])

    useShenlunStore.getState().removeSubThesis('a1', 0)
    expect(useShenlunStore.getState().getStudy('a1')?.subTheses).toEqual(['论点二（改）'])
  })

  it('对不存在的文章 update/remove 分论点不抛错也不建记录', () => {
    expect(() => useShenlunStore.getState().updateSubThesis('nope', 0, 'x')).not.toThrow()
    expect(() => useShenlunStore.getState().removeSubThesis('nope', 0)).not.toThrow()
    expect(useShenlunStore.getState().getStudy('nope')).toBeUndefined()
  })
})

describe('shenlunStore 范文精读', () => {
  it('段意按 paraIndex 排序，同段落覆盖而非重复', () => {
    const s = () => useShenlunStore.getState().getStudy('a1')?.paragraphSummaries ?? []
    useShenlunStore.getState().setParagraphSummary('a1', 2, '第三段大意')
    useShenlunStore.getState().setParagraphSummary('a1', 0, '第一段大意')
    expect(s().map((p) => p.paraIndex)).toEqual([0, 2])

    useShenlunStore.getState().setParagraphSummary('a1', 0, '第一段大意（改）')
    expect(s()).toHaveLength(2)
    expect(s()[0].summary).toBe('第一段大意（改）')
    /* 人工编辑即视为已确认 */
    expect(s()[0]).toMatchObject({ origin: 'user', confirmed: true })
  })

  it('AI 起草的段意保持未确认草稿态', () => {
    useShenlunStore.getState().setParagraphSummary('a1', 1, 'AI 草稿', { origin: 'ai', confirmed: false })
    expect(useShenlunStore.getState().getStudy('a1')?.paragraphSummaries?.[0]).toMatchObject({
      origin: 'ai',
      confirmed: false,
    })
  })

  it('清空某段大意即移除该条', () => {
    useShenlunStore.getState().setParagraphSummary('a1', 0, '要删的段意')
    useShenlunStore.getState().setParagraphSummary('a1', 0, '   ')
    expect(useShenlunStore.getState().getStudy('a1')?.paragraphSummaries).toEqual([])
  })

  it('setSkeleton 合并 patch', () => {
    useShenlunStore.getState().setSkeleton('a1', { opening: '开篇' })
    useShenlunStore.getState().setSkeleton('a1', { closing: '结尾' })
    expect(useShenlunStore.getState().getStudy('a1')?.skeleton).toMatchObject({ opening: '开篇', closing: '结尾' })
  })

  it('setReviewNote 非空才记 review-note 事件', () => {
    useShenlunStore.getState().setReviewNote('a1', '   ')
    expect(useLearningEventStore.getState().events).toEqual([])
    useShenlunStore.getState().setReviewNote('a1', '复盘心得')
    expect(useLearningEventStore.getState().events.map((e) => e.kind)).toEqual(['review-note'])
  })
})

describe('shenlunStore 导入 / 删除 / 清空', () => {
  it('importStudy 按 articleId 覆盖', () => {
    useShenlunStore.getState().upsert('a1', { coreThesis: '本地' })
    useShenlunStore.getState().importStudy([
      {
        articleId: 'a1',
        status: 'mastered',
        mastery: 3,
        coreThesis: '云端',
        subTheses: [],
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-02T00:00:00.000Z',
      },
    ])
    expect(useShenlunStore.getState().getStudy('a1')?.coreThesis).toBe('云端')
    expect(useShenlunStore.getState().getStudy('a1')?.status).toBe('mastered')
  })

  it('removeForArticle 只删该文章', () => {
    useShenlunStore.getState().upsert('a1', { coreThesis: 'x' })
    useShenlunStore.getState().upsert('a2', { coreThesis: 'y' })
    useShenlunStore.getState().removeForArticle('a1')
    expect(useShenlunStore.getState().getStudy('a1')).toBeUndefined()
    expect(useShenlunStore.getState().getStudy('a2')).toBeDefined()
  })

  it('clearAll 清空全部拆解', () => {
    useShenlunStore.getState().upsert('a1', { coreThesis: 'x' })
    useShenlunStore.getState().clearAll()
    expect(useShenlunStore.getState().study).toEqual({})
  })
})
