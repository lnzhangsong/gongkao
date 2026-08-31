import type { HighlightColor, MaterialType } from '../types'

/** 素材类型常量与文案（决策 D15：固定 5 类） */
export const MATERIAL_TYPES = ['thesis', 'evidence', 'quote', 'measure', 'pattern'] as const

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  thesis: '论点',
  evidence: '论据',
  quote: '金句',
  measure: '对策',
  pattern: '句式',
}

/** 各类型默认高亮色（复用 hl-* 色板；句式为 D15 新增暖橙） */
export const MATERIAL_TYPE_COLORS: Record<MaterialType, HighlightColor> = {
  thesis: 'blue',
  evidence: 'violet',
  quote: 'yellow',
  measure: 'green',
  pattern: 'orange',
}

/** 各类型一句话说明（工具栏 title / 摘录徽标悬停提示） */
export const MATERIAL_TYPE_HINTS: Record<MaterialType, string> = {
  thesis: '核心观点 / 段旨句',
  evidence: '政策依据 / 理论支撑',
  quote: '可背记的句子',
  measure: '可借鉴的措施',
  pattern: '可迁移句式（原句 + 模板）',
}

/** Markdown 素材合集导出的固定顺序 */
export const MATERIAL_EXPORT_ORDER: MaterialType[] = [
  'thesis',
  'evidence',
  'quote',
  'measure',
  'pattern',
]
