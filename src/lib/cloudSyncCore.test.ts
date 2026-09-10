import { describe, expect, it } from 'vite-plus/test'
import { diffRows, shouldApply, sameJSON, mergePages, rowKey, type CloudRow } from './cloudSyncCore'

describe('diffRows（push 差异计算）', () => {
  const T0 = '2026-01-01T00:00:00Z'

  it('新增行与修改行都进 upserts', () => {
    const { upserts, tombstones } = diffRows(
      { a: { percent: 10 }, b: { percent: 99 } },
      { a: { percent: 10 } },
      T0,
      false,
    )
    expect(upserts).toEqual([{ k: 'b', data: { percent: 99 }, updatedAt: T0 }])
    expect(tombstones).toEqual([])
  })

  it('快照有、当前没有 → 墓碑（仅 allowTombstone 表）', () => {
    const snapshot = { a: { text: 'x' }, b: { text: 'y' } }
    const current = { a: { text: 'x' } }
    expect(diffRows(current, snapshot, T0, true).tombstones).toEqual([{ k: 'b', updatedAt: T0 }])
    expect(diffRows(current, snapshot, T0, false).tombstones).toEqual([])
  })

  it('内容相同但引用不同不算变化（zustand 每次重建对象）', () => {
    const { upserts } = diffRows({ a: { p: 1 } }, { a: { p: 1 } }, T0, false)
    expect(upserts).toEqual([])
  })

  it('无变化时 upserts 与 tombstones 均为空', () => {
    const { upserts, tombstones } = diffRows({ a: 1 }, { a: 1 }, T0, true)
    expect(upserts).toEqual([])
    expect(tombstones).toEqual([])
  })
})

describe('shouldApply（pull LWW 判定）', () => {
  it('无 meta 记录时总是应用', () => {
    expect(shouldApply('2026-01-01T00:00:00Z', undefined)).toBe(true)
  })

  it('云行严格晚于 meta 才应用，相同时间戳不重复应用', () => {
    expect(shouldApply('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(true)
    expect(shouldApply('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(false)
    expect(shouldApply('2025-12-31T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(false)
  })

  it('客户端 …Z 与 Postgres …+00:00 混用：跨毫秒仍判定正确（触发器迁移期）', () => {
    /* 两种写法共享 `YYYY-MM-DDTHH:MM:SS.` 前缀，毫秒不同时字典序即时间序 */
    expect(shouldApply('2026-01-01T00:00:01.000+00:00', '2026-01-01T00:00:00.999Z')).toBe(true)
    expect(shouldApply('2026-01-01T00:00:00.999Z', '2026-01-01T00:00:01.000+00:00')).toBe(false)
  })

  it('同一毫秒内保留微秒精度：Postgres 的 6 位小数可正确排序', () => {
    /* 这是保持字符串比较（而非 Date.parse）的理由：解析会截断到毫秒而判成相等 */
    expect(shouldApply('2026-01-01T00:00:00.123789+00:00', '2026-01-01T00:00:00.123456+00:00')).toBe(true)
    expect(shouldApply('2026-01-01T00:00:00.123456+00:00', '2026-01-01T00:00:00.123789+00:00')).toBe(false)
  })
})

describe('mergePages（分页去重）', () => {
  it('后页覆盖前页同键行', () => {
    const p1: CloudRow[] = [{ k: 'a', data: 1, updated_at: '2026-01-01T00:00:00Z' }]
    const p2: CloudRow[] = [{ k: 'a', data: 2, updated_at: '2026-01-02T00:00:00Z' }]
    expect(mergePages([p1, p2]).get('a')?.data).toBe(2)
  })
})

describe('sameJSON', () => {
  it('键序不同的浅对象视为相同', () => {
    expect(sameJSON({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false)
    expect(sameJSON({ a: 1 }, { a: 1 })).toBe(true)
  })
})

describe('rowKey（云端行 → 逻辑键）', () => {
  it('exam_study 复合主键必须带上 kind 前缀', () => {
    /* 回归：早期实现只取 key，apply 时把 paperId 当成 kind，真题溯源/标注被静默丢弃 */
    expect(rowKey({ kind: 'trace', key: '2024副省级#3', data: {} })).toBe('trace#2024副省级#3')
    expect(rowKey({ kind: 'mark', key: '2024副省级#3' })).toBe('mark#2024副省级#3')
  })

  it('单列主键表按各自列名还原', () => {
    expect(rowKey({ ann_id: 'a1' })).toBe('a1')
    expect(rowKey({ assist_id: 's1' })).toBe('s1')
    expect(rowKey({ article_id: 'p0001' })).toBe('p0001')
    expect(rowKey({ event_id: 'lev-1' })).toBe('lev-1')
    expect(rowKey({ key: 'p1#2' })).toBe('p1#2')
  })

  it('缺键或键非字符串时返回空串（调用方跳过该行）', () => {
    expect(rowKey({})).toBe('')
    expect(rowKey({ ann_id: 42 })).toBe('')
    expect(rowKey({ kind: 'trace' })).toBe('') // 只有 kind 没有 key
  })
})
