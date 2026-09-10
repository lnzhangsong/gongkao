import { describe, expect, it, beforeEach } from 'vite-plus/test'
import { useXingceStore, asXgAnswer, xgKey, type XgAnswer } from './xingceStore'

/** 行测作答 store：写入/清卷/清空（退出登录必须能清干净，否则换账号会串数据） */
describe('xingceStore', () => {
  const answer = (paperId: string, qIdx: number, correct = true): XgAnswer => ({
    paperId,
    qIdx,
    picked: 'A',
    correct,
    seconds: 30,
    origin: 'practice',
    updatedAt: '2026-09-10T00:00:00.000Z',
  })

  beforeEach(() => {
    useXingceStore.setState({ answers: {} })
  })

  it('record 按 paperId#qIdx 写入作答', () => {
    useXingceStore.getState().record(answer('p1', 1))
    useXingceStore.getState().record(answer('p1', 2))
    const st = useXingceStore.getState()
    expect(Object.keys(st.answers)).toEqual([xgKey('p1', 1), xgKey('p1', 2)])
    expect(st.answers[xgKey('p1', 1)].correct).toBe(true)
  })

  it('clearPaper 只清指定卷，removeMany 只清指定题', () => {
    const s = useXingceStore.getState()
    s.record(answer('p1', 1))
    s.record(answer('p1', 2))
    s.record(answer('p2', 1))
    s.removeMany('p1', [1])
    expect(useXingceStore.getState().answers[xgKey('p1', 1)]).toBeUndefined()
    expect(useXingceStore.getState().answers[xgKey('p1', 2)]).toBeDefined()
    useXingceStore.getState().clearPaper('p1')
    expect(useXingceStore.getState().answers[xgKey('p1', 2)]).toBeUndefined()
    expect(useXingceStore.getState().answers[xgKey('p2', 1)]).toBeDefined()
  })

  it('clearAll 清空整机作答（退出登录用，回归：此前无此方法导致跨账号残留）', () => {
    const s = useXingceStore.getState()
    s.record(answer('p1', 1))
    s.record(answer('p2', 3))
    expect(Object.keys(useXingceStore.getState().answers)).toHaveLength(2)
    useXingceStore.getState().clearAll()
    expect(useXingceStore.getState().answers).toEqual({})
  })
})

describe('asXgAnswer（坏记录拒入）', () => {
  it('形状完整才通过', () => {
    expect(
      asXgAnswer({ paperId: 'p1', qIdx: 1, picked: 'A', correct: true, seconds: 1, origin: 'exam', updatedAt: 'x' }),
    ).not.toBeNull()
  })

  it('缺字段 / 类型错误返回 null', () => {
    expect(asXgAnswer(null)).toBeNull()
    expect(asXgAnswer({ paperId: 'p1', qIdx: 1 })).toBeNull()
    expect(asXgAnswer({ paperId: 'p1', qIdx: '1', picked: 'A', correct: true, updatedAt: 'x' })).toBeNull()
  })
})
