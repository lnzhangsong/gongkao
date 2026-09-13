import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GET as articlesGET } from './articles'
import { GET as examsGET } from './exams'
import { GET as termsGET } from './terms'
import { GET as xingceGET } from './xingce'
import { POST as aiPOST } from './ai'

/**
 * 本地 api-server 与 api/*.ts handler 的 parity 测试。
 * api-server 已改为直接 import api/*.ts 的 GET/POST（消除两侧漂移），这里锁住
 * 转发层本身：同一输入下，HTTP 出来的状态码与 body 必须和直调 handler 一致。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let child: ReturnType<typeof spawn> | null = null
let BASE = '' // beforeAll 里按子进程实际端口确定（port 0 = OS 分配，避开固定端口冲突）
let stdoutBuf = ''
let stderrBuf = ''

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    // 子进程自己打印实际端口（「就绪 → http://localhost:<port>/…」）
    const m = /http:\/\/localhost:(\d+)\//.exec(stdoutBuf)
    if (m) {
      BASE = `http://127.0.0.1:${m[1]}`
      try {
        const res = await fetch(`${BASE}/api/terms`)
        if (res.ok) return
      } catch {
        /* not ready yet */
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`api-server 未在 10s 内就绪；子进程 stderr：\n${stderrBuf || '（空）'}`)
}

beforeAll(async () => {
  child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'api-server.mjs'), '0'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (d) => (stdoutBuf += d.toString()))
  child.stderr?.on('data', (d) => (stderrBuf += d.toString()))
  await waitForServer()
})

afterAll(async () => {
  if (!child) return
  // 等子进程真正退出，避免 vp test 连续跑时残留进程占用端口
  const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()))
  child.kill()
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))])
})

