/**
 * AI 预拆解（设计文档 §四 + 决策 D15）：
 * - 整篇：核心观点 / 分论点 / 每段大意 / 结构骨架 候选（一次调用）
 * - 单段：一句话大意起草（拆解上屏「AI 起草」）
 * AI 只产候选；入库一律经人工确认（A3），由调用方决定写法
 */
import type { Article } from '../types'
import { aiChat, extractJson } from './ai'

export interface StudyDraft {
  coreThesis: string
  subTheses: string[]
  paragraphSummaries: { paraIndex: number; summary: string }[]
  skeleton: {
    opening?: string
    bodyLayers: string[]
    transitions?: string[]
    closing?: string
  }
}

const SYSTEM = '你是申论范文精读助手，熟悉人民日报评论员文章的行文结构。只输出 JSON，不要输出任何解释文字。'

/** 整篇预拆解：观点 / 分论点 / 段意 / 骨架候选 */
export async function draftStudy(article: Article, signal?: AbortSignal): Promise<StudyDraft> {
  const paras = (article.content ?? [])
    .map((t, i) => `【第${i}段】${t}`)
    .join('\n')
  const user = `下面是一篇人民日报时评《${article.title}》，请做范文精读预拆解，输出 JSON 对象：
{
  "coreThesis": "核心观点，一两句话",
  "subTheses": ["分论点1", "分论点2", ...],
  "paragraphSummaries": [{"paraIndex": 0, "summary": "该段一句话概括"}, ...],
  "skeleton": {"opening": "开头方式（如何破题）", "bodyLayers": ["主体层次1", ...], "transitions": ["过渡手法"], "closing": "收尾方式"}
}
要求：
- paraIndex 用 0 起始的段序号，与输入的【第N段】编号一致，每段都要有；
- summary 为一句话（20~40 字），不照抄原句；
- subTheses 2~4 条；skeleton.bodyLayers 与分论点层次对应。
文章正文：
${paras}`
  const raw = await aiChat({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
    json: true,
    temperature: 0.3,
    signal,
  })
  const out = extractJson<Partial<StudyDraft>>(raw)
  const count = (article.content ?? []).length
  return {
    coreThesis: typeof out.coreThesis === 'string' ? out.coreThesis.trim() : '',
    subTheses: Array.isArray(out.subTheses)
      ? out.subTheses.filter((s): s is string => typeof s === 'string' && Boolean(s.trim())).map((s) => s.trim())
      : [],
    paragraphSummaries: Array.isArray(out.paragraphSummaries)
      ? out.paragraphSummaries
          .filter((p) => p && Number.isInteger(p.paraIndex) && p.paraIndex >= 0 && p.paraIndex < count && typeof p.summary === 'string' && p.summary.trim())
          .map((p) => ({ paraIndex: p.paraIndex, summary: p.summary.trim() }))
      : [],
    skeleton: {
      opening: typeof out.skeleton?.opening === 'string' ? out.skeleton.opening.trim() : undefined,
      bodyLayers: Array.isArray(out.skeleton?.bodyLayers)
        ? out.skeleton.bodyLayers.filter((s): s is string => typeof s === 'string' && Boolean(s.trim()))
        : [],
      transitions: Array.isArray(out.skeleton?.transitions)
        ? out.skeleton.transitions.filter((s): s is string => typeof s === 'string' && Boolean(s.trim()))
        : undefined,
      closing: typeof out.skeleton?.closing === 'string' ? out.skeleton.closing.trim() : undefined,
    },
  }
}

/** 单段大意起草（拆解上屏「AI 起草」按钮） */
export async function draftParaGist(title: string, paraText: string, signal?: AbortSignal): Promise<string> {
  const raw = await aiChat({
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `给人民日报时评《${title}》的下面这段话写一句大意（20~40 字，不照抄原句）。只输出这句话本身，不要任何前后缀。\n\n${paraText}`,
      },
    ],
    temperature: 0.3,
    maxTokens: 120,
    signal,
  })
  return raw.trim().replace(/^["「『]|["」』]$/g, '')
}
