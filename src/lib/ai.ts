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

/** 从 AI 返回文本里抠出 JSON（模型可能包 ```json 代码块或夹带说明文字） */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fence ? fence[1] : trimmed
  try {
    return JSON.parse(candidate) as T
  } catch {
    const s = candidate.indexOf('{')
    const e = candidate.lastIndexOf('}')
    if (s >= 0 && e > s) return JSON.parse(candidate.slice(s, e + 1)) as T
    throw new Error('AI 返回内容不是有效 JSON')
  }
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
