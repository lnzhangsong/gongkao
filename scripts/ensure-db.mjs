#!/usr/bin/env node
/**
 * 确保 data/articles.db 存在且**完整**：库里的一切都由 data/ 下的可读源推导
 * （见 scripts/rebuild-db.mjs），所以这个文件现在是**构建产物**、不再进 git。
 *
 * 为什么不能只看文件在不在：单独跑某个 importer（如 `node scripts/import-articles.mjs`）
 * 会凭空建出一个「只有一张表的半个库」，之后测试/接口报 `no such table` 这类迷惑错误。
 * 所以这里校验关键表齐全且内容非空，不满足就当没有、重新生成。
 *
 * 幂等、开销只是一次只读打开；被 build / api-server 启动 / 测试 globalSetup 共用。
 *
 * 用法：node scripts/ensure-db.mjs [--db data/articles.db]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = path.resolve(import.meta.dirname, '..')
const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  if (i === -1) return path.join(ROOT, fallback)
  const v = process.argv[i + 1]
  return path.isAbsolute(v) ? v : path.join(ROOT, v)
}
const DB = argOf('--db', 'data/articles.db')

/** 重建链应当产出的全部表（articles_fts 是 FTS5 虚表，代表索引建好了） */
const REQUIRED_TABLES = [
  'articles',
  'guifan_terms',
  'papers',
  'materials',
  'questions',
  'xg_papers',
  'xg_questions',
  'articles_fts',
]
/** 这些表为空说明不是「重建链的产物」，而是某个 importer 单独跑出来的残件 */
const NON_EMPTY_TABLES = ['articles', 'papers', 'xg_papers']

function dbIsComplete() {
  if (!fs.existsSync(DB)) return false
  let db
  try {
    db = new DatabaseSync(DB, { readOnly: true })
    const have = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name),
    )
    if (!REQUIRED_TABLES.every((t) => have.has(t))) return false
    return NON_EMPTY_TABLES.every((t) => db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n > 0)
  } catch {
    return false // 打不开 / 损坏，一律当不完整
  } finally {
    db?.close()
  }
}

if (dbIsComplete()) process.exit(0)

console.log('data/articles.db 缺失或不完整（它是构建产物、未进 git），从 data/ 下的源重建…')
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'rebuild-db.mjs'), '--db', DB], {
  cwd: ROOT,
  stdio: 'inherit',
})
