/**
 * AI-4 / AI-4+：反向链路「素材 → 申论题目」（申论写作AI辅助设计方案 §五）：
 * - L1 命题角度联想（inferExamCandidates）：从一篇文章联想到可能的考点与题干候选 + 适配理由
 * - L2 完整出题（draftFullExam）：按真题格式生成完整题目——给定资料（以本文为底本改写）
 *   + 作答要求 + AI 参考要点（不是批改，A1 不变，仅供成文后对照方向）
 * 与 AI-1/AI-3 共用同一条基础设施（BYOK + Function 纯转发 + 客户端组装），仅 prompt 不同；
 * 产出一律走「生成 → 人工确认 → 入库」。
 */
import type { Article } from '../types'
import type { QuestionType } from '../stores/aiAssistStore'
import { aiChat, extractJson } from './ai'

const MAX_PARAS = 40
const PARA_LEN = 220

/** 截取正文进 prompt：段数与段长都设上限，避免超长文章撑爆上下文 */
function buildArticleBlock(article: Article): string {
  const paras = (article.content ?? []).slice(0, MAX_PARAS).map((t, i) => `【第${i}段】${t.slice(0, PARA_LEN)}`)
  return `《${article.title}》${article.topic ? `（主题：${article.topic}）` : ''}\n${paras.join('\n')}`
}

const SYSTEM =
  '你是申论命题研究助手，熟悉国考/省考申论五类题型（概括、分析、对策、应用文、大作文）的命题规范。只输出 JSON，不要输出任何解释文字。'

/* ---------------- L1：命题角度联想 ---------------- */

export interface ExamCandidate {
  questionType: QuestionType
  /** 题干候选（可直接存为题目记录进入正向框架流程） */
  question: string
  /** 适配理由：这篇文章为什么适合出这类题（结构特征） */
  reason: string
}

export interface InferExamResult {
  /** 主题词 / 命题方向 */
  theme: string
  /** 考点标签 / 可提炼的规范表达 */
  tags: string[]
  candidates: ExamCandidate[]
}

const VALID_TYPES: QuestionType[] = ['概括', '分析', '对策', '应用文', '大作文']

/** 反向联想：文章 → 五类题型的命题角度候选 */
export async function inferExamCandidates(article: Article, signal?: AbortSignal): Promise<InferExamResult> {
  const user = `下面是一篇人民日报时评，请从申论命题的角度做反向联想：如果命题人拿这篇文章出题，可能怎么出。输出 JSON 对象：
{
  "theme": "本篇最可能的命题主题词（如「基层治理」「文化自信」）",
  "tags": ["可提炼的考点标签或规范表达", ...],
  "candidates": [
    {"questionType": "概括|分析|对策|应用文|大作文", "question": "完整题干，含材料指向与字数要求", "reason": "适配理由：文章哪个结构特征适合这类题"}
  ]
}
要求：
- 五类题型各给 1~2 条，共 5~8 条；题干写成真题口吻（例：对策题「针对文中反映的 X 问题提出解决建议，不超过 450 字」；大作文「以『……』为题/自拟题目，写一篇议论文，1000~1200 字」）；
- reason 一句话，点明结构依据（有对策段 / 有案例 / 观点鲜明等）；
- tags 3~6 个。
文章全文：
${buildArticleBlock(article)}`
  const raw = await aiChat({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
    json: true,
    temperature: 0.5,
    signal,
  })
  const out = extractJson<{
    theme?: unknown
    tags?: unknown
    candidates?: { questionType?: unknown; question?: unknown; reason?: unknown }[]
  }>(raw)
  const candidates = (Array.isArray(out.candidates) ? out.candidates : [])
    .map((c) => ({
      questionType: VALID_TYPES.includes(c.questionType as QuestionType) ? (c.questionType as QuestionType) : '大作文',
      question: typeof c.question === 'string' ? c.question.trim() : '',
      reason: typeof c.reason === 'string' ? c.reason.trim() : '',
    }))
    .filter((c) => c.question)
  if (!candidates.length) throw new Error('AI 返回内容为空')
  return {
    theme: typeof out.theme === 'string' ? out.theme.trim() : '',
    tags: Array.isArray(out.tags)
      ? out.tags.filter((t): t is string => typeof t === 'string' && Boolean(t.trim())).map((t) => t.trim())
      : [],
    candidates,
  }
}

/* ---------------- L2：完整出题（真题格式） ---------------- */

export interface FullExamDraft {
  question: string
  questionType: QuestionType
  /** 给定资料：以本文为底本改写的案例材料 */
  givenMaterial: string
  /** 作答要求（含字数等） */
  requirements: string
  /** AI 参考要点（不是批改，仅供成文后对照方向） */
  referencePoints: string[]
}

/** 完整出题：文章为底本生成一道完整题目 */
export async function draftFullExam(opts: {
  article: Article
  question: string
  questionType: QuestionType
  signal?: AbortSignal
}): Promise<FullExamDraft> {
  const typeRule: Record<QuestionType, string> = {
    概括: '概括题：作答要求为「概括给定资料的主要内容/问题，不超过 200 字」',
    分析: '分析题：作答要求为「分析给定资料中某现象/观点的原因或内涵，不超过 300 字」',
    对策: '对策题：作答要求为「针对给定资料反映的问题提出解决建议，不超过 450 字」',
    应用文: '应用文：作答要求为「以指定文种写一篇短文（如倡议书/汇报提纲），不超过 500 字」',
    大作文: '大作文：作答要求为「结合给定资料，以题干话题写一篇议论文，1000~1200 字」',
  }
  const user = `下面是一篇人民日报时评。请以它为底本，按国考申论真题格式出一道完整题目。输出 JSON 对象：
{
  "question": "题干（可采用：${opts.question}，但把字数、文体等要求从题干里剥离干净，题干只保留设问本身）",
  "questionType": "${opts.questionType}",
  "givenMaterial": "给定资料：以本文为底本改写成申论案例材料风格（可整合、转述原文信息），600~900 字，一段成文",
  "requirements": "作答要求：字数、文体、作答任务等，真题口吻。参考：${typeRule[opts.questionType]}",
  "referencePoints": ["AI 参考要点1", ...]
}
要求：
- referencePoints 4~6 条，是作答方向提示（不是批改，不是范文），供考生成文后对照；
- givenMaterial 必须忠于原文信息，只做申论材料化的改写，不得虚构事实。
文章全文：
${buildArticleBlock(opts.article)}`
  const raw = await aiChat({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
    json: true,
    temperature: 0.4,
    signal: opts.signal,
  })
  const out = extractJson<{
    question?: unknown
    givenMaterial?: unknown
    requirements?: unknown
    referencePoints?: unknown
  }>(raw)
  const givenMaterial = typeof out.givenMaterial === 'string' ? out.givenMaterial.trim() : ''
  if (!givenMaterial) throw new Error('AI 未返回给定资料')
  return {
    question: typeof out.question === 'string' && out.question.trim() ? out.question.trim() : opts.question,
    questionType: opts.questionType,
    givenMaterial,
    requirements: typeof out.requirements === 'string' ? out.requirements.trim() : '',
    referencePoints: Array.isArray(out.referencePoints)
      ? out.referencePoints.filter((p): p is string => typeof p === 'string' && Boolean(p.trim())).map((p) => p.trim())
      : [],
  }
}
