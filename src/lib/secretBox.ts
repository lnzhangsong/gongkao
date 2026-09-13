/**
 * 敏感字段的端到端加密（BYOK API Key 上云前用）。
 *
 * 用「同步口令」派生密钥（PBKDF2-SHA256，21 万次迭代），AES-256-GCM 加密：
 * - 口令只存本机（IndexedDB），云端/Supabase 只见 salt + iv + 密文，无明文
 * - 跨设备要用同一个口令才能解开；口令不符时解不开，本机保留自己的 key
 * - 每次加密用随机 salt + iv，AES-GCM 的 nonce 不复用（同一口令下的不同明文不会撞 nonce）
 *
 * 边界：这是「避免明文落库」，不是抗弱口令——口令强度决定实际安全性。
 */

const PBKDF2_ITERATIONS = 210_000
const SALT_BYTES = 16
const IV_BYTES = 12

export interface SecretEnvelope {
  /** 版本号，便于日后更换算法 */
  v: 1
  /** base64(salt) */
  salt: string
  /** base64(iv) */
  iv: string
  /** base64(AES-GCM 密文，末尾含 GCM tag) */
  ct: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** 加密一个字符串；返回可直接放进云同步 payload 的信封 */
export async function encryptSecret(plain: string, passphrase: string): Promise<SecretEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plain))
  return { v: 1, salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) }
}

/** 解密；口令不符或密文被改会抛错（GCM 认证失败） */
export async function decryptSecret(env: SecretEnvelope, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromBase64(env.salt))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(env.iv) }, key, fromBase64(env.ct))
  return decoder.decode(plain)
}

/** 形状守卫：从云同步的 unknown 数据里安全取出信封 */
export function isSecretEnvelope(value: unknown): value is SecretEnvelope {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  return e.v === 1 && typeof e.salt === 'string' && typeof e.iv === 'string' && typeof e.ct === 'string'
}