describe('api-server ↔ api/*.ts parity（全部 GET 端点）', () => {
  it('GET /api/articles 与直调 handler 输出一致', async () => {
    const viaHttp = await (await fetch(`${BASE}/api/articles`)).json()
    const direct = await articlesGET(new Request(`${BASE}/api/articles`)).json()
    expect(viaHttp).toEqual(direct)
  })

  it('GET /api/articles?id=…（含正文）与直调 handler 一致', async () => {
    const list = await (await fetch(`${BASE}/api/articles?limit=1`)).json()
    const id = list.articles[0].id
    const viaHttp = await (await fetch(`${BASE}/api/articles?id=${id}`)).json()
    const direct = await articlesGET(new Request(`${BASE}/api/articles?id=${id}`)).json()
    expect(viaHttp).toEqual(direct)
    expect(viaHttp).toHaveProperty('content')
  })

  it('GET /api/terms 与直调 handler 输出一致，且每条带 id（前端以此为标识；历史上生产漏 id 导致编辑态/key/见过标记全部串键）', async () => {
    const viaHttp = await (await fetch(`${BASE}/api/terms`)).json()
    const direct = await termsGET(new Request(`${BASE}/api/terms`)).json()
    expect(viaHttp).toEqual(direct)
    expect(direct.terms.length).toBeGreaterThan(0)
    for (const t of direct.terms) expect(typeof t.id).toBe('number')
  })

  it('GET /api/exams 与直调 handler 一致（列表 + ?id= 详情）', async () => {
    const viaList = await (await fetch(`${BASE}/api/exams`)).json()
    const directList = await examsGET(new Request(`${BASE}/api/exams`)).json()
    expect(viaList).toEqual(directList)
    const id = directList.papers[0].id
    const viaDetail = await (await fetch(`${BASE}/api/exams?id=${encodeURIComponent(id)}`)).json()
    const directDetail = await examsGET(new Request(`${BASE}/api/exams?id=${encodeURIComponent(id)}`)).json()
    expect(viaDetail).toEqual(directDetail)
    expect(directDetail).toHaveProperty('questions')
  })

  it('GET /api/xingce 与直调 handler 一致（列表）', async () => {
    const viaHttp = await (await fetch(`${BASE}/api/xingce`)).json()
    const direct = await xingceGET(new Request(`${BASE}/api/xingce`)).json()
    expect(viaHttp).toEqual(direct)
  })

  it('本地 dev 不缓存：转发响应剥掉线上 cache-control', async () => {
    for (const path of ['/api/articles', '/api/terms', '/api/exams', '/api/xingce']) {
      const res = await fetch(`${BASE}${path}`)
      expect(res.headers.get('cache-control'), path).toBe('no-store')
    }
  })

  it('POST /api/ai 缺字段时与直调 handler 输出一致（400）', async () => {
    const payload = JSON.stringify({ baseUrl: '', apiKey: 'k', model: 'm', messages: [] })
    const viaHttp = await (
      await fetch(`${BASE}/api/ai`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload })
    ).json()
    const direct = await (await aiPOST(new Request(`${BASE}/api/ai`, { method: 'POST', body: payload }))).json()
    expect(viaHttp).toEqual(direct)
    expect(viaHttp.error).toContain('必填')
  })

  it('POST /api/ai 请求体非 JSON 时与直调 handler 一致（400）', async () => {
    const viaHttp = await (
      await fetch(`${BASE}/api/ai`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      })
    ).json()
    const direct = await (await aiPOST(new Request(`${BASE}/api/ai`, { method: 'POST', body: 'not-json' }))).json()
    expect(viaHttp).toEqual(direct)
  })

  it('GET /api/capabilities 报告白写能力（生产无此路由 → 前端视为只读）', async () => {
    const res = await fetch(`${BASE}/api/capabilities`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ write: true })
  })

  it('请求体超过 2MB 上限 → 413，且服务不崩（曾因二次响应 ERR_HTTP_HEADERS_SENT 打挂进程）', async () => {
    const res = await fetch(`${BASE}/api/terms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(2 * 1024 * 1024 + 1),
    })
    expect(res.status).toBe(413)
    expect(((await res.json()) as { error: string }).error).toContain('2MB')
    // 关键断言：413 之后服务必须仍然活着（只断言 413 漏掉崩溃——响应确实发出去了）
    const after = await fetch(`${BASE}/api/articles`)
    expect(after.status).toBe(200)
    expect(await after.json()).toHaveProperty('articles')
  })
})

describe('api-server SSRF 分级', () => {
  it('本地 dev 放行 http 私网地址（Ollama 等本地端点可达性不再被误拦）', async () => {
    // 不真实连 Ollama，只验证未进入生产拦截分支：错误是连接失败（502）而非地址被拒（400）
    const payload = JSON.stringify({ baseUrl: 'http://127.0.0.1:9', apiKey: 'k', model: 'm', messages: [] })
    const res = await fetch(`${BASE}/api/ai`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    })
    expect(res.status).toBe(502)
  })
})

describe('api-server 配置 WRITE_TOKEN 时的能力探测', () => {
  let tokenChild: ReturnType<typeof spawn> | null = null
  let tokenBase = ''
  let tokenStderr = ''

  beforeAll(async () => {
    tokenChild = spawn(process.execPath, [path.join(ROOT, 'scripts', 'api-server.mjs'), '0'], {
      cwd: ROOT,
      env: { ...process.env, WRITE_TOKEN: 'test-token' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    tokenChild.stderr?.on('data', (d) => (tokenStderr += d.toString()))
    let stdoutBuf = ''
    tokenChild.stdout?.on('data', (d) => (stdoutBuf += d.toString()))
    for (let i = 0; i < 100; i++) {
      const m = /http:\/\/localhost:(\d+)\//.exec(stdoutBuf)
      if (m) {
        tokenBase = `http://127.0.0.1:${m[1]}`
        try {
          if ((await fetch(`${tokenBase}/api/terms`)).ok) return
        } catch {
          /* not ready */
        }
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`WRITE_TOKEN 子进程未就绪；stderr：\n${tokenStderr}`)
  })

  afterAll(async () => {
    if (!tokenChild) return
    const exited = new Promise<void>((resolve) => tokenChild!.once('exit', () => resolve()))
    tokenChild.kill()
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))])
  })

  it('capabilities 按请求方回答：无令牌 write:false（前端不该渲染必 401 的按钮），带令牌 write:true', async () => {
    const noToken = await (await fetch(`${tokenBase}/api/capabilities`)).json()
    expect(noToken).toEqual({ write: false })
    const withToken = await (
      await fetch(`${tokenBase}/api/capabilities`, { headers: { 'x-write-token': 'test-token' } })
    ).json()
    expect(withToken).toEqual({ write: true })
  })
})
