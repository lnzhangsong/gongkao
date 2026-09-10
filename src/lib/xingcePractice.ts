import type { XingceQuestion } from './api'

/**
 * 行测答题页的纯计算（分栏、整组小结、时长格式）。
 * 抽出来是为了可测：分栏阈值与得分汇总都属于「改错了不易察觉」的逻辑。
 */

/** 全角 / CJK 字符：占两个西文字符的视觉宽度 */
const WIDE_CHAR =
  /[\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/

/**
 * 文本的视觉宽度：全角/CJK 记 2，其余记 1。
 * 直接用 `text.length` 会在中英混排时低估中文占位，导致分栏选得偏密。
 */
export function visualWidth(text: string): number {
  let w = 0
  for (const ch of text) w += WIDE_CHAR.test(ch) ? 2 : 1
  return w
}

/* 阈值按视觉宽度定：纯中文时宽度≈2×字数，故 12 / 36 等价于原来的 6 / 18 字数阈值，
   既有观感不变，同时修正中英混排的误判 */
const FOUR_COL_MAX_WIDTH = 12
const TWO_COL_MAX_WIDTH = 36

/** 选项分栏：按**本题**选项的最大视觉宽度决定 4 / 2 / 1 列（逐题判断，长短混排不互相牵连） */
export function optionCols(questions: XingceQuestion[]): 1 | 2 | 4 {
  const maxWidth = Math.max(0, ...questions.flatMap((q) => q.options).map((o) => visualWidth(o.text)))
  if (maxWidth <= FOUR_COL_MAX_WIDTH) return 4
  if (maxWidth <= TWO_COL_MAX_WIDTH) return 2
  return 1
}

export interface GroupScore {
  /** 答对题数 */
  right: number
  /** 已判分题数 */
  graded: number
  /** 本组可判分题数（answer 非空的题） */
  total: number
  /** 已判分题累计用时（秒） */
  seconds: number
}

/**
 * 整组得分小结。无答案的题不计入 total（它们提交时也不判分）。
 * 用时取每题记录里的 seconds 之和——避免在渲染期读时钟。
 */
export function groupScore(
  questions: XingceQuestion[],
  answerOf: (qIdx: number) => { correct: boolean; seconds?: number } | undefined,
): GroupScore {
  let right = 0
  let graded = 0
  let total = 0
  let seconds = 0
  for (const q of questions) {
    if (q.answer == null) continue
    total += 1
    const a = answerOf(q.idx)
    if (!a) continue
    graded += 1
    seconds += a.seconds ?? 0
    if (a.correct) right += 1
  }
  return { right, graded, total, seconds }
}

/** 用时展示：不足 1 分钟显示 `Ns`，否则 `M:SS` */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** 整题截图题的占位题干：流水线未能拆出题干文本时的回填值（xingce-images.py） */
const IMG_STEM_PLACEHOLDER = /^第\d+题（见配图）$/

/**
 * 是否渲染文本题干。截图题的题干已由流水线拆成文本（图里只剩图形区），照常渲染；
 * 只有数据仍是「第N题（见配图）」占位符（旧数据 / 矢量图形兜底）时才不重复显示。
 */
export function showTextStem(stem: string): boolean {
  return !!stem && !IMG_STEM_PLACEHOLDER.test(stem)
}

/** 条件句行首标记：半/全角括号包 1-2 位数字或中文序号，以及带圈数字 */
const COND_MARK_RE = /[（(]([0-9]{1,2}|[一二三四五六七八九十])[)）]|[①②③④⑤⑥⑦⑧⑨]/g
const CIRCLED = '①②③④⑤⑥⑦⑧⑨'

function condMarkNum(s: string): number | null {
  const circled = CIRCLED.indexOf(s)
  if (circled >= 0) return circled + 1
  if (/^\d{1,2}$/.test(s)) return Number(s)
  const cn = '一二三四五六七八九十'.indexOf(s)
  return cn < 0 ? null : cn + 1
}

/**
 * 题组材料里的「已知：(1)…；(2)…；(3)…」拆成每行一条，逻辑题逐条列条件更好读。
 * 只在编号自 1 起恰好连续且 ≥2 个时拆；普通括号数字（如「(3) 支队伍」孤例）不拆。
 */
export function splitConditionLines(text: string): string[] {
  const marks = [...text.matchAll(COND_MARK_RE)]
    .map((m) => ({ i: m.index ?? 0, n: condMarkNum(m[0].replace(/[（(]/, '').replace(/[)）]/, '')) }))
    .filter((m) => m.n != null)
  if (marks.length < 2 || marks.some((m, j) => m.n !== j + 1)) return [text]
  const lines: string[] = []
  for (let j = 0; j < marks.length; j++) {
    lines.push(text.slice(marks[j].i, marks[j + 1]?.i ?? text.length).trim())
  }
  const head = text.slice(0, marks[0].i).trim()
  return head ? [head, ...lines] : lines
}
