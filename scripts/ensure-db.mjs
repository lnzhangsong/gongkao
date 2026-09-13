#!/usr/bin/env node
/**
 * 确保 data/articles.db 存在：库里的一切都由 data/ 下的可读源推导
 * （见 scripts/rebuild-db.mjs），所以这个文件现在是**构建产物**、不再进 git。
 *
 * 缺失时调 rebuild-db 生成；已存在则直接返回（幂等、开销只是一次 existsSync）。
 * 被 build / dev:api / 测试 globalSetup 共用，保证「clone 下来直接跑」可用。
 *
 * 用法：node scripts/ensure-db.mjs [--db data/articles.db]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  if (i === -1) return path.join(ROOT, fallback)
  const v = process.argv[i + 1]
  return path.isAbsolute(v) ? v : path.join(ROOT, v)
}
const DB = argOf('--db', 'data/articles.db')

if (fs.existsSync(DB)) process.exit(0)

console.log(`data/articles.db 不存在（构建产物、未进 git），从 data/ 下的源重建…`)
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'rebuild-db.mjs'), '--db', DB], {
  cwd: ROOT,
  stdio: 'inherit',
})
