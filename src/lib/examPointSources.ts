import type { MaterialMark, QuestionMarks, QuestionTrace } from '../stores/examStudyStore'

/** 一条要点的来源锚点：它来自哪则材料的哪句话、最终是答案第几条 */
export interface PointSource {
  /** 要点所属题目序号（同一句原文可能同时服务多道题） */
  questionIdx: number
  /** 要点在本题里的序号（从 1 起，与卡片编号一致） */
  pointNo: number
  pointId: string
  /** 要点句（chip 悬停时显示） */
  text: string
}

const collapse = (s: string) => s.replace(/\s+/g, '')

/**
 * 材料 → 要点的反向索引（C4）：把「这句话最后变成了答案第几条」挂到覆盖它的那条标注上。
 *
 * 此前只有单向跳转（要点卡 → 材料锚点），读者在材料里读到一句关键话，无从知道它进了答案没有。
 *
 * 匹配口径：标注是句级的、要点的 `quote` 可能只是句子的一个片段，所以「任一方向包含」都算命中；
 * 但一条要点只挂到**最贴合**的那条标注上——否则一条跨两句的引句会在正文里出现两个相同编号。
 * 精确相等 > 标注包含引句 > 引句包含标注（取更长者），同分取先出现者。
 *
 * 两种标注来源（材料级 `qIdx = -材料idx` 与题目级 `qIdx = 题号`）一视同仁，别卷记录忽略。
 */
export function linkPointsToMarks(
  paperId: string,
  traces: Record<string, QuestionTrace>,
  marks: Record<string, QuestionMarks>,
): Map<string, PointSource[]> {
  const marksByMat = new Map<number, MaterialMark[]>()
  for (const rec of Object.values(marks)) {
    if (!rec || rec.paperId !== paperId) continue
    for (const m of rec.marks ?? []) {
      const list = marksByMat.get(m.matIdx) ?? []
      list.push(m)
      marksByMat.set(m.matIdx, list)
    }
  }

  const out = new Map<string, PointSource[]>()
  const paperTraces = Object.values(traces)
    .filter((t) => t && t.paperId === paperId)
    .sort((a, b) => a.qIdx - b.qIdx)
  for (const t of paperTraces) {
    t.points.forEach((p, i) => {
      if (p.sourceIdx == null || !p.quote) return
      const quote = collapse(p.quote)
      if (!quote) return
      let bestId = ''
      let bestScore = 0
      for (const m of marksByMat.get(p.sourceIdx) ?? []) {
        const mq = collapse(m.quote)
        if (!mq) continue
        const score =
          mq === quote
            ? Number.MAX_SAFE_INTEGER
            : mq.includes(quote)
              ? quote.length
              : quote.includes(mq)
                ? mq.length
                : 0
        if (score > bestScore) {
          bestScore = score
          bestId = m.id
        }
      }
      if (!bestId) return
      const list = out.get(bestId) ?? []
      list.push({ questionIdx: t.qIdx, pointNo: i + 1, pointId: p.id, text: p.text })
      out.set(bestId, list)
    })
  }
  return out
}

/** 同一句原文变出多条要点（C3 小改）：要点 id → 同源的其它要点序号 */
export function sameSourceSiblings(
  points: { id: string; sourceIdx: number | null; quote?: string }[],
): Map<string, number[]> {
  const byKey = new Map<string, { id: string; no: number }[]>()
  points.forEach((p, i) => {
    if (p.sourceIdx == null || !p.quote) return
    const quote = collapse(p.quote)
    if (!quote) return
    const key = `${p.sourceIdx}::${quote}`
    byKey.set(key, [...(byKey.get(key) ?? []), { id: p.id, no: i + 1 }])
  })
  const out = new Map<string, number[]>()
  for (const list of byKey.values()) {
    if (list.length < 2) continue
    for (const item of list)
      out.set(
        item.id,
        list.filter((x) => x.id !== item.id).map((x) => x.no),
      )
  }
  return out
}
