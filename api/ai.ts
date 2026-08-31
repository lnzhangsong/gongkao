/**
 * POST /api/ai — AI 纯转发（BYOK，Vercel Function）
 *
 * 设计文档 §6.1（申论写作AI辅助设计方案.md）：
 * - 服务端只做纯转发（OpenAI 兼容 /chat/completions），不存任何用户数据
 * - baseUrl/apiKey/model 由客户端按请求携带（用户在设置页自填，存本地 IndexedDB）
 * - 上下文（文章正文、素材、拆解记录）全部在客户端组装进 messages
 *
 * body: { baseUrl, apiKey, model, messages[], temperature?, maxTokens?, json? }
 * 返回: { content } 或 { error }
 */
export async function POST(request: Request) {
  let body: {
    baseUrl?: string
    apiKey?: string
    model?: string
    messages?: unknown[]
    temperature?: number
    maxTokens?: number
    json?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return json({ error: '请求体不是有效 JSON' }, 400)
  }

  const { baseUrl, apiKey, model, messages, temperature, maxTokens, json: wantJson } = body
  if (!baseUrl || !apiKey || !model || !Array.isArray(messages)) {
    return json({ error: 'baseUrl / apiKey / model / messages 必填' }, 400)
  }

  try {
    // 防呆：baseUrl 填成了完整端点（以 /chat/completions 结尾）时不再追加路径
    let root = String(baseUrl).replace(/\/+$/, '')
    if (root.endsWith('/chat/completions')) root = root.slice(0, -'/chat/completions'.length)
    const upstream = await fetch(`${root}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        ...(typeof temperature === 'number' ? { temperature } : {}),
        ...(Number.isFinite(maxTokens) ? { max_tokens: maxTokens } : {}),
        ...(wantJson ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    const data = await upstream.json().catch(() => null)
    if (!upstream.ok || !data) {
      const msg = (data as any)?.error?.message ?? (data as any)?.error ?? `上游返回 ${upstream.status}`
      return json({ error: `[上游 ${upstream.status}] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}` }, 502)
    }
    const content = (data as any)?.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      return json({ error: '上游响应缺少 choices[0].message.content' }, 502)
    }
    return json({ content })
  } catch (err) {
    return json({ error: String(err) }, 502)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
