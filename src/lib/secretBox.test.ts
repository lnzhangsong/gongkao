import { describe, expect, it } from 'vite-plus/test'
import { encryptSecret, decryptSecret, isSecretEnvelope } from './secretBox'

/**
 * BYOK apiKey 上云前的端到端加密（PBKDF2 + AES-GCM）。
 * 默认 node 环境即可：Node 24 自带 globalThis.crypto.subtle / btoa / atob。
 */
describe('secretBox（同步口令加解密）', () => {
  it('加密后可解出原文，且信封任何字段都不含明文', async () => {
    const env = await encryptSecret('sk-test-1234567890', 'correct horse battery')
    expect(isSecretEnvelope(env)).toBe(true)
    expect(JSON.stringify(env)).not.toContain('sk-test')
    expect(await decryptSecret(env, 'correct horse battery')).toBe('sk-test-1234567890')
  })

  it('口令不符解不开（GCM 认证失败）', async () => {
    const env = await encryptSecret('sk-secret', 'right-pass')
    await expect(decryptSecret(env, 'wrong-pass')).rejects.toThrow()
  })

  it('同一明文两次加密 salt/iv/密文都不同，但都可解', async () => {
    const a = await encryptSecret('sk-same', 'pw')
    const b = await encryptSecret('sk-same', 'pw')
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ct).not.toBe(b.ct)
    expect(await decryptSecret(a, 'pw')).toBe('sk-same')
    expect(await decryptSecret(b, 'pw')).toBe('sk-same')
  })

  it('篡改密文会被 GCM 拒绝', async () => {
    const env = await encryptSecret('sk-x', 'pw')
    const last = env.ct.slice(-4)
    const tampered = { ...env, ct: env.ct.slice(0, -4) + (last === 'AAAA' ? 'BBBB' : 'AAAA') }
    await expect(decryptSecret(tampered, 'pw')).rejects.toThrow()
  })

  it('isSecretEnvelope 只接受合法信封', () => {
    expect(isSecretEnvelope(null)).toBe(false)
    expect(isSecretEnvelope('x')).toBe(false)
    expect(isSecretEnvelope({})).toBe(false)
    expect(isSecretEnvelope({ v: 2, salt: 'a', iv: 'b', ct: 'c' })).toBe(false)
    expect(isSecretEnvelope({ v: 1, salt: 'a', iv: 'b' })).toBe(false)
    expect(isSecretEnvelope({ v: 1, salt: 'a', iv: 'b', ct: 'c' })).toBe(true)
  })
})
