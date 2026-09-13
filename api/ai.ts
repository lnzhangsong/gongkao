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
import { promises as dns } from 'node:dns'

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

  // 防呆：baseUrl 填成了完整端点（以 /chat/completions 结尾）时不再追加路径。
  // root 在 try 外声明：catch 里的错误提示也要用（try 内声明的 let 对 catch 不可见）
  let root = String(baseUrl).replace(/\/+$/, '')
  if (root.endsWith('/chat/completions')) root = root.slice(0, -'/chat/completions'.length)

  if (await isForbiddenUpstream(root)) {
    return json({ error: '接口地址不被允许：生产环境仅接受 https 且不得指向内网/本机地址' }, 400)
  }

  try {
    // redirect: 'manual'：跟随重定向会绕过上面的地址校验（公网 302 → 内网目标）
    const upstream = await fetch(`${root}/chat/completions`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        ...(typeof temperature === 'number' ? { temperature } : {}),
        ...(Number.isFinite(maxTokens) ? { max_tokens: maxTokens } : {}),
        ...(wantJson ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    if (upstream.status >= 300 && upstream.status < 400) {
      return json({ error: `上游返回重定向（${upstream.status}），已拒绝：地址校验只对显式 baseUrl 生效` }, 502)
    }
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
    return json({ error: upstreamErrorMessage(err, root) }, 502)
  }
}

/** 判定一个 IP（点分十进制 / IPv6 文本）是否属于禁用网段：
 *  回环、未指定地址、私网、链路本地、CGN 之外的保留段从简——覆盖 SSRF 高危目标即可。
 *  IPv4-mapped IPv6（::ffff:0:0/96）先还原成点分十进制再判，两种写法都要挡。 */
function isForbiddenAddress(rawIp: string): boolean {
  let s = rawIp.toLowerCase().replace(/^\[|\]$/g, '')
  const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (mappedDotted) {
    s = mappedDotted[1]
  } else if (s.startsWith('::ffff:')) {
    // ::ffff:a9fe:a9fe（十六进制写法）→ 169.254.169.254
    const parts = s.slice('::ffff:'.length).split(':')
    if (parts.length === 2) {
      const hi = parseInt(parts[0], 16)
      const lo = parseInt(parts[1], 16)
      if (Number.isNaN(hi) || Number.isNaN(lo)) return true
      s = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
    }
  }
  if (s === '::' || s === '::1') return true
  if (/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.test(s)) {
    const [a, b] = s.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true // 未指定 / 私网 / 回环
    if (a === 169 && b === 254) return true // 链路本地（云 metadata）
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT（内网中转常用）
    return false
  }
  if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s)) return true // IPv6 fc00::/7（ULA）、fe80::/10（链路本地）
  return false
}

/** SSRF 防护：客户端提供的 baseUrl 会被服务端直接 fetch，Vercel Function 可被当
 *  任意 POST 代理打内网。仅生产（VERCEL 环境变量）拦截；本地 dev 放行——BYOK 用户
 *  会正当填写 http://localhost:11434（Ollama）、http://192.168.x.x:1234（LM Studio）。
 *
 * 三层：
 *  1. 词法：非 https、localhost/.local/.internal 域名；
 *  2. IP 字面量：先归一化（v4-mapped IPv6 两种写法）再判网段；
 *  3. 域名：dns.lookup 解析出全部地址逐个判——通配 DNS（如 169.254.169.254.nip.io）
 *     在词法层无害，只有解析后才能暴露。解析失败视为拒绝（fail closed）。
 * 配套 fetch 必须 redirect: 'manual'（见 POST），否则公网 302 可跳向内网。
 *
 * 已知边界（覆盖高危目标即可，堵死需要自定义 dispatcher 固定解析结果）：
 * - DNS rebinding TOCTOU：这里解析一次、fetch 再解析一次，TTL=0 的域名可在第二次
 *   翻成内网 IP；
 * - 未覆盖 64:ff9b::/96（NAT64）、2002::/16（6to4）、224.0.0.0/4（组播）等转换/特殊段。 */
export async function isForbiddenUpstream(root: string): Promise<boolean> {
  if (!process.env.VERCEL) return false
  let u: URL
  try {
    u = new URL(root)
  } catch {
    return true
  }
  if (u.protocol !== 'https:') return true
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h.includes(':') || /^\d+(\.\d+){3}$/.test(h)) {
    // IP 字面量（IPv6 hostname 保留方括号形式）
    return isForbiddenAddress(h)
  }
  try {
    const addrs = await dns.lookup(h, { all: true })
    return addrs.some((a) => isForbiddenAddress(a.address))
  } catch {
    return true
  }
}

/** undici 在上游连接失败时抛 `TypeError: fetch failed`（真实原因在 err.cause），
 *  把它翻译成可操作的提示，避免把原生报错原样漏给前端。 */
function upstreamErrorMessage(err: unknown, root: string): string {
  const cause = err instanceof Error && err.cause instanceof Error ? (err.cause as Error).message : ''
  const raw = `${err instanceof Error ? err.message : String(err)}${cause ? `（${cause}）` : ''}`
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|ERR_SOCKET/i.test(raw)) {
    return `无法连接到 AI 服务（${root}），请检查接口地址与网络后重试`
  }
  return raw
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
