import { describe, expect, it, beforeEach } from 'vite-plus/test'
import { useMethodStudyStore, asDoneMap } from './methodStudyStore'

/** 方法论书读书记录 store：toggle / 清空（退出登录必须能清干净，否则换账号会串数据） */
describe('methodStudyStore', () => {
  beforeEach(() => {
    useMethodStudyStore.setState({ done: {} })
  })

  it('toggle 无第二参时切换已读态，带布尔时直接指定', () => {
    useMethodStudyStore.getState().toggle('l01-u02')
    expect(useMethodStudyStore.getState().done['l01-u02']).toBeTruthy()
    useMethodStudyStore.getState().toggle('l01-u02')
    expect(useMethodStudyStore.getState().done['l01-u02']).toBeUndefined()
    useMethodStudyStore.getState().toggle('l01-u03', true)
    useMethodStudyStore.getState().toggle('l01-u03', true)
    expect(useMethodStudyStore.getState().done['l01-u03']).toBeTruthy()
  })

  it('clearAll 清空整机读书记录（退出登录用）', () => {
    useMethodStudyStore.getState().toggle('l01-u02')
    useMethodStudyStore.getState().toggle('l08-u01')
    useMethodStudyStore.getState().clearAll()
    expect(useMethodStudyStore.getState().done).toEqual({})
  })
})

describe('asDoneMap（坏记录拒入）', () => {
  it('只保留 l nn-u nn 键形与字符串值', () => {
    expect(asDoneMap({ 'l01-u02': '2026-09-15T00:00:00.000Z', 'bad-key': 'x', 'l1-u2': 3 })).toEqual({
      'l01-u02': '2026-09-15T00:00:00.000Z',
    })
  })

  it('非对象输入返回空对象', () => {
    expect(asDoneMap(null)).toEqual({})
    expect(asDoneMap('x')).toEqual({})
  })
})
