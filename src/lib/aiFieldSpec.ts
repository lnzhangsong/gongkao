/**
 * AI 输出字段规格（B1）：一份声明同时生成 prompt 的 JSON 示例、填写要求与解析校验。
 *
 * 此前「AI 该返回什么」写了两遍——prompt 里一段手写 JSON 示例、解析里一套手写检查——
 * 两处必然漂移，且已经漂过：AI 会返回 `think`，而 prompt 从未要求过它（该字段在 A1 已合并）。
 * 现在字段的示例值、填写要求、枚举白名单、材料编号白名单都从同一个 FieldSpec 里取。
 */

/** 解析上下文：材料编号白名单（sourceIdx / matIdx 越界判定） */
export interface FieldCtx {
  validIdx: Set<number>
}

export interface FieldSpec {
  /** JSON 示例里的字面量，原样进 prompt（含引号） */
  example: string
  /** 填写要求，进 prompt「要求」列表；无则该字段不产生要求条目 */
  rule?: string
  /** 枚举白名单：取值不在此列即为「非标准值」，由调用方记录而非静默改写（B2） */
  values?: readonly string[]
  /** 材料编号字段：取值须落在 ctx.validIdx 内，否则为「非标准值」（B2） */
  material?: boolean
  /** 缺省回退值：非标准时实际采用的值（展示与统计都按它算） */
  fallback?: string | number | null
  /** 必填：取不到值则整条丢弃 */
  required?: boolean
}

/** 渲染 JSON 示例的字段行（顺序即声明顺序），供 prompt 直接嵌入 */
export function renderFieldsExample(fields: Record<string, FieldSpec>, indent = '      '): string {
  return Object.entries(fields)
    .map(([key, spec]) => `${indent}"${key}": ${spec.example}`)
    .join(',\n')
}

/** 渲染 prompt「要求」列表：只取声明了 rule 的字段，每条一行 */
export function renderFieldRules(fields: Record<string, FieldSpec>): string {
  return Object.entries(fields)
    .filter(([, spec]) => Boolean(spec.rule))
    .map(([, spec]) => `- ${spec.rule as string}`)
    .join('\n')
}

/** 字段值是否属于该规格的规范取值（枚举 / 材料编号）；未声明约束的字段一律通过 */
export function isStandard(spec: FieldSpec, value: unknown, ctx: FieldCtx): boolean {
  if (spec.values) return typeof value === 'string' && spec.values.includes(value)
  if (spec.material) return typeof value === 'number' && Number.isFinite(value) && ctx.validIdx.has(value)
  return true
}

/** 把 AI 返回的任意取值渲染成可展示的字符串（数组/对象走 JSON，避免「[object Object]」） */
export function showValue(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v) ?? ''
}
