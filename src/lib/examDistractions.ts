import type { MaterialMark, QuestionMarks } from '../stores/examStudyStore'

/** 一则材料的干扰句分组 */
export interface DistractionGroup {
  matIdx: number
  label: string
  marks: MaterialMark[]
}

/**
 * 本卷干扰项汇总（C5）：把该卷所有标注里 `level = useless` 的句子按材料收拢。
 *
 * 口径定为「本卷」而不是「本题」——标注有两种来源：材料级（材料标题行「生成思路 ✦」，
 * 存 `qIdx = -材料idx`，判定依据是全卷题目合起来看）与题目级（全卷生成，存 `qIdx = 题号`）。
 * 只认「题目级」的话，只用材料级生成过的卷子这里会永远空白，所以两种都收。
 *
 * 同句去重（同一条材料可能在两个层级里各有一份标注）、材料顺序按传入的 materials 顺序、
 * 认不出的材料编号丢弃。
 */
export function collectDistractions(
  paperId: string,
  materials: { idx: number; label?: string }[],
  records: Record<string, QuestionMarks>,
): DistractionGroup[] {
  const byMat = new Map<number, MaterialMark[]>()
  const seen = new Set<string>()
  for (const rec of Object.values(records)) {
    if (!rec || rec.paperId !== paperId) continue
    for (const m of rec.marks ?? []) {
      if (m?.level !== 'useless') continue
      const key = `${m.matIdx}::${m.quote.replace(/\s+/g, '')}`
      if (seen.has(key)) continue
      seen.add(key)
      const list = byMat.get(m.matIdx) ?? []
      list.push(m)
      byMat.set(m.matIdx, list)
    }
  }
  return materials
    .filter((m) => byMat.has(m.idx))
    .map((m) => ({ matIdx: m.idx, label: m.label || `材料${m.idx}`, marks: byMat.get(m.idx) as MaterialMark[] }))
}
