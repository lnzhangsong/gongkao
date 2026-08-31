import { MATERIAL_EXPORT_ORDER, MATERIAL_TYPE_LABELS } from '../data/material'
import { formatDateTime } from './export'
import type { Annotation, MaterialType } from '../types'

/** 素材合集导出行（由摘录行映射而来） */
export interface MaterialExportRow {
  title: string
  topic: string
  source: string
  text: string
  /** 行内标注（取第一个带 materialType 的） */
  anns: Annotation[]
  notes: Annotation[]
}

function rowMaterialType(r: MaterialExportRow): MaterialType | undefined {
  return r.anns.find((a) => a.materialType)?.materialType
}

/**
 * 申论素材合集导出（Markdown）：按主题分组，类型固定顺序
 * 论点 → 论据 → 金句 → 对策 → 句式（句式条目带「原句 → 模板」两行），未标记素材排最后。
 */
export function buildMaterialMarkdown(rows: MaterialExportRow[]): string {
  const byTopic = new Map<string, MaterialExportRow[]>()
  for (const r of rows) {
    if (!byTopic.has(r.topic)) byTopic.set(r.topic, [])
    byTopic.get(r.topic)!.push(r)
  }

  let md = `# 申论素材合集\n\n> 导出自 读本 READBOOK　·　${formatDateTime(new Date().toISOString())}　·　共 ${rows.length} 条\n`
  for (const [topic, list] of byTopic) {
    md += `\n## ${topic}\n`
    const ordered: MaterialExportRow[] = []
    for (const t of MATERIAL_EXPORT_ORDER) {
      for (const r of list) if (rowMaterialType(r) === t) ordered.push(r)
    }
    for (const r of list) if (!rowMaterialType(r)) ordered.push(r)
    for (const r of ordered) {
      const t = rowMaterialType(r)
      md += `\n### ${t ? `[${MATERIAL_TYPE_LABELS[t]}] ` : ''}${r.title}\n\n`
      md += `> ${r.text.replace(/\n/g, '\n> ')}\n\n`
      md += `—— ${r.source}\n`
      const pattern = r.anns.find((a) => a.pattern)?.pattern
      if (t === 'pattern') md += `\n模板：${pattern || '（待提炼）'}\n`
      for (const n of r.notes) {
        if (n.noteText) md += `\n**笔记**：${n.noteText}\n`
        if ((n.tags ?? []).length > 0) md += `\n${(n.tags ?? []).map((tag) => `#${tag}`).join(' ')}\n`
      }
    }
  }
  return md
}
