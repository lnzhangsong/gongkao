/**
 * /api/me — 当前登录用户 profile（Vercel Function，fetch Web Standard export）
 *
 * 用法：
 *   GET   /api/me                          → 校验 Bearer token，upsert 并返回 profile
 *   PATCH /api/me  { nickname }            → 更新当前用户昵称
 *
 * 认证：Authorization: Bearer <supabase access_token>
 *       转发到 Supabase /auth/v1/user 校验（服务端持有 anon key + 项目 URL 即可，
 *       该端点会用 token 换取用户信息，无效 token 返回 401）
 * 存储：Vercel Postgres（DATABASE_URL）。未配置时优雅降级——仅返回身份信息，
 *       不写库（本地 dev / 未建库环境仍可用）。
 * 注意：本文件自包含全部逻辑（不 import 兄弟模块）——Vercel 打包 api 函数时只编译
 *       入口文件，相对 import 的模块不会输出（见 api/articles.ts 顶部说明）。
 */
import { sql } from '@vercel/postgres'

interface AuthUser {
  id: string
  email: string | null
}

interface ProfileRow {
  id: string
  email: string | null
  nickname: string | null
  created_at: string
  last_seen_at: string
}

/** 用 Bearer token 换取 Supabase 用户；无效返回 null */
async function verifyToken(request: Request): Promise<AuthUser | null> {
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return null
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: key },
    })
    if (!res.ok) return null
    const user = (await res.json()) as { id?: string; email?: string | null }
    return user.id ? { id: user.id, email: user.email ?? null } : null
  } catch {
    return null
  }
}

/** upsert profile 并返回最新一行；库不可用返回 null（调用方降级） */
async function upsertProfile(user: AuthUser): Promise<ProfileRow | null> {
  if (!process.env.DATABASE_URL) return null
  try {
    const { rows } = await sql<ProfileRow>`
      INSERT INTO profiles (id, email, last_seen_at)
      VALUES (${user.id}, ${user.email}, now())
      ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email, last_seen_at = now()
      RETURNING id, email, nickname, created_at, last_seen_at
    `
    return rows[0] ?? null
  } catch {
    return null
  }
}

async function updateNickname(user: AuthUser, nickname: string): Promise<ProfileRow | null> {
  if (!process.env.DATABASE_URL) return null
  const clean = nickname.trim().slice(0, 24)
  const { rows } = await sql<ProfileRow>`
    UPDATE profiles SET nickname = ${clean}, last_seen_at = now() WHERE id = ${user.id}
    RETURNING id, email, nickname, created_at, last_seen_at
  `
  return rows[0] ?? null
}

function shape(row: ProfileRow | null, user: AuthUser) {
  return row
    ? {
        id: row.id,
        email: row.email ?? user.email,
        nickname: row.nickname,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
      }
    : { id: user.id, email: user.email, nickname: null }
}

export async function GET(request: Request) {
  const user = await verifyToken(request)
  if (!user) return json({ error: 'unauthorized' }, 401)
  /* upsert 失败（未配库等）不阻塞：返回仅含身份的降级结果 */
  const row = await upsertProfile(user)
  return json({ profile: shape(row, user) })
}

export async function PATCH(request: Request) {
  const user = await verifyToken(request)
  if (!user) return json({ error: 'unauthorized' }, 401)
  let body: { nickname?: unknown } = {}
  try {
    body = (await request.json()) as { nickname?: unknown }
  } catch {
    return json({ error: 'invalid json' }, 400)
  }
  if (typeof body.nickname !== 'string' || !body.nickname.trim()) {
    return json({ error: 'nickname required' }, 400)
  }
  const row = await updateNickname(user, body.nickname)
  if (!row) return json({ error: 'profile store unavailable' }, 503)
  return json({ profile: shape(row, user) })
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
