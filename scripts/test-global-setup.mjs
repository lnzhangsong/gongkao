/**
 * vitest 全局 setup：测试大量读 data/articles.db（api/*.test.ts、dbArtifact、dbSource…），
 * 而它现在是构建产物、未进 git。这里在跑测试前确保它存在（缺失时从 data/ 下的源重建一次）。
 * 已存在则跳过——所以本地的「源 ↔ 库」漂移守卫仍然有意义（不会被无脑重建掩盖）。
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function setup() {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'ensure-db.mjs')], { cwd: ROOT, stdio: 'inherit' })
}
