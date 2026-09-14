import { describe, expect, it } from 'vite-plus/test'
import { isStandard, renderFieldRules, renderFieldsExample, type FieldSpec } from './aiFieldSpec'

/** 字段规格：prompt 示例 / 要求 / 校验同源（B1）+ 规范外取值判定（B2） */
describe('aiFieldSpec', () => {
  const FIELDS: Record<string, FieldSpec> = {
    text: { example: '"要点句"', required: true },
    mode: { example: '"摘抄|改写"', values: ['摘抄', '改写'], fallback: '归纳' },
    sourceIdx: { example: '材料编号', material: true, fallback: null, rule: 'sourceIdx 必须取自材料编号' },
  }
  const ctx = { validIdx: new Set([1, 2]) }

  it('renderFieldsExample 按声明顺序渲染，缩进可调', () => {
    expect(renderFieldsExample(FIELDS)).toBe(
      '      "text": "要点句",\n      "mode": "摘抄|改写",\n      "sourceIdx": 材料编号',
    )
    expect(renderFieldsExample(FIELDS, '  ')).toContain('\n  "mode"')
  })

  it('renderFieldRules 只取声明了 rule 的字段', () => {
    expect(renderFieldRules(FIELDS)).toBe('- sourceIdx 必须取自材料编号')
  })

  it('isStandard：枚举认白名单，材料编号认白名单，无约束字段一律通过', () => {
    expect(isStandard(FIELDS.mode, '摘抄', ctx)).toBe(true)
    expect(isStandard(FIELDS.mode, '瞎写的', ctx)).toBe(false)
    expect(isStandard(FIELDS.mode, 3, ctx)).toBe(false)
    expect(isStandard(FIELDS.sourceIdx, 2, ctx)).toBe(true)
    expect(isStandard(FIELDS.sourceIdx, 99, ctx)).toBe(false)
    expect(isStandard(FIELDS.sourceIdx, null, ctx)).toBe(false)
    expect(isStandard(FIELDS.text, undefined, ctx)).toBe(true)
  })
})
