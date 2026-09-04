/**
 * AI 答案溯源（申论方法论与答案溯源设计方案 §4.2，M1）：
 * 把真题参考答案逐要点拆开——每条要点标注「从材料哪句话来、经过了什么加工」。
 * 输入 = 题干 + 要求 + 参考答案 + 相关材料全文（客户端组装，AI-4 同款基础设施）；
 * 输出走 extractJson 容错解析，mode / sourceIdx 做枚举与范围校验；
 * 产出一律先进页面草稿态，人工确认后才写入 examStudyStore（A3 不变）。
 */
import { DERIVE_MODES, MARK_LEVELS, MARK_ROLES, type AnswerPointTrace, type DeriveMode, type MarkLevel, type MaterialMark } from '../stores/examStudyStore'
import { aiChat, extractJson } from './ai'

export interface TraceExamMaterial {
  idx: number
  label: string
  content: string
}

export interface TraceExamQuestion {
  idx: number
  type: string | null
  stem: string
  requirement: string
  /** 参考答案；null = 无答案题，走「推导」模式（AI 从材料推导参考要点） */
  answer: string | null
}

const MAX_ANSWER_LEN = 2600
const MAX_MATERIAL_LEN = 6000

const SYSTEM =
  '你是申论答案解析专家，擅长把参考答案逐要点回溯到给定材料原文，并判定每个要点经过了什么加工。只输出 JSON，不要输出任何解释文字。'

const MODE_RULES = `mode 从以下六类里选（覆盖「抄材料→半加工→全加工→材料外」谱系）：
- 摘抄：原词原句直接搬用；
- 改写：同义换写，如口语换书面、句式重组；
- 提升：具体现象上纲为规范表达（如「路不好走」→「基础设施薄弱」）；
- 归纳：多个同类信息合并成一条，前置总括词；
- 推理：从材料信息分析推断得出（如由问题反推对策）；
- 补充：材料外的背景、常识、热词。`

/** 拼材料块：带编号与标签，长度截断防撑爆上下文 */
function buildMaterialBlock(materials: TraceExamMaterial[]): string {
  return materials
    .map((m) => `【材料编号 ${m.idx}｜${m.label}】\n${m.content.replace(/\s+/g, ' ').slice(0, MAX_MATERIAL_LEN)}`)
    .join('\n\n')
}

/** AI 溯源/推导：有答案 → 拆解答案来源；无答案 → 从材料推导参考要点。产出同构（草稿，待人工确认） */
export async function draftAnswerTrace(opts: {
  question: TraceExamQuestion
  /** 相关材料（questionMaterials 匹配；为空时调用方应给全卷材料） */
  materials: TraceExamMaterial[]
  signal?: AbortSignal
}): Promise<AnswerPointTrace[]> {
  const q = opts.question
  const materialBlock = buildMaterialBlock(opts.materials)
  /* 无答案题：从「解释已有答案」换成「从材料推导参考要点」，产出结构不变 */
  const task = q.answer
    ? `请把参考答案逐要点拆解溯源：每个要点回答「这段话是怎么来的」。`
    : `本题暂无参考答案。请以命题人视角，从给定材料推导这道题的参考要点：每条要点同时给出「答案话」与它的材料出处、加工方式。`
  const pointsRule = q.answer
    ? `- 拆解覆盖参考答案的全部内容，一般 ${q.type === '大作文' ? '4~8' : '3~8'} 条，顺序与答案一致；
- text 尽量保持原答案表述`
    : `- 要点合起来就是这道题的参考答案，一般 ${q.type === '大作文' ? '4~8' : '3~8'} 条，按作答逻辑排序；
- text 用规范表达写成分条要点（可直接当参考答案用），不要成段成文`
  const user = `下面是一道申论真题和它的给定资料。${task}输出 JSON 对象：
{
  "points": [
    {
      "text": "要点句：参考答案里的一条要点或一层意思",
      "mode": "摘抄|改写|提升|归纳|推理|补充",
      "sourceIdx": 材料编号（数字，取下方【材料编号】的数字；材料外填 null）,
      "locate": "定位方法：可复用的查找步骤——先抓题干哪个关键词/设问方向 → 据此判断去哪类材料找（问题段/对策段/案例段）→ 在材料里按什么信号找到这一处（如高频词、转折词、人物做法）。写成方法论，不粘贴本题具体情况",
      "quote": "支撑这个要点的材料原句（从材料原文里摘，40 字以内；材料外可省略）",
      "modeWhy": "加工判断：为什么这条是这种加工方式而不是别的——对照原文说法与答案表述，指出差距（口语vs书面 / 一处vs多处 / 具体vs规范 / 明说vs可推出），让读者学会下次自己判断",
      "note": "加工说明：原文的什么信息、经过什么加工变成这条要点的话"
    }
  ]
}
${MODE_RULES}
要求：
${pointsRule}；
- locate 是重点：教「怎么定位」——读者拿到另一道题也能照着这个方法找材料，禁止只说“定位到材料X”而不给依据；
- modeWhy 是重点：教「怎么判断加工方式」——必须点出原文表述与答案表述的具体差距（如：原文“路不好走”是具体现象，答案需要规范表达，所以是提升；原文有三处同类描述，答案合成一条，所以是归纳），让读者下次自己会选；
- quote 必须是材料原文的连续片段（可截取），不得改写拼接；找不到出处的要点 sourceIdx 填 null、mode 填「补充」或「推理」；
- note 点明加工路径（例：「材料②『楼道堆物无人管』同义改写为规范表达」）。

【题目】${q.stem}${q.requirement ? `\n要求：${q.requirement}` : ''}${q.type ? `\n题型：${q.type}` : ''}
${q.answer ? `\n【参考答案】\n${q.answer.slice(0, MAX_ANSWER_LEN)}\n` : ''}
【给定资料】
${materialBlock}`
  const raw = await aiChat({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
    json: true,
    temperature: 0.3,
    signal: opts.signal,
  })
  return parseTraceResult(raw, opts.materials.map((m) => m.idx))
}

