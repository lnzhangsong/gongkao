/**
 * AI-1/AI-2：审题立意 + 按题型作答框架 + 素材联动（申论写作AI辅助设计方案 §二/§三）。
 * - 素材在客户端收集：按主题筛选 annotationStore 的素材标注，编号后进 prompt（决策 A4：不做向量检索）
 * - AI 返回 { stance, points:[{ text, materials:[编号] }] }，前端把编号映射回素材标注 id
 */
import type { Annotation, ArticleTopic } from '../types'
import type { QuestionType } from '../stores/aiAssistStore'
import { MATERIAL_TYPE_LABELS } from '../data/material'
import { aiChat, extractJson } from './ai'

/** 候选素材：收集自 annotationStore（materialType 高亮），主题/关键词过滤在页面层完成 */
export interface MaterialCandidate {
  annotation: Annotation
  /** 来源文章标题（展示与 prompt 说明用） */
  articleTitle: string
  articleTopic?: ArticleTopic
}

const MAX_MATERIALS = 60
const MATERIAL_SNIPPET_LEN = 60

/** 按题型给 AI 的作答框架形态说明（§三 表格） */
const TYPE_RULES: Record<QuestionType, string> = {
  概括: '概括题（≤200 字）：输出 4~6 条要点清单，每条=归纳维度+一句话，全面覆盖材料信息，不评价不引申',
  分析: '分析题（≤300 字）：输出 3~4 条层次分析，沿「是什么→为什么→怎么办」拆解线组织',
  对策: '对策题（≤450 字）：输出 3~5 条对策，每条=主体+做法+目的的结构化表述',
  应用文: '应用文（≤500 字）：输出格式结构说明（文种格式）+ 4~6 条内容模块提纲',
  大作文: '大作文（1000~1200 字）：先给 2~3 个立意方向放进 stance，再输出总论点+3 个分论点；每个分论点=一句话观点+论证角度',
}

export interface FrameworkDraft {
  stance: string
  points: { text: string; materialIds: string[] }[]
}

/** 组装 prompt 用素材清单文本；返回编号→标注映射供结果解析 */
export function buildMaterialIndex(materials: MaterialCandidate[]): {
  lines: string[]
  byIdx: Map<number, MaterialCandidate>
} {
  const byIdx = new Map<number, MaterialCandidate>()
  const lines: string[] = []
  materials.slice(0, MAX_MATERIALS).forEach((m, i) => {
    const mt = m.annotation.materialType
    if (!mt) return
    byIdx.set(i, m)
    const text = m.annotation.text.replace(/\s+/g, '').slice(0, MATERIAL_SNIPPET_LEN)
    const pattern = mt === 'pattern' && m.annotation.pattern ? `（模板：${m.annotation.pattern}）` : ''
    lines.push(`[${i}]（${MATERIAL_TYPE_LABELS[mt]}·《${m.articleTitle}》）${text}…${pattern}`)
  })
  return { lines, byIdx }
}

/** 审题立意 + 作答框架生成 */
export async function draftFramework(opts: {
  question: string
  questionType: QuestionType
  topic?: ArticleTopic
  materials: MaterialCandidate[]
  signal?: AbortSignal
}): Promise<FrameworkDraft> {
  const { lines, byIdx } = buildMaterialIndex(opts.materials)
  const materialBlock = lines.length
    ? `\n\n以下是你的素材库中可用的素材卡片（编号在行首方括号里）：\n${lines.join('\n')}\n框架中每个要点从上面挑 0~3 条最相关的素材，把编号写进该要点的 materials 数组。没有合适的就给空数组，不要硬凑。`
    : '\n\n（素材库暂无相关素材，materials 一律给空数组。）'

  const user = `你是一名申论辅导老师。请对下面的题目做审题并给出作答框架。

【题目】${opts.question}
【题型】${opts.questionType}${opts.topic ? `\n【主题】${opts.topic}` : ''}

要求：${TYPE_RULES[opts.questionType]}
输出 JSON：{"stance":"审题立意：题干关键信息、作答方向与结构策略，2~3 句话","points":[{"text":"要点/分论点正文","materials":[素材编号]}]}
不要输出整篇文章，只输出结构化清单。${materialBlock}`

  const raw = await aiChat({
    messages: [
      { role: 'system', content: '你是申论辅导老师，熟悉公务员考试申论五类题型的作答规范。只输出 JSON，不要任何解释文字。' },
      { role: 'user', content: user },
    ],
    json: true,
    temperature: 0.4,
    signal: opts.signal,
  })
  const out = extractJson<{
    stance?: unknown
    points?: { text?: unknown; materials?: unknown }[]
  }>(raw)

  const stance = typeof out.stance === 'string' ? out.stance.trim() : ''
  const points = (Array.isArray(out.points) ? out.points : [])
    .filter((p) => p && typeof p.text === 'string' && p.text.trim())
    .map((p) => {
      const ids = (Array.isArray(p.materials) ? p.materials : [])
        .map((n) => byIdx.get(Number(n))?.annotation.id)
        .filter((x): x is string => Boolean(x))
      return { text: (p.text as string).trim(), materialIds: [...new Set(ids)] }
    })
  if (!stance && points.length === 0) throw new Error('AI 返回内容为空')
  return { stance, points }
}
