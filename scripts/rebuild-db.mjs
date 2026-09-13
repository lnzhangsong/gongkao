#!/usr/bin/env node
/**
 * 从仓库内的可读源重建数据库（库里的一切都由 git 里的源推导出来 → 库 = 产物）
 *
 * 源 → 表：
 *   data/shenlun/*.json      papers / materials / questions    （申论真题）
 *   data/xingce/*.json       xg_papers / xg_questions          （行测真题）
 *   data/articles/*.json     articles                          （人民日报文章）
 *   data/guifan-terms.json   guifan_terms                      （规范词）
 *   articles_fts             派生索引，由 migrate-fts.mjs 全量重建
 *
 * 用法：node scripts/rebuild-db.mjs [--db data/articles.db]
 * 流程：删掉目标库 → import-shenlun → import-xingce → import-articles → import-guifanci → migrate-fts
 *       （每一步都带 --db；任一步失败即中断，不做半成品）
 * 注意：import-xingce 会顺带重写 src/data/xingceImageDims.generated.ts（内容确定，正常无 diff）。
 *
 * 重建出的库里，二进制页面布局与旧库不会逐字节相同，但**逻辑内容一致**；
 * 用 scripts/rebuild-db.mjs --db /tmp/x.db 重建后可与现库逐表比对（见 src/lib/dbSource.test.ts）。
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

/* 防呆：重建会先删目标库。**相对路径**必须落在仓库内（挡住 --db ../.. 这类手滑）；
   绝对路径视为显式选择（如 --db /tmp/rebuild.db 用于比对），放行。 */
const rawDb = process.argv.includes('--db') ? process.argv[process.argv.indexOf('--db') + 1] : null
if (rawDb !== null && !path.isAbsolute(rawDb)) {
  const rel = path.relative(ROOT, DB)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    console.error(`✗ 相对路径的目标库必须位于仓库内：${DB}`)
    process.exit(1)
  }
}

const STEPS = [
  ['import-shenlun.mjs', '申论真题'],
  ['import-xingce.mjs', '行测真题'],
  ['import-articles.mjs', '人民日报文章'],
  ['import-guifanci.mjs', '规范词'],
  ['migrate-fts.mjs', '全文索引'],
]

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB + suffix, { force: true })

for (const [script, label] of STEPS) {
  console.log(`\n── ${label}（${script}）`)
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', script), '--db', DB], { cwd: ROOT, stdio: 'inherit' })
}

const db = new DatabaseSync(DB, { readOnly: true })
const counts = [
  'articles',
  'guifan_terms',
  'papers',
  'materials',
  'questions',
  'xg_papers',
  'xg_questions',
  'articles_fts',
]
  .map((t) => `${t} ${db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n}`)
  .join(' · ')
const journal = db.prepare('PRAGMA journal_mode').get().journal_mode
db.close()
console.log(`\n✓ 重建完成：${path.relative(ROOT, DB)}（${counts}；journal_mode=${journal}）`)
