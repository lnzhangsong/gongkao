import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { echoCompare, recallProbability } from './mastery'
import type { Annotation } from '../types'
import type { LearningEvent } from '../stores/learningEventStore'

/**
 * 素材可提取概率 R(t)（FSRS-4.5 幂律遗忘曲线简化版）与回声排序。
 * 函数内部读 Date.now()，故冻结系统时间以保证确定性。
 */

const NOW = new Date('2026-06-01T00:00:00.000Z')
const DAY = 86_400_000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

function ann(over: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    articleId: 'p1',
    kind: 'highlight',
    text: '原文',
    start: 0,
    end: 2,
    createdAt: daysAgo(0),
    ...over,
  }
}

function ev(objectId: string, kind: LearningEvent['kind'], at: string): LearningEvent {
  return { id: `${objectId}-${kind}-${at}`, objectId, objectType: 'material', kind, weight: 1, at }
}

describe('recallProbability', () => {
  it('无证据时按创建时间起算：越久越低，且落在 (0, 1]', () => {
    const fresh = recallProbability(ann({ createdAt: daysAgo(0) }), [])
    const old = recallProbability(ann({ createdAt: daysAgo(60) }), [])

    expect(fresh).toBeLessThanOrEqual(1)
    expect(fresh).toBeGreaterThan(0)
    expect(old).toBeGreaterThan(0)
    expect(fresh).toBeGreaterThan(old)
  })

  it('掌握度越高越稳（同一时间基准下 R 更大）', () => {
    const m0 = recallProbability(ann({ createdAt: daysAgo(30), mastery: 0 }), [])
    const m1 = recallProbability(ann({ createdAt: daysAgo(30), mastery: 1 }), [])
    const m2 = recallProbability(ann({ createdAt: daysAgo(30), mastery: 2 }), [])

    expect(m1).toBeGreaterThan(m0)
    expect(m2).toBeGreaterThan(m1)
  })

  it('有证据时以最近一条证据为基准，而非创建时间', () => {
    const a = ann({ createdAt: daysAgo(200) })
    const noEvidence = recallProbability(a, [])
    const justReviewed = recallProbability(a, [ev('a1', 'memorize', daysAgo(1))])

    expect(justReviewed).toBeGreaterThan(noEvidence)
  })

  it('只统计该素材自己的证据（别的 objectId 不算数）', () => {
    const a = ann({ createdAt: daysAgo(30) })
    const others = [ev('other', 'material-use', daysAgo(1)), ev('another', 'memorize', daysAgo(1))]

    expect(recallProbability(a, others)).toBe(recallProbability(a, []))
  })

  it('material-use 提升稳定性，且封顶 5 次', () => {
    const a = ann({ createdAt: daysAgo(1), mastery: 1 })
    const baseline = [ev('a1', 'memorize', daysAgo(10))]
    const used = (n: number) => [...baseline, ...Array.from({ length: n }, () => ev('a1', 'material-use', daysAgo(10)))]

    expect(recallProbability(a, used(3))).toBeGreaterThan(recallProbability(a, baseline))
    expect(recallProbability(a, used(6))).toBe(recallProbability(a, used(5)))
  })
})

describe('echoCompare（快忘的排前）', () => {
  it('可提取概率低者排前', () => {
    const fading = ann({ id: 'fading', createdAt: daysAgo(90) })
    const solid = ann({ id: 'solid', createdAt: daysAgo(0) })

    expect(echoCompare({ annotation: fading }, { annotation: solid }, [])).toBeLessThan(0)
    expect(echoCompare({ annotation: solid }, { annotation: fading }, [])).toBeGreaterThan(0)
  })

  it('概率相同时按创建时间早者排前', () => {
    const at = daysAgo(5)
    const older = ann({ id: 'older', createdAt: '2026-01-01T00:00:00.000Z', mastery: 1 })
    const newer = ann({ id: 'newer', createdAt: '2026-02-01T00:00:00.000Z', mastery: 1 })
    const events = [ev('older', 'memorize', at), ev('newer', 'memorize', at)]

    /* 同一掌握度 + 同一最近证据时间 ⇒ R 相同，进入创建时间兜底比较 */
    expect(recallProbability(older, events)).toBe(recallProbability(newer, events))
    expect(echoCompare({ annotation: older }, { annotation: newer }, events)).toBeLessThan(0)
  })
})