/** 解析 + 校验 AI 返回：mode 枚举容错、sourceIdx 范围校验（越界/非数字回退 null） */
export function parseTraceResult(raw: string, validIdx: number[]): AnswerPointTrace[] {
  const out = extractJson<{ points?: Partial<AnswerPointTrace>[] }>(raw)
  const idxSet = new Set(validIdx)
  const points = (Array.isArray(out.points) ? out.points : [])
    .map((p): AnswerPointTrace | null => {
      const text = typeof p?.text === 'string' ? p.text.trim() : ''
      if (!text) return null
      const modeRaw = typeof p?.mode === 'string' ? p.mode.trim() : ''
      const mode = (DERIVE_MODES as readonly string[]).includes(modeRaw) ? (modeRaw as DeriveMode) : '归纳'
      const idxRaw = typeof p?.sourceIdx === 'number' ? p.sourceIdx : parseInt(String(p?.sourceIdx ?? ''), 10)
      const sourceIdx = Number.isFinite(idxRaw) && idxSet.has(idxRaw) ? idxRaw : null
      return {
        id: `t${Math.random().toString(36).slice(2, 10)}`,
        text,
        mode,
        sourceIdx,
        think: typeof p?.think === 'string' && p.think.trim() ? p.think.trim() : undefined,
        locate: typeof p?.locate === 'string' && p.locate.trim() ? p.locate.trim() : undefined,
        quote: typeof p?.quote === 'string' && p.quote.trim() ? p.quote.trim() : undefined,
        note: typeof p?.note === 'string' && p.note.trim() ? p.note.trim() : undefined,
        modeWhy: typeof p?.modeWhy === 'string' && p.modeWhy.trim() ? p.modeWhy.trim() : undefined,
      }
    })
    .filter((p): p is AnswerPointTrace => p !== null)
  if (!points.length) throw new Error('AI 返回内容为空')
  return points
}

/* ---------------- 原文标注：重要句 + 行文思路 + 答题思路 ---------------- */

const MARKS_SYSTEM =
  '你是申论材料分析专家，擅长从设问出发圈出材料里的关键句，并讲清每句在行文中的作用与对答题的用处。只输出 JSON，不要输出任何解释文字。'

