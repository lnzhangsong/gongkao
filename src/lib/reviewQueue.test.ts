import { describe, expect, it } from 'vite-plus/test'
import { reviewQueue } from './reviewQueue'
import type { Annotation } from '../types'
import type { LearningEvent } from '../stores/learningEventStore'

/**
 * 背记素材的到期队列：池筛选 + 到期规则 + 排序。
 * `now` 由调用方传入（不再内部读 Date.now），给定固定基准即确定。
 */

const NOW = new Date('2026-06-01T00:00:00.000Z').getTime()
const DAY = 86_400_000
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString()

/** 默认造一条「金句 + 已加入背记」的合格素材 */
function ann(over: Partial<Annotation> = {}): Annotation {
  return {
    id: 'q1',
    articleId: 'p1',
    kind: 'highlight',
    text: '金句',
    start: 0,
    end: 2,
    createdAt: daysAgo(100),
    materialType: 'quote',
    memorized: true,
    ...over,
  }
}

function ev(objectId: string, at: string): LearningEvent {
  return { id: `${objectId}-${at}`, objectId, objectType: 'material', kind: 'memorize', weight: 1, at }
}

const ids = (list: Annotation[]) => list.map((a) => a.id)
const due = (list: Annotation[], events: LearningEvent[] = []) => ids(reviewQueue(list, events, NOW))

describe('reviewQueue', () => {
  it('只收「highlight + 金句/句式 + 已加入背记」的素材', () => {
    const list = [
      ann({ id: 'ok-quote', materialType: 'quote' }),
      ann({ id: 'ok-pattern', materialType: 'pattern' }),
      ann({ id: 'no-memorize', memorized: false }),
      ann({ id: 'no-type', materialType: undefined }),
      ann({ id: 'other-type', materialType: 'thesis' }),
      ann({ id: 'not-highlight', kind: 'note' }),
      ann({ id: 'not-underline', kind: 'underline', materialType: 'quote' }),
    ]

    expect(due(list)).toEqual(['ok-quote', 'ok-pattern'])
  })

  it('未掌握（mastery 非 2，含缺省）一律到期', () => {
    const list = [ann({ id: 'undefined' }), ann({ id: 'zero', mastery: 0 }), ann({ id: 'fuzzy', mastery: 1 })]
    /* 即便刚刚复习过，只要没标「已掌握」就仍然到期 */
    const events = list.map((a) => ev(a.id, daysAgo(0)))

    expect(due(list, events).sort()).toEqual(['fuzzy', 'undefined', 'zero'])
  })

  it('已掌握：无复习证据 → 到期；7 天内复习过 → 不到期；超过 7 天 → 到期', () => {
    const list = [ann({ id: 'never', mastery: 2 }), ann({ id: 'recent', mastery: 2 }), ann({ id: 'stale', mastery: 2 })]
    const events = [ev('recent', daysAgo(6)), ev('stale', daysAgo(8))]

    expect(due(list, events).sort()).toEqual(['never', 'stale'])
  })

  it('7 天整为边界：严格大于才到期', () => {
    const list = [ann({ id: 'exactly', mastery: 2 }), ann({ id: 'justOver', mastery: 2 })]
    const events = [ev('exactly', daysAgo(7)), ev('justOver', new Date(NOW - 7 * DAY - 1).toISOString())]

    expect(due(list, events)).toEqual(['justOver'])
  })

  it('只看该素材自己的证据（别的 objectId 不算复习过）', () => {
    const list = [ann({ id: 'mine', mastery: 2 })]
    const events = [ev('someone-else', daysAgo(1))]

    expect(due(list, events)).toEqual(['mine'])
  })

  it('未掌握排前；掌握组内按最近证据最旧优先', () => {
    const list = [
      ann({ id: 'mastered-new', mastery: 2 }),
      ann({ id: 'not-mastered', mastery: 0 }),
      ann({ id: 'mastered-old', mastery: 2 }),
    ]
    const events = [ev('mastered-new', daysAgo(10)), ev('mastered-old', daysAgo(40)), ev('not-mastered', daysAgo(0))]

    expect(due(list, events)).toEqual(['not-mastered', 'mastered-old', 'mastered-new'])
  })

  it('取同一素材最近的一条证据（乱序传入也算）', () => {
    const list = [ann({ id: 'x', mastery: 2 })]
    /* 旧证据在后：仍应以最近的那条为准 → 不到期 */
    const events = [ev('x', daysAgo(1)), ev('x', daysAgo(50))]

    expect(due(list, events)).toHaveLength(0)
  })
})
