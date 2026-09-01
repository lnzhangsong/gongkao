/**
 * AI 客户端（BYOK + 服务端纯转发，设计文档 §6.1）：
 * - 浏览器只把「用户自己的 baseUrl/apiKey/model + 消息」POST 到同源 /api/ai
 * - 服务端（api/ai.ts、scripts/api-server.mjs）做纯转发，不存任何数据
 * - 上下文（文章正文、素材、拆解记录）一律在客户端组装进 messages
 */
import { useAiStore, isAiConfigured } from '../stores/aiStore'

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiCallOptions {
  messages: AiMessage[]
  /** 期望 JSON 输出：服务端尽量带 response_format，客户端仍需自行解析容错 */
  json?: boolean
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super('尚未配置 AI 服务：请到设置页填写接口地址与 API Key')
  }
}

const TIMEOUT_MS = 120000

/**
 * 找文本里第一个完整 JSON 子串（顶层允许 `{` 或 `[`，括号配平，跳过字符串里的引号/转义）。
 * AI 返回常是「说明文字 + JSON + 杂音」或 JSON 在数组处被截断，需要精确抠出可解析片段。
 */
function findJsonSpan(text: string): { start: number; end: number } | null {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== '{' && ch !== '[') continue
    let depth = 0
    let inStr = false
    let esc = false
    for (let j = i; j < text.length; j++) {
      const c = text[j]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') {
        depth--
        if (depth === 0) return { start: i, end: j + 1 }
      }
    }
  }
  return null
}

/**
 * 修复被截断的 JSON（模型在数组/对象未闭合时就被切断，如 `{"points":[{"text":"a"`）。
 * 做法：定位首个 `{`/`[` 为起点，按栈记录未闭合的括号与字符串状态，
 * 收尾时补上未闭合的引号、去掉多余的尾逗号、再按栈逆序补全 `]`/`}`。
 * 这是 best-effort：仍解析不了就交给上层抛友好错误。
 */
function repairTruncatedJson(text: string): string | null {
  let start = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') { start = i; break }
  }
  if (start < 0) return null

  const stack: string[] = []
  let inStr = false
  let esc = false
  for (let j = start; j < text.length; j++) {
    const c = text[j]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') stack.push(c)
    else if (c === '}' || c === ']') {
      const top = stack[stack.length - 1]
      if ((top === '{' && c === '}') || (top === '[' && c === ']')) stack.pop()
    }
  }
  if (stack.length === 0 && !inStr) return null // 本就可以完整解析，无需 repair

  let s = text.slice(start)
  // 去掉未闭合字符串前残留的尾逗号（如 `[1,2,`）
  s = s.replace(/,\s*$/, '')
  if (inStr) {
    s += '"' // 补上未闭合的字符串引号
  } else if (/:$/.test(s)) {
    s += 'null' // 截断在键值冒号后（如 `...", "points":`），补一个占位值才有合法 JSON
  }
  while (stack.length) {
    const c = stack.pop()
    s += c === '{' ? '}' : ']'
  }
  return s
}

/**
 * 修复字符串值里的裸 ASCII 双引号：模型常把中文引号误写成 ASCII `"`（如
 * `"道在天下情怀，"和合共生"诠释中国"可敬"担当"`），把 JSON 字符串边界打断。
 * 判断依据：只有「结构性分隔引号」（紧跟在 `{ [ , :` 后，或紧邻 `} ] , :` 前）才是 JSON 语法引号，
 * 其余位于内容中间的 ASCII `"` 全部转成中文全角引号，从而让 JSON 重新可解析。
 */
function repairMismatchedQuotes(text: string): string | null {
  const STRUCT_OPEN = new Set(['{', '[', ',', ':'])
  const STRUCT_CLOSE = new Set(['}', ']', ',', ':'])
  const lq = '\u201C' // “
  const rq = '\u201D' // ”
  let out = ''
  let expectOpen = true
  let changed = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c !== '"') {
      out += c
      continue
    }
    // 找前后第一个非空白字符，判断当前引号是否处于结构性位置
    let prev = ''
    for (let j = i - 1; j >= 0; j--) {
      if (text[j] !== ' ' && text[j] !== '\n' && text[j] !== '\t') { prev = text[j]; break }
    }
    let next = ''
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] !== ' ' && text[j] !== '\n' && text[j] !== '\t') { next = text[j]; break }
    }
    const structOpen = STRUCT_OPEN.has(prev)
    const structClose = STRUCT_CLOSE.has(next)
    // 结构引号（键/值定界符）保留；其余内容引号转全角
    if (structOpen || structClose) {
      out += c
    } else {
      out += expectOpen ? lq : rq
      expectOpen = !expectOpen
      changed = true
    }
  }
  return changed ? out : null
}

/** 尝试用多种策略解析候选文本，解析成功返回对象，否则返回 undefined */
function tryParseCandidate(candidate: string): unknown {
  // 1) 原样解析
  try { return JSON.parse(candidate) } catch { /* 继续 */ }
  // 2) 修复字符串值里的裸 ASCII 引号（结构配平但含中文引号误写，最常见）
  const dequoted = repairMismatchedQuotes(candidate)
  if (dequoted !== null) {
    try { return JSON.parse(dequoted) } catch { /* 继续 */ }
  }
  // 3) 修复被截断的 JSON：先于 findJsonSpan，避免抠到内层完整碎片而丢失外层结构
  //    （如 {"points":[{"text":"a"... 被截断时，内层 {"text":"a"} 是合法 JSON 但缺 stance/points）
  const repaired = repairTruncatedJson(candidate)
  if (repaired !== null) {
    try { return JSON.parse(repaired) } catch { /* 继续 */ }
  }
  // 4) 抠出完整 JSON 子串（说明文字夹杂 / 代码块）
  const span = findJsonSpan(candidate)
  if (span) {
    try { return JSON.parse(candidate.slice(span.start, span.end)) } catch { /* 继续 */ }
  }
  return undefined
}

/** 从 AI 返回文本里抠出 JSON（模型可能包 ```json 代码块或夹带说明文字，也可能被截断）。
 *  任何解析失败都统一回退到友好提示，不泄露 V8 原生 SyntaxError。 */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = fence ? [fence[1], trimmed] : [trimmed]
  for (const candidate of candidates) {
    const parsed = tryParseCandidate(candidate)
    if (parsed !== undefined) return parsed as T
  }
  throw new Error('AI 返回内容不是有效 JSON')
}

export async function aiChat(opts: AiCallOptions): Promise<string> {
  const { settings } = useAiStore.getState()
  if (!isAiConfigured(settings)) throw new AiNotConfiguredError()

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort()
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }

  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        messages: opts.messages,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        json: opts.json,
      }),
    })
    const data = (await res.json().catch(() => null)) as { content?: string; error?: string } | null
    if (!res.ok || !data) throw new Error(data?.error || `AI 请求失败（${res.status}）`)
    return data.content ?? ''
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new Error('AI 请求超时或已取消')
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    clearTimeout(timer)
  }
}
