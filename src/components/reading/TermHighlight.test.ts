import { describe, expect, it } from 'vite-plus/test'
import { splitTermSegments } from './TermHighlight'
import type { GuiFanTerm } from '../../lib/api'
import { formatArticleNo, formatLocalDate } from '../../data'

const term = (id: number, theme: string, t: string): GuiFanTerm => ({ id, theme, term: t, example: '' })

describe('splitTermSegments', () => {
  const terms = [
    term(1, '基层治理', '最后一公里'),
    term(2, '民生保障', '最后一公里问题'), // 同起点最长匹配
    term(3, '文化自信', '传统文化'),
  ]

  it('命中词切分并附带词条', () => {
    const segs = splitTermSegments('打通服务群众的最后一公里', terms)
    expect(segs).toEqual([{ text: '打通服务群众的' }, { text: '最后一公里', hit: terms[0] }])
  })

  it('同起点最长匹配优先', () => {
    const segs = splitTermSegments('解决最后一公里问题', terms)
    expect(segs[1]).toEqual({ text: '最后一公里问题', hit: terms[1] })
  })

  it('无命中文本原样返回单片段', () => {
    expect(splitTermSegments('没有命中内容', terms)).toEqual([{ text: '没有命中内容' }])
  })

  it('少于一字的泛词被忽略（MIN_TERM_LEN=3）', () => {
    expect(splitTermSegments('企业发展', [term(9, 'x', '企业')])).toEqual([{ text: '企业发展' }])
  })
})

describe('formatArticleNo', () => {
  it('补齐三位', () => {
    expect(formatArticleNo('a3')).toBe('003')
    expect(formatArticleNo('a0408')).toBe('408')
  })
})

describe('formatLocalDate', () => {
  it('使用本地时区而非 UTC 截断', () => {
    // 东八区 2026-08-30 22:00 = UTC 14:00，toISOString 截断会得到 08-30；若本地为 UTC 则恒等
    const iso = new Date('2026-08-30T22:00:00+08:00').toISOString()
    const expected = new Date(iso).toLocaleDateString('sv-SE').replaceAll('-', '.')
    expect(formatLocalDate(iso)).toBe(expected)
    expect(formatLocalDate(iso)).toMatch(/^\d{4}\.\d{2}\.\d{2}$/)
  })
})
