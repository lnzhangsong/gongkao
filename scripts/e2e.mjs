/**
 * 端到端冒烟测试一键入口（npm run test:e2e）：
 * 1. 清理 5173 / 8787 残留端口（避免上次失败遗留的进程）
 * 2. 后台拉起 vite dev（5173）——e2e-smoke.mjs 内会自行拉起 API server（8787）
 * 3. 轮询 5173 直到 vite 就绪
 * 4. 运行 scripts/e2e-smoke.mjs（本脚本未退出前由其 set 超时兜底）
 * 5. 结束后杀掉 vite dev 进程
 */
import { spawn, execSync } from 'node:child_process'
import process from 'node:process'

const WEB_PORT = 5173
const API_PORT = Number(process.env.E2E_API_PORT || 8787)

function killPort(port) {
  try {
    execSync(`node scripts/kill-port.mjs ${port}`, { stdio: 'ignore' })
  } catch {
    /* 端口本就空闲则无输出，正常 */
  }
}

// 1) 清残留端口
killPort(WEB_PORT)
killPort(API_PORT)

// 2) 拉起 vite dev（默认端口 5173）
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(WEB_PORT)], {
  stdio: 'pipe', // 收集 stderr 以便诊断；不继承避免刷屏
  detached: false,
})
let viteOutput = ''
vite.stderr.on('data', (d) => {
  viteOutput += d.toString()
})

// 3) 轮询 5173 直到可响应
async function waitForDev(port, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/`)
      if (res.ok) return true
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  console.error(`[e2e] vite dev 未在 ${timeoutMs}ms 内就绪。\n${viteOutput.slice(-2000)}`)
  return false
}

const ready = await waitForDev(WEB_PORT)
if (!ready) {
  vite.kill('SIGTERM')
  process.exit(1)
}
console.log(`[e2e] vite dev 就绪（http://localhost:${WEB_PORT}）`)

// 4) 运行冒烟脚本（继承 stdio，让其 PASS/FAIL 直接输出；错误则退出码非 0）
const smoke = spawn(process.execPath, ['scripts/e2e-smoke.mjs'], {
  stdio: 'inherit',
  detached: false,
})
const code = await new Promise((resolve) => smoke.on('close', resolve))

// 5) 收尾：杀掉 vite dev
vite.kill('SIGTERM')

console.log(`[e2e] 冒烟结束，退出码 ${code}`)
process.exit(code ?? 1)
