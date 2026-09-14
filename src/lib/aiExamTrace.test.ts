import { describe, expect, it } from 'vite-plus/test'
import { parseTraceResult } from './aiExamTrace'

/** AI 溯源返回解析：字段归一（含旧字段别名）+ mode 枚举容错 + sourceIdx 范围校验（越界/非数字 → null 材料外） */
describe('parseTraceResult', () => {
  const validIdx = [1, 2, 3]

  it('解析正常返回并补 id', () => {
    const raw = JSON.stringify({
      points: [
        {
          text: '监测感知网络是基础',
          mode: '摘抄',
          sourceIdx: 1,
          locate: '题干问「如何保障」→ 对策题先找对策段 → 按「建设」类动词锁定',
          quote: '构建智能高效的监测感知网络',
          modeWhy: '原文即为规范短语，与答案表述一致，故为摘抄',
        },
        { text: '数据标注门槛提高', mode: '推理', sourceIdx: null },
      ],
    })
    const out = parseTraceResult(raw, validIdx)
    expect(out).toHaveLength(2)
    expect(out[0].id).toBeTruthy()
    expect(out[0].mode).toBe('摘抄')
    expect(out[0].sourceIdx).toBe(1)
    expect(out[0].locate).toContain('题干问')
    expect(out[0].quote).toBe('构建智能高效的监测感知网络')
    expect(out[0].modeWhy).toContain('摘抄')
    expect(out[1].sourceIdx).toBeNull()
    expect(out[1].locate).toBeUndefined()
    expect(out[1].modeWhy).toBeUndefined()
  })

  it('旧字段别名 think / note 归并进 locate / modeWhy（新字段优先）', () => {
    const raw = JSON.stringify({
      points: [
        { text: 'a', mode: '摘抄', sourceIdx: 1, think: '旧思路', note: '旧加工说明' },
        { text: 'b', mode: '改写', sourceIdx: 2, think: '旧思路', locate: '新定位', note: '旧说明', modeWhy: '新判断' },
      ],
    })
    const out = parseTraceResult(raw, validIdx)
    expect(out[0].locate).toBe('旧思路')
    expect(out[0].modeWhy).toBe('旧加工说明')
    expect(out[0]).not.toHaveProperty('think')
    expect(out[0]).not.toHaveProperty('note')
    expect(out[1].locate).toBe('新定位')
    expect(out[1].modeWhy).toBe('新判断')
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
    const fenced =
      '解析如下：\n```json\n{"points":[{"text":"x","mode":"提升","sourceIdx":3},{"text":"","mode":"摘抄","sourceIdx":1}]}\n```'
    const out = parseTraceResult(fenced, validIdx)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('x')
  })

  it('空 points 抛友好错误', () => {
    expect(() => parseTraceResult('{"points":[]}', validIdx)).toThrow('AI 返回内容为空')
  })
})
