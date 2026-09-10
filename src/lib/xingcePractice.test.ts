import { describe, expect, it } from 'vite-plus/test'
import {
  formatDuration,
  groupScore,
  optionCols,
  showTextStem,
  splitConditionLines,
  visualWidth,
} from './xingcePractice'
import type { XingceQuestion } from './api'

/**
 * 答题页的纯计算：分栏阈值、整组小结、时长格式。
 * 这些逻辑「改错了不易察觉」（分栏只是观感、小结数字错了也未必被发现），故单测钉住。
 */

const q = (over: Partial<XingceQuestion> = {}): XingceQuestion => ({
  idx: 1,
  section: '言语理解与表达',
  subtype: null,
  groupId: null,
  groupStem: null,
  groupImage: null,
  stem: '题干',
  options: [
    { key: 'A', text: '甲' },
    { key: 'B', text: '乙' },
    { key: 'C', text: '丙' },
    { key: 'D', text: '丁' },
  ],
  answer: 'A',
  explanation: null,
  image: null,
  ...over,
})

describe('visualWidth', () => {
  it('CJK / 全角记 2，ASCII 记 1', () => {
    expect(visualWidth('')).toBe(0)
    expect(visualWidth('abc')).toBe(3)
    expect(visualWidth('中文')).toBe(4)
    expect(visualWidth('中a')).toBe(3)
    expect(visualWidth('（全角括号）')).toBe(12)
  })
})

describe('optionCols（逐题判断，按视觉宽度）', () => {
  it('短选项四列、中等两列、长文本单列', () => {
    /* 视觉宽度：≤12 四列 / ≤36 两列 / >36 单列 */
    expect(
      optionCols([
        q({
          options: [
            { key: 'A', text: '12%' },
            { key: 'B', text: '34%' },
          ],
        }),
      ]),
    ).toBe(4)
    expect(optionCols([q({ options: [{ key: 'A', text: '加强基层治理能力' }] })])).toBe(2) // 宽 16
    expect(
      optionCols([
        q({
          options: [
            { key: 'A', text: '这是一段明显很长的选项文本需要独占一行才放得下' }, // 宽 46
            { key: 'B', text: '另一段同样很长的选项文本也需要独占一行' },
          ],
        }),
      ]),
    ).toBe(1)
  })

  it('逐题判断：同一份试卷里长短题互不牵连', () => {
    const short = q({
      idx: 1,
      options: [
        { key: 'A', text: '1' },
        { key: 'B', text: '2' },
      ],
    })
    const long = q({
      idx: 2,
      options: [{ key: 'A', text: '这是一段明显很长的选项文本需要独占一行才放得下' }],
    })

    expect(optionCols([short])).toBe(4)
    expect(optionCols([long])).toBe(1)
  })

  it('中英混排按视觉宽度而非字符数：同长度的中文更早降列', () => {
    /* 12 个 ASCII 字符 = 宽度 12（四列上限）；12 个汉字 = 宽度 24（应降为两列） */
    const latin = 'abcdefghijkl'
    const han = '一二三四五六七八九十十一'
    expect(latin.length).toBe(12)
    expect(han.length).toBe(12)

    expect(optionCols([q({ options: [{ key: 'A', text: latin }] })])).toBe(4)
    expect(optionCols([q({ options: [{ key: 'A', text: han }] })])).toBe(2)
  })

  it('无选项时不崩（退回四列）', () => {
    expect(optionCols([q({ options: [] })])).toBe(4)
    expect(optionCols([])).toBe(4)
  })
})

describe('groupScore（整组判分小结）', () => {
  const questions = [q({ idx: 1 }), q({ idx: 2 }), q({ idx: 3, answer: null })]

  it('无答案的题不计入 total', () => {
    const s = groupScore(questions, () => undefined)
    expect(s.total).toBe(2)
    expect(s.graded).toBe(0)
    expect(s.right).toBe(0)
    expect(s.seconds).toBe(0)
  })

  it('统计已判分的对错与用时', () => {
    const judged: Record<number, { correct: boolean; seconds: number }> = {
      1: { correct: true, seconds: 20 },
      2: { correct: false, seconds: 40 },
    }
    const s = groupScore(questions, (idx) => judged[idx])
    expect(s).toEqual({ right: 1, graded: 2, total: 2, seconds: 60 })
  })

  it('部分判分时只算已判的部分', () => {
    const s = groupScore(questions, (idx) => (idx === 1 ? { correct: true, seconds: 12 } : undefined))
    expect(s).toEqual({ right: 1, graded: 1, total: 2, seconds: 12 })
  })

  it('seconds 缺省按 0 计', () => {
    const s = groupScore([q({ idx: 1 })], () => ({ correct: true }))
    expect(s.seconds).toBe(0)
    expect(s.right).toBe(1)
  })
})

describe('formatDuration', () => {
  it('不足一分钟显示秒，超过显示 M:SS', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(59)).toBe('59s')
    expect(formatDuration(60)).toBe('1:00')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(600)).toBe('10:00')
  })

  it('负数与小数按取整处理', () => {
    expect(formatDuration(-5)).toBe('0s')
    expect(formatDuration(64.6)).toBe('1:05')
  })
})

describe('showTextStem（截图题的题干是否走文本渲染）', () => {
  it('流水线拆出的真题干渲染，占位符与空值不渲染', () => {
    expect(showTextStem('从所给的四个选项中，选择最合适的一个填入问号处。')).toBe(true)
    expect(showTextStem('第81题（见配图）')).toBe(false)
    expect(showTextStem('')).toBe(false)
  })

  it('只匹配整段占位符：含题号不同、前后缀的不误伤', () => {
    expect(showTextStem('第8题（见配图）')).toBe(false)
    expect(showTextStem('第818题（见配图）')).toBe(false)
    expect(showTextStem('第81题（见配图）如仍无法显示请看图')).toBe(true)
  })
})

describe('splitConditionLines（材料条件句拆行）', () => {
  it('编号自 1 连续 ≥2 个时拆行，前导句单独一行', () => {
    expect(splitConditionLines('已知：(1)甲和乙同组；(2)丙和丁不同组')).toEqual([
      '已知：',
      '(1)甲和乙同组；',
      '(2)丙和丁不同组',
    ])
  })

  it('全角括号、中文序号、带圈数字也认', () => {
    expect(splitConditionLines('（一）xxx；（二）yyy')).toEqual(['（一）xxx；', '（二）yyy'])
    expect(splitConditionLines('①红球在场内②蓝球在场外')).toEqual(['①红球在场内', '②蓝球在场外'])
  })

  it('单个、不连续或非 1 起步的编号不拆', () => {
    expect(splitConditionLines('共有 (3) 支队伍参赛')).toEqual(['共有 (3) 支队伍参赛'])
    expect(splitConditionLines('从(2)号开始，到(4)号结束')).toEqual(['从(2)号开始，到(4)号结束'])
    expect(splitConditionLines('')).toEqual([''])
  })
})
