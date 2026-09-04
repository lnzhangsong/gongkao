import { describe, expect, it } from 'vitest'
import { parseTraceResult } from './aiExamTrace'

/** AI 溯源返回解析：mode 枚举容错 + sourceIdx 范围校验（越界/非数字 → null 材料外） */
describe('parseTraceResult', () => {
  const validIdx = [1, 2, 3]

  it('解析正常返回并补 id', () => {
    const raw = JSON.stringify({
      points: [
        {
          text: '监测感知网络是基础',
          mode: '摘抄',
          sourceIdx: 1,
          think: '题干问「如何保障」→ 定位材料1监测段落 → 提炼基础作用',
          quote: '构建智能高效的监测感知网络',
          note: '原词摘抄',
        },
        { text: '数据标注门槛提高', mode: '推理', sourceIdx: null },
      ],
    })
    const out = parseTraceResult(raw, validIdx)
    expect(out).toHaveLength(2)
    expect(out[0].id).toBeTruthy()
    expect(out[0].mode).toBe('摘抄')
    expect(out[0].sourceIdx).toBe(1)
    expect(out[0].think).toContain('题干问')
    expect(out[0].quote).toBe('构建智能高效的监测感知网络')
    expect(out[1].sourceIdx).toBeNull()
    expect(out[1].think).toBeUndefined()
    expect(out[1].note).toBeUndefined()
  })

  it('mode 非法回退「归纳」，sourceIdx 越界/非数字回退 null', () => {
    const raw = JSON.stringify({
      points: [
        { text: 'a', mode: '瞎写的', sourceIdx: 99 },
        { text: 'b', mode: '改写', sourceIdx: '二' },
        { text: 'c', sourceIdx: 2 },
      ],
    })
    const out = parseTraceResult(raw, validIdx)
    expect(out[0].mode).toBe('归纳')
    expect(out[0].sourceIdx).toBeNull()
    expect(out[1].sourceIdx).toBeNull()
    expect(out[2].sourceIdx).toBe(2)
  })

  it('丢弃空要点；解析代码块包裹与夹带说明文字的返回', () => {
    const fenced = '解析如下：\n```json\n{"points":[{"text":"x","mode":"提升","sourceIdx":3},{"text":"","mode":"摘抄","sourceIdx":1}]}\n```'
    const out = parseTraceResult(fenced, validIdx)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('x')
  })

  it('空 points 抛友好错误', () => {
    expect(() => parseTraceResult('{"points":[]}', validIdx)).toThrow('AI 返回内容为空')
  })
})
