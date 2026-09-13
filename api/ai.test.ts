import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { isForbiddenUpstream, POST } from './ai'

/**
 * /api/ai 的 SSRF 分级策略：生产（VERCEL=1）拒绝内网/本机/非 https baseUrl；
 * 本地 dev 放行（BYOK 用户会填 http://localhost:11434 等 Ollama/LM Studio 端点）。
 * 拦截发生在 fetch 之前；策略本体 isForbiddenUpstream 直测。
 * 用例只用 IP 字面量与 localhost 词法命中，不做 DNS 解析（无网络依赖）；
 * 通配 DNS 类目标（nip.io 等）由 dns.lookup 分支覆盖，无法离线测。
 */

describe('isForbiddenUpstream（SSRF 分级）', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('生产：拒绝非 https、localhost 系、私网、链路本地、CGNAT、未指定地址', async () => {
    vi.stubEnv('VERCEL', '1')
    for (const root of [
      'http://api.example.com',
      'http://localhost:11434',
      'https://localhost',
      'https://foo.local',
      'https://metadata.google.internal',
      'https://127.0.0.1:8000',
      'https://10.0.0.5',
      'https://192.168.1.10:1234',
      'https://172.16.0.1',
      'https://172.31.255.1',
      'https://169.254.169.254',
      'https://100.100.1.1',
      'https://0.0.0.0',
      'https://[::1]:8000',
      'https://[fd00::1]',
      'https://[fe80::1]',
      'not a url',
    ]) {
      expect(await isForbiddenUpstream(root), root).toBe(true)
    }
  })

  it('生产：IPv4-mapped IPv6 两种写法（点分与十六进制）都拦', async () => {
    vi.stubEnv('VERCEL', '1')
    expect(await isForbiddenUpstream('https://[::ffff:127.0.0.1]:8000')).toBe(true)
    expect(await isForbiddenUpstream('https://[::ffff:169.254.169.254]')).toBe(true)
    expect(await isForbiddenUpstream('https://[::ffff:7f00:1]')).toBe(true)
    expect(await isForbiddenUpstream('https://[::ffff:a9fe:a9fe]')).toBe(true)
    expect(await isForbiddenUpstream('https://[::FFFF:192.168.1.1]')).toBe(true)
  })

  it('生产：公网段不拦（IP 字面量 172.32 起）；十进制 IP 由 new URL 规范化成 127.0.0.1 后被拦', async () => {
    vi.stubEnv('VERCEL', '1')
    expect(await isForbiddenUpstream('https://172.32.0.1')).toBe(false)
    expect(await isForbiddenUpstream('https://8.8.8.8')).toBe(false)
    expect(await isForbiddenUpstream('https://[2606:4700::1]')).toBe(false)
    // 2130706433 = 127.0.0.1：WHATWG URL 的 IPv4 解析器在构造时就把它规范成点分形式
    expect(await isForbiddenUpstream('https://2130706433')).toBe(true)
  })

  it('本地 dev：一律放行（包括私网与非 https）', async () => {
    expect(await isForbiddenUpstream('http://localhost:11434')).toBe(false)
    expect(await isForbiddenUpstream('https://192.168.1.10:1234')).toBe(false)
    expect(await isForbiddenUpstream('https://127.0.0.1:8000')).toBe(false)
    expect(await isForbiddenUpstream('https://[::ffff:127.0.0.1]')).toBe(false)
  })
})

describe('POST /api/ai 参数校验（不经网络）', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('缺字段 → 400 与提示', async () => {
    const res = await POST(
      new Request('http://localhost/api/ai', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: '', apiKey: 'k', model: 'm', messages: [] }),
      }),
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain('必填')
  })

  it('请求体非 JSON → 400', async () => {
    const res = await POST(new Request('http://localhost/api/ai', { method: 'POST', body: 'not-json' }))
    expect(res.status).toBe(400)
  })

  it('生产环境拦截发生在 fetch 之前（内网地址直接 400，不产生网络请求）', async () => {
    vi.stubEnv('VERCEL', '1')
    const res = await POST(
      new Request('http://localhost/api/ai', {
        method: 'POST',
        body: JSON.stringify({
          baseUrl: 'http://localhost:11434',
          apiKey: 'k',
          model: 'm',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain('不被允许')
  })
})
