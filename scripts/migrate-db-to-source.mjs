#!/usr/bin/env node
/**
 * 库 → 源：把 data/articles.db 的当前状态导回仓库内的可读源（单向数据流里「回写」那一侧）。
 *
 *   articles                   → data/articles/{id}.json
 *   guifan_terms               → data/guifan-terms.json
 *   papers/materials/questions → data/shenlun/{id}.json
 *
 * 什么时候会用到：
 *  - 本地管理 UI 改了数据（正常情况 api-server 会即时写穿，这里是兜底/修复）；
 *  - 手工改过库、或想确认「库 → 源」不会产生意外 diff（幂等，跑完 git diff 应为空）。
 *
 * 用法：
 *   node scripts/migrate-db-to-source.mjs            # 导出（覆盖写源）
 *   node scripts/migrate-db-to-source.mjs --check    # 只校验：源与库逐字节一致？不一致 exit 1
 *
 * 保真：三种源都能逐字节还原（见 scripts/lib/export-source.mjs），所以正常导出不会产生假 diff。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  articleToSource,
  exportArticles,
  exportGuifanTerms,
  exportShenlunAll,
  formatSource,
  shenlunPaperToSource,
  shenlunSourceFile,
} from './lib/export-source.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  if (i === -1) return path.join(ROOT, fallback)
  const v = process.argv[i + 1]
  return path.isAbsolute(v) ? v : path.join(ROOT, v)
}
const DB = argOf('--db', 'data/articles.db')
const ARTICLES_DIR = argOf('--articles', 'data/articles')
const TERMS_FILE = argOf('--terms', 'data/guifan-terms.json')
const SHENLUN_DIR = argOf('--shenlun', 'data/shenlun')
const CHECK = process.argv.includes('--check')

const db = new DatabaseSync(DB, { readOnly: true })

if (CHECK) {
  const problems = []
  const expect = (file, data) => {
    const want = formatSource(data)
    let got = null
    try {
      got = fs.readFileSync(file, 'utf8')
    } catch {
      /* 文件缺失 → 记为不一致 */
    }
    if (got !== want) problems.push(path.relative(ROOT, file))
  }

  const articleRows = db.prepare('SELECT * FROM articles ORDER BY id').all()
  for (const r of articleRows) expect(path.join(ARTICLES_DIR, `${r.id}.json`), articleToSource(r))
  expect(TERMS_FILE, db.prepare('SELECT id, theme, term, example FROM guifan_terms ORDER BY id').all())

  const papers = db.prepare('SELECT id FROM papers ORDER BY year, level').all()
  const known = new Set()
  for (const { id } of papers) {
    known.add(`${id}.json`)
    expect(shenlunSourceFile(SHENLUN_DIR, id), shenlunPaperToSource(db, id))
  }
  /* 反向：源目录里有、库里没有的卷（重建时会被忽略，属漂移） */
  if (fs.existsSync(SHENLUN_DIR)) {
    for (const f of fs.readdirSync(SHENLUN_DIR)) {
      if (f.endsWith('.json') && !known.has(f)) problems.push(`data/shenlun/${f}（库中无此卷）`)
    }
  }
  db.close()

  if (problems.length) {
    console.error(`✗ 源与库不一致（${problems.length} 处）：\n  - ${problems.slice(0, 10).join('\n  - ')}`)
    console.error('  改源后用 `vp run db:rebuild` 重建库；改库后用 `node scripts/migrate-db-to-source.mjs` 写回源。')
    process.exit(1)
  }
  console.log(`✓ 源与库逐字节一致（articles ${articleRows.length} · 规范词 · 申论 ${papers.length}）`)
  process.exit(0)
}

const nA = exportArticles(db, ARTICLES_DIR)
const nT = exportGuifanTerms(db, TERMS_FILE)
const nP = exportShenlunAll(db, SHENLUN_DIR)
db.close()

console.log(`articles: ${nA} 篇 → ${path.relative(ROOT, ARTICLES_DIR)}/`)
console.log(`guifan_terms: ${nT} 条 → ${path.relative(ROOT, TERMS_FILE)}`)
console.log(`申论试卷: ${nP} 卷 → ${path.relative(ROOT, SHENLUN_DIR)}/`)
console.log('（幂等：源本来就是库导出的，重复跑不会有 diff）')
