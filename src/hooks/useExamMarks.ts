import { useMemo, useState } from 'react'
import { alertDialog } from '../components/ui/confirm'
import { draftMaterialMarks } from '../lib/aiExamTrace'
import { collectDistractions, type DistractionGroup } from '../lib/examDistractions'
import { findQuoteInMaterial, type MarkRange } from '../lib/examMarks'
import { linkPointsToMarks, type PointSource } from '../lib/examPointSources'
import { joinParagraphs } from '../lib/examText'
import { useExamStudyStore, type MaterialMark } from '../stores/examStudyStore'
import type { ExamDetail } from '../lib/api'

/**
 * 行文思路标注：全卷/单则材料的 AI 生成、原文标注区间匹配、行文脉络导图数据。
 * 「行文思路」开关打开时高亮 + 每句下方内联展示思路卡（顺材料读，不用开抽屉）；
 * 引句做空白不敏感匹配（AI 返回的 quote 可能与正文空白有差异），匹配不到的跳过。
 */
export function useExamMarks(draft: ExamDetail | null, inlineMarks: boolean, aiConfigured: boolean) {
  const setMarks = useExamStudyStore((st) => st.setMarks)
  const removeMaterialMarks = useExamStudyStore((st) => st.removeMaterialMarks)
  const allMarks = useExamStudyStore((s) => s.marks)
  const allTraces = useExamStudyStore((s) => s.traces)

  /* 该材料在任意层级（题目级/材料级）有标注 → 按钮显示「重新生成」 */
  const matHasMarks = useMemo(() => {
    const set = new Set<number>()
    if (!draft) return set
    for (const rec of Object.values(allMarks)) {
      if (rec.paperId !== draft.id) continue
      for (const m of rec.marks ?? []) set.add(m.matIdx)
    }
    return set
  }, [draft, allMarks])

  /* 一键生成全卷行文思路：跳过已有标注的题，逐题生成并直接入库（新增性写入，不覆盖手填） */
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null)
  const [genError, setGenError] = useState('')
  const [matGenIdx, setMatGenIdx] = useState<number | null>(null)

  /* 材料行文思路导图：弹窗展示该材料标注串成的脉络链，记录材料 idx */
  const [flowModalIdx, setFlowModalIdx] = useState<number | null>(null)

  /* 各材料的标注按原文出现顺序排好（导图节点顺序 = 材料推进顺序） */
  const flowByMat = useMemo(() => {
    const tmp = new Map<number, { mark: MaterialMark; order: number }[]>()
    const map = new Map<number, MaterialMark[]>()
    if (!draft) return map
    for (const record of Object.values(allMarks)) {
      if (record.paperId !== draft.id) continue
      for (const mark of record.marks ?? []) {
        const mat = draft.materials.find((x) => x.idx === mark.matIdx)
        if (!mat) continue
        const hit = findQuoteInMaterial(joinParagraphs(mat.content), mark.quote)
        const list = tmp.get(mark.matIdx) ?? []
        list.push({ mark, order: hit ? hit.paraIndex * 1e6 + hit.start : Number.MAX_SAFE_INTEGER })
        tmp.set(mark.matIdx, list)
      }
    }
    for (const [k, list] of tmp)
      map.set(
        k,
        list.sort((a, b) => a.order - b.order).map((x) => x.mark),
      )
    return map
  }, [draft, allMarks])

  /** 单则材料生成：忽略具体题目，逐句梳理本则行文脉络；存 qIdx = -材料idx（材料级，不入任何题的解析） */
  const generateMaterialMarks = async (m: { idx: number; label: string; content: string }) => {
    if (!draft || matGenIdx != null) return
    if (!aiConfigured) {
      void alertDialog('尚未配置 AI 服务：请到 设置 → AI 服务 填入接口地址与 API Key')
      return
    }
    setMatGenIdx(m.idx)
    try {
      /* 重新生成语义：先清掉该材料所有层级（题目级 + 材料级）的旧标注 */
      removeMaterialMarks(draft.id, m.idx)
      const stems = draft.questions.map((q) => `${q.idx}.${q.stem.replace(/\s+/g, '').slice(0, 50)}`).join('；')
      const marks = await draftMaterialMarks({
        question: {
          idx: m.idx,
          type: null,
          stem: `通读本则材料，逐句梳理它的行文脉络与关键信息。全卷题目如下（use 里可说明该句服务于哪道题）：${stems}`,
          requirement: '',
          answer: null,
        },
        materials: [m],
      })
      setMarks(draft.id, -m.idx, marks, 'ai')
    } catch (err) {
      void alertDialog(err instanceof Error ? err.message : String(err))
    } finally {
      setMatGenIdx(null)
    }
  }

  const generateAllMarks = async () => {
    if (!draft || genProgress) return
    if (!aiConfigured) {
      void alertDialog('尚未配置 AI 服务：请到 设置 → AI 服务 填入接口地址与 API Key')
      return
    }
    setGenError('')
    const qs = draft.questions.filter((q) => {
      const rec = allMarks[`${draft.id}#${q.idx}`]
      return !rec?.marks?.length
    })
    if (!qs.length) {
      setGenProgress(null)
      return
    }
    setGenProgress({ done: 0, total: qs.length })
    let failed = 0
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i]
      try {
        const marks = await draftMaterialMarks({
          question: { idx: q.idx, type: q.type, stem: q.stem, requirement: q.requirement, answer: q.answer },
          materials: draft.materials,
        })
        setMarks(draft.id, q.idx, marks, 'ai')
      } catch {
        failed++
      }
      setGenProgress({ done: i + 1, total: qs.length })
    }
    setGenProgress(null)
    if (failed) setGenError(`${failed} 题生成失败，可再点一次重试（已有标注的题会跳过）`)
  }

  /* 本卷干扰项（C5）：level = useless 的句子按材料汇总——材料级与题目级两种来源都收 */
  const distractions = useMemo(
    () => (draft ? collectDistractions(draft.id, draft.materials, allMarks) : ([] as DistractionGroup[])),
    [draft, allMarks],
  )

  /* 反向索引（C4）：标注 id → 覆盖这句话的答案要点，句后挂「答案②」小标。
     与 inlineMarks 无关——chip 只挂在句后解析块里，解析块本身由开关控制 */
  const pointSourceByMark = useMemo(
    () => (draft ? linkPointsToMarks(draft.id, allTraces, allMarks) : new Map<string, PointSource[]>()),
    [draft, allTraces, allMarks],
  )

  /* 材料编号 → 标注区间（inlineMarks 关闭 = 完全不渲染，干净原文） */
  const markRangesByMat = useMemo(() => {
    const map = new Map<number, MarkRange[]>()
    if (!draft || !inlineMarks) return map
    for (const record of Object.values(allMarks)) {
      if (record.paperId !== draft.id) continue
      for (const mark of record.marks ?? []) {
        const mat = draft.materials.find((x) => x.idx === mark.matIdx)
        if (!mat) continue
        const hit = findQuoteInMaterial(joinParagraphs(mat.content), mark.quote)
        if (!hit) continue
        const list = map.get(mark.matIdx) ?? []
        list.push({ mark, ...hit })
        map.set(mark.matIdx, list)
      }
    }
    return map
  }, [draft, allMarks, inlineMarks])

  return {
    matHasMarks,
    genProgress,
    genError,
    matGenIdx,
    flowModalIdx,
    setFlowModalIdx,
    flowByMat,
    distractions,
    markRangesByMat,
    pointSourceByMark,
    generateMaterialMarks,
    generateAllMarks,
  }
}
