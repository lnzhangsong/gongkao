import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

/* mock @vercel/postgres：sql 模板标签返回可配置的查询结果 */
const sqlMock = vi.fn()
vi.mock('@vercel/postgres', () => ({ sql: Object.assign((...args: unknown[]) => sqlMock(...args)) }))

const supabaseFetchMock = vi.fn()
vi.stubGlobal('fetch', supabaseFetchMock)

import { GET, PATCH } from './me'

const TOKEN = 'test-access-token'

function authed(token: string | null = TOKEN): Request {
  return new Request('http://localhost/api/me', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

/** Supabase /auth/v1/user 校验成功 */
function mockAuthOk(user = { id: 'u1', email: 'a@b.c' }) {
  supabaseFetchMock.mockResolvedValue(new Response(JSON.stringify(user), { status: 200 }))
}

function profileRow(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'a@b.c',
    nickname: '小明',
    created_at: '2026-01-01T00:00:00Z',
    last_seen_at: '2026-01-02T00:00:00Z',
    ...over,
  }
}

beforeEach(() => {
  sqlMock.mockReset()
  supabaseFetchMock.mockReset()
  vi.stubEnv('SUPABASE_URL', 'https://sb.example.com')
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/me', () => {
  it('无 token 返回 401', async () => {
    const res = await GET(authed(null))
    expect(res.status).toBe(401)
  })

  it('token 无效（Supabase 401）返回 401', async () => {
    supabaseFetchMock.mockResolvedValue(new Response('{"error":"invalid"}', { status: 401 }))
    const res = await GET(authed())
    expect(res.status).toBe(401)
  })

  it('校验通过且库可用：upsert 并返回 profile', async () => {
    mockAuthOk()
    vi.stubEnv('DATABASE_URL', 'postgres://x')
    sqlMock.mockResolvedValue({ rows: [profileRow()] })
    const res = await GET(authed())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { profile: { id: string; nickname: string } }
    expect(body.profile.id).toBe('u1')
    expect(body.profile.nickname).toBe('小明')
    expect(sqlMock).toHaveBeenCalledOnce()
  })

  it('未配置 DATABASE_URL：优雅降级，返回仅含身份的 profile', async () => {
    mockAuthOk()
    const res = await GET(authed())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { profile: { id: string; nickname: string | null } }
    expect(body.profile).toEqual({ id: 'u1', email: 'a@b.c', nickname: null })
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('库写入失败（建表前等）：同样降级不报 500', async () => {
    mockAuthOk()
    vi.stubEnv('DATABASE_URL', 'postgres://x')
    sqlMock.mockRejectedValue(new Error('relation "profiles" does not exist'))
    const res = await GET(authed())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { profile: { nickname: string | null } }
    expect(body.profile.nickname).toBeNull()
  })
})

describe('PATCH /api/me', () => {
  function patchReq(body: unknown, token: string | null = TOKEN): Request {
    return new Request('http://localhost/api/me', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  it('昵称为空返回 400', async () => {
    mockAuthOk()
    const res = await PATCH(patchReq({ nickname: '   ' }))
    expect(res.status).toBe(400)
  })

  it('未配库返回 503（资料无处可写）', async () => {
    mockAuthOk()
    const res = await PATCH(patchReq({ nickname: '小明' }))
    expect(res.status).toBe(503)
  })

  it('更新成功返回新 profile（昵称去除首尾空白）', async () => {
    mockAuthOk()
    vi.stubEnv('DATABASE_URL', 'postgres://x')
    sqlMock.mockResolvedValue({ rows: [profileRow({ nickname: '小明' })] })
    const res = await PATCH(patchReq({ nickname: '  小明  ' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { profile: { nickname: string } }
    expect(body.profile.nickname).toBe('小明')
  })
})
