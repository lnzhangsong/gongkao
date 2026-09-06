import { describe, expect, it } from 'vite-plus/test'
import { diffRows, shouldApply, sameJSON, mergePages, type CloudRow } from './cloudSyncCore'

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
