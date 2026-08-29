/**
 * 清理端口占用：dev 启动前把残留的旧服务杀掉，避免端口冲突启动失败。
 *   node scripts/kill-port.mjs 8787 5173
 * 跨平台：macOS/Linux 用 lsof，Windows 用 netstat + taskkill。
 */
import { execSync } from 'node:child_process'

const ports = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0)
if (ports.length === 0) {
  console.error('用法: node scripts/kill-port.mjs <port> [port...]')
  process.exit(1)
}

const isWin = process.platform === 'win32'

for (const port of ports) {
  try {
    let pids
    if (isWin) {
      const out = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port} "`, { encoding: 'utf8' })
      pids = [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).at(-1)).filter(Boolean))]
    } else {
      const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' })
      pids = [...new Set(out.split('\n').map((l) => l.trim()).filter(Boolean))]
    }
    if (pids.length === 0) continue
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM')
        console.log(`[kill-port] 端口 ${port}：已结束进程 ${pid}`)
      } catch {
        /* 进程可能恰好退出，忽略 */
      }
    }
  } catch {
    /* lsof/findstr 无匹配时抛错 = 端口空闲，正常情况 */
  }
}
