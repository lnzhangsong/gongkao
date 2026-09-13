/**
 * 干净环境的 e2e：临时把 `.env*` 挪开，跑完（含失败 / Ctrl-C）再原样还原。
 *
 * 为什么需要：CI 与「别人 clone 下来的默认态」都没有 `.env`，而本地带着
 * `.env` / `.env.local` 会掩盖只在该环境下才暴露的问题。真实案例——账号分区断言
 * 只在「未配置 Supabase」时失败，本地配了 Supabase 永远测不出来（CI 连续红）。
 *
 * 异常退出（SIGKILL / 崩溃 / 断电）会留下 `*.e2e-clean-bak`；下次启动先复原它们，
 * 否则 `.env` 会永久丢失，而重建的 `.env` 又会被备份静默覆盖。
 *
 * 用法：vp run test:e2e:clean
 */
import { existsSync, renameSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
/** Vite dev 会加载的 env 文件（模式为 development）；`.env.example` 不动 */
const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local']
const SUFFIX = '.e2e-clean-bak'

const moved = []

/**
 * 复原上次异常退出遗留的 `*.e2e-clean-bak`。
 * 若同名 env 已存在则说明人为动过，直接中止而不是覆盖——备份里可能是唯一一份。
 */
function recoverStaleBackups() {
  const stale = []
  for (const name of ENV_FILES) {
    const bak = path.join(ROOT, name + SUFFIX)
    if (!existsSync(bak)) continue
    if (existsSync(path.join(ROOT, name))) {
      console.error(`[e2e:clean] 发现残留备份 ${path.basename(bak)}，但 ${name} 已存在，不覆盖；请确认后手动删除备份`)
      process.exit(1)
    }
    renameSync(bak, path.join(ROOT, name))
    stale.push(name)
  }
  if (stale.length) console.log(`[e2e:clean] 已复原上次异常退出遗留的 env：${stale.join(', ')}`)
}

function hideEnv() {
  for (const name of ENV_FILES) {
    const src = path.join(ROOT, name)
    if (!existsSync(src)) continue
    const dst = src + SUFFIX
    renameSync(src, dst)
    moved.push([dst, src])
  }
}

function restoreEnv() {
  while (moved.length) {
    const [dst, src] = moved.pop()
    // 运行期间有人重建了同名 env：保留备份，不静默覆盖
    if (existsSync(src)) {
      console.error(
        `[e2e:clean] ${path.basename(src)} 在运行期间被重新创建，保留备份 ${path.basename(dst)}，请手动处理`,
      )
      continue
    }
    try {
      renameSync(dst, src)
    } catch (err) {
      console.error(`[e2e:clean] 还原 ${path.basename(src)} 失败：${err.message}（备份在 ${path.basename(dst)}）`)
    }
  }
}

recoverStaleBackups()
hideEnv()
console.log(
  `[e2e:clean] 已临时隐藏 ${moved.length} 个 env 文件：${moved.map(([, s]) => path.basename(s)).join(', ') || '(无)'}`,
)
if (existsSync(path.join(ROOT, '.env'))) {
  restoreEnv()
  console.error('[e2e:clean] .env 仍在，隐藏失败，已中止')
  process.exit(1)
}

let restored = false
const finish = (code) => {
  if (!restored) {
    restored = true
    restoreEnv()
  }
  process.exit(code)
}

let stopping = false
const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'e2e.mjs')], { stdio: 'inherit' })
// stopping 时子进程多半是被信号带走的（code 为 null），统一成 130
child.on('close', (code) => finish(stopping ? 130 : (code ?? 1)))
child.on('error', (err) => {
  console.error(`[e2e:clean] 启动 e2e 失败：${err.message}`)
  finish(1)
})
/*
 * 异常中断也要还原，否则 .env 会一直以 .env.e2e-clean-bak 的名字躺着。
 * 先转发信号给子进程，等它收尾（它负责杀 5173/8787 的 dev/API server）；
 * 3s 内没退干净再直接还原退出，避免孤儿进程一直占着端口。
 */
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (stopping) return
    stopping = true
    child.kill(sig)
    setTimeout(() => finish(130), 3000).unref()
  })
}