/** AI 标注原文：针对一道题，圈出相关材料里的重要句（行文作用 + 答题用法） */
export async function draftMaterialMarks(opts: {
  question: TraceExamQuestion
  materials: TraceExamMaterial[]
  signal?: AbortSignal
}): Promise<MaterialMark[]> {
  const q = opts.question
  const idxSet = new Set(opts.materials.map((m) => m.idx))
  const user = `下面是一道申论题${q.answer ? '和它的参考答案' : ''}，以及给定资料。请从设问出发，圈出材料里的重要句子：输出 JSON 对象：
{
  "marks": [
    {
      "matIdx": 材料编号（数字，取下方【材料编号】的数字）,
      "quote": "材料原文的重要句（连续片段，10~50 字，不得改写拼接）",
      "level": "core|normal|useless：core=直接服务设问、可提炼得分点的句子；normal=背景/结构/辅助理解的句子；useless=与本题设问无关、答题时可以完全忽略的句子",
      "role": "行文作用，必须从这些值里选一个：${MARK_ROLES.join(' / ')}",
      "use": "答题思路：每句必填——对回答这道题的用处（服务哪个设问/要点、怎么用进答案）"
    }
  ]
}
要求：
- **逐句覆盖，一条不落**：把给定资料按句号逐句过一遍，材料里的每一个句子都必须有一条对应的 marks（含纯背景、纯过渡、废话句），一般每份材料 10~25 条、合计 30~60 条；数量优先于简洁，绝不允许只挑重点；
- 转折、递进、因果等结构句**必须单独标注**：句中含「但是/然而/却/反而/其实/更/甚至/不仅…而且/因此/因而/同时」等标志词的，逐句标出并把 role 标为 转折/递进/衔接过渡；
- level 三级：core 核心得分句（少量）、normal 辅助句（多数）、useless 无关句（凑字/跑题/与本题设问完全无关的，也要标出来）；
- useless 的句子 use 必填且写明「为什么没用」：它看似相关为何不采、或它只服务于另一道题等；
- use 必填且是重点：每句都要写清「这句怎么用进答案」，让读者明白为什么圈它。${q.answer ? '可对照参考答案反推哪些句子是要点来源。' : ''}
- role/use 都是一两句话，不写空话（禁止「重要」「关键」这类无信息量的词）。

【题目】${q.stem}${q.requirement ? `\n要求：${q.requirement}` : ''}${q.type ? `\n题型：${q.type}` : ''}
${q.answer ? `\n【参考答案】\n${q.answer.slice(0, MAX_ANSWER_LEN)}\n` : ''}
【给定资料】
${buildMaterialBlock(opts.materials)}`
  const raw = await aiChat({
    messages: [
      { role: 'system', content: MARKS_SYSTEM },
      { role: 'user', content: user },
    ],
    json: true,
    temperature: 0.3,
    maxTokens: 8000,
    signal: opts.signal,
  })
  const out = extractJson<{ marks?: { matIdx?: unknown; quote?: unknown; role?: unknown; use?: unknown; level?: unknown }[] }>(raw)
  const marks = (Array.isArray(out.marks) ? out.marks : [])
    .map((m): MaterialMark | null => {
      const quote = typeof m?.quote === 'string' ? m.quote.trim() : ''
      const rawRole = typeof m?.role === 'string' ? m.role.trim() : ''
      if (!quote || !rawRole) return null
      const idxRaw = typeof m?.matIdx === 'number' ? m.matIdx : parseInt(String(m?.matIdx ?? ''), 10)
      const matIdx = Number.isFinite(idxRaw) && idxSet.has(idxRaw) ? idxRaw : opts.materials[0]?.idx
      if (matIdx == null) return null
      const levelRaw = typeof m?.level === 'string' ? m.level.trim().toLowerCase() : ''
      const level: MarkLevel = (MARK_LEVELS as readonly string[]).includes(levelRaw) ? (levelRaw as MarkLevel) : 'normal'
      const roleRaw = rawRole
      /* role 归一化到体系词：AI 常见的近义词映射，认不出则保留原词 */
      const ROLE_ALIAS: Record<string, string> = {
        案例: '案例叙事', 数据: '数据支撑', 权威: '权威观点', 专家观点: '权威观点',
        民众: '民众声音', 群众声音: '民众声音', 问题: '问题呈现', 成绩: '成绩成效',
        对策: '对策做法', 建议: '对策做法', 原因: '原因分析', 意义: '意义影响',
        危害: '危害后果', 背景: '背景铺垫', 转折: '转折', 递进: '递进',
        衔接: '衔接过渡', 过渡: '衔接过渡', 总结: '总结收束', 收束: '总结收束',
        关键词: '高频关键词', 核心概念: '核心概念', 高频词: '高频关键词',
      }
      const role = (MARK_ROLES as readonly string[]).includes(roleRaw)
        ? roleRaw
        : ROLE_ALIAS[roleRaw] ?? Object.entries(ROLE_ALIAS).find(([k]) => roleRaw.includes(k))?.[1] ?? (roleRaw || '衔接过渡')
      return {
        id: `k${Math.random().toString(36).slice(2, 10)}`,
        matIdx,
        quote,
        role,
        /* 每句必有解释：AI 漏填 use 时按辅助句兜底 */
        use: typeof m?.use === 'string' && m.use.trim() ? m.use.trim() : '辅助句：帮助理解材料脉络，一般不直接进答案',
        level,
      }
    })
    .filter((m): m is MaterialMark => m !== null)
  if (!marks.length) throw new Error('AI 返回内容为空')
  return marks
}
