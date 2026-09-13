#!/usr/bin/env node
/**
 * 一次性迁移：把 data/articles.db 里**没有可复现源**的两张表反导成可读源文件。
 *
 *   articles       → data/articles/{id}.json   每篇一个文件（与 data/shenlun、data/xingce 同惯例）
 *   guifan_terms   → data/guifan-terms.json    规范词全集
 *
 * 背景：articles 的原始管线（docx → SQLite → src/data/articlesParsed.ts）在 5a9afc3 里被删，
 * 源 docx 在仓库外（/Users/nif/…），此后 DB 成了唯一副本；guifan_terms 的源 md 同样在仓库外。
 * 反导之后两者都有仓库内的可读源，库可由 scripts/rebuild-db.mjs 重建（库 = 产物）。
 *
 * 用法：node scripts/migrate-db-to-source.mjs [--db data/articles.db] [--articles data/articles] [--terms data/guifan-terms.json]
 */
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
const ARTICLES_DIR = argOf('--articles', 'data/articles')
const TERMS_FILE = argOf('--terms', 'data/guifan-terms.json')

const db = new DatabaseSync(DB, { readOnly: true })

/* ---------- articles → data/articles/{id}.json ---------- */

/** 源文件字段显式写全（含 null），键序固定：schema 自解释、diff 稳定、round-trip 无损 */
function articleToSource(r) {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    source: r.source,
    topic: r.topic,
    column: r.column_name,
    date: r.date,
    readTime: r.read_time,
    content: JSON.parse(r.content_json),
    pullquote: r.pullquote,
    finishNote: r.finish_note,
    featured: Boolean(r.featured),
  }
}

fs.rmSync(ARTICLES_DIR, { recursive: true, force: true })
fs.mkdirSync(ARTICLES_DIR, { recursive: true })

const articles = db.prepare('SELECT * FROM articles ORDER BY id').all()
let articleBytes = 0
for (const r of articles) {
  const body = JSON.stringify(articleToSource(r), null, 2) + '\n'
  fs.writeFileSync(path.join(ARTICLES_DIR, `${r.id}.json`), body)
  articleBytes += Buffer.byteLength(body)
}

/* ---------- guifan_terms → data/guifan-terms.json ---------- */

/* id 有空洞（1..3043 共 3039 条，本地增删留下的），必须显式带上：重建时按 id 原样写回，
   否则 AUTOINCREMENT 会重新编号，前端 TermHighlight 的 term-seen 事件 id 就对不上了 */
const terms = db.prepare('SELECT id, theme, term, example FROM guifan_terms ORDER BY id').all()
const termsBody = JSON.stringify(terms, null, 2) + '\n'
fs.mkdirSync(path.dirname(TERMS_FILE), { recursive: true })
fs.writeFileSync(TERMS_FILE, termsBody)

db.close()

const mb = (n) => (n / 1048576).toFixed(2) + ' MB'
console.log(`articles: ${articles.length} 篇 → ${path.relative(ROOT, ARTICLES_DIR)}/（${mb(articleBytes)}）`)
console.log(
  `guifan_terms: ${terms.length} 条 → ${path.relative(ROOT, TERMS_FILE)}（${mb(Buffer.byteLength(termsBody))}）`,
)
