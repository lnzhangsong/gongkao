import { describe, expect, it } from 'vite-plus/test'
import { buildTracePrompt, parseTraceResult, POINT_FIELDS } from './aiExamTrace'
import { DERIVE_MODE_HINTS, DERIVE_MODES } from '../stores/examStudyStore'

/** prompt 与字段规格同源（B1）：这一段防的就是「prompt 说一套、解析查一套」的漂移 */
describe('buildTracePrompt', () => {
  const question = { idx: 1, type: '归纳概括', stem: '题干', requirement: '要求', answer: '参考答案' }
  const materials = [{ idx: 1, label: '材料1', content: '材料内容' }]
  const prompt = buildTracePrompt({ question, materials })

  it('JSON 示例的每个字段都取自 POINT_FIELDS（新增字段不可能只进解析不进 prompt）', () => {
    for (const [key, spec] of Object.entries(POINT_FIELDS)) {
      expect(prompt).toContain(`"${key}": ${spec.example}`)
    }
  })

  it('字段要求取自 spec.rule，不再散在 prompt 模板里', () => {
    expect(prompt).toContain(`- ${POINT_FIELDS.sourceIdx.rule}`)
    expect(prompt).toContain(`- ${POINT_FIELDS.locate.rule}`)
    expect(prompt).toContain(`- ${POINT_FIELDS.modeWhy.rule}`)
    expect(prompt).toContain(`- ${POINT_FIELDS.quote.rule}`)
  })

  it('JSON 示例块是合法 JSON，且字段与 POINT_FIELDS 一一对应', () => {
    const start = prompt.indexOf('{')
    let depth = 0
    let block = ''
    for (let i = start; i < prompt.length; i += 1) {
      if (prompt[i] === '{') depth += 1
      else if (prompt[i] === '}') {
        depth -= 1
        if (depth === 0) {
          block = prompt.slice(start, i + 1)
          break
        }
      }
    }
    const parsed = JSON.parse(block) as { points: Record<string, unknown>[] }
    expect(Object.keys(parsed.points[0])).toEqual(Object.keys(POINT_FIELDS))
    /* sourceIdx 曾是裸说明文字（非法 JSON）——这条守住「示例即模型照抄的样子」 */
    expect(typeof parsed.points[0].sourceIdx).toBe('number')
  })

  it('六类加工方式的口诀由枚举与说明生成，prompt 不再手抄一份定义', () => {
    for (const m of DERIVE_MODES) expect(prompt).toContain(`- ${m}——${DERIVE_MODE_HINTS[m]}`)
  })

  it('有答案走溯源、无答案走推导', () => {
    expect(prompt).toContain('逐要点拆解溯源')
    expect(buildTracePrompt({ question: { ...question, answer: null }, materials })).toContain('推导这道题的参考要点')
  })
})

/** AI 溯源返回解析：字段归一（含旧字段别名）+ 规范外取值留痕（B2）+ sourceIdx 范围校验 */
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
    expect(out[0].nonstandard).toBeUndefined()
    expect(out[1].sourceIdx).toBeNull()
    expect(out[1].locate).toBeUndefined()
    expect(out[1].modeWhy).toBeUndefined()
    expect(out[1].nonstandard).toBeUndefined()
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

  it('规范外取值留痕而不是静默改值（B2）：mode 认不出、sourceIdx 越界都记下来', () => {
    const raw = JSON.stringify({
      points: [
        { text: 'a', mode: '瞎写的', sourceIdx: 99 },
        { text: 'b', mode: '改写', sourceIdx: '二' },
        { text: 'c', sourceIdx: 2 },
      ],
    })
    const out = parseTraceResult(raw, validIdx)
    /* 展示与统计仍取合法值，但原值必须能看见 */
    expect(out[0].mode).toBe('归纳')
    expect(out[0].sourceIdx).toBeNull()
    expect(out[0].nonstandard).toEqual([
      { field: 'mode', got: '瞎写的', used: '归纳' },
      { field: 'sourceIdx', got: '99', used: '材料外' },
    ])
    /* 非数字编号同样是「AI 说了个用不了的值」 */
    expect(out[1].nonstandard).toEqual([{ field: 'sourceIdx', got: '二', used: '材料外' }])
    /* 没给编号（材料外）不是异常；mode 缺失走默认也不算异常 */
    expect(out[2].sourceIdx).toBe(2)
    expect(out[2].nonstandard).toBeUndefined()
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
