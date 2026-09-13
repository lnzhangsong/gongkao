#!/usr/bin/env node
/**
 * 人民日报文章入库（data/articles/*.json → articles 表）
 *
 * 源格式：每篇一个 JSON，字段与 scripts/migrate-db-to-source.mjs 的 articleToSource() 对应：
 *   { id, title, summary, source, topic, column, date, readTime, content[], pullquote?, finishNote?, featured? }
 * 幂等：全量重建（DELETE 后按 id 顺序重灌）。id 顺序与原库 rowid 顺序一致；
 *       articles_fts 触发器会跟着写入，最终由 scripts/migrate-fts.mjs 全量重建索引。
 *
 * 用法：node scripts/import-articles.mjs [--src data/articles] [--db data/articles.db] [--dry]
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
const SRC = argOf('--src', 'data/articles')
const DB = argOf('--db', 'data/articles.db')
const DRY = process.argv.includes('--dry')

if (!fs.existsSync(SRC)) {
  console.error(`源目录不存在：${SRC}`)
  process.exit(1)
}

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.json'))
if (!files.length) {
  console.error(`${SRC} 下没有 .json`)
  process.exit(1)
}

const errs = []
const articles = []
for (const file of files) {
  const at = path.join(SRC, file)
  let a
  try {
    a = JSON.parse(fs.readFileSync(at, 'utf8'))
  } catch (err) {
    errs.push(`${file}: JSON 解析失败（${err.message}）`)
    continue
  }
  for (const k of ['id', 'title', 'source', 'topic', 'date']) {
    if (typeof a[k] !== 'string' || !a[k]) errs.push(`${file}: ${k} 缺失或非字符串`)
  }
  if (!Array.isArray(a.content)) errs.push(`${file}: content 必须是段落数组`)
  if (!Number.isInteger(a.readTime) || a.readTime <= 0) errs.push(`${file}: readTime 必须是正整数`)
  if (a.id && file !== `${a.id}.json`) errs.push(`${file}: 文件名与 id（${a.id}）不一致`)
  articles.push(a)
}

/* id 唯一 */
const seen = new Set()
for (const a of articles) {
  if (seen.has(a.id)) errs.push(`id 重复：${a.id}`)
  seen.add(a.id)
}

if (errs.length) {
  console.error(`✗ ${errs.length} 处数据问题：\n  - ${errs.slice(0, 10).join('\n  - ')}`)
  process.exit(1)
}

articles.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))

if (DRY) {
  console.log(`✓ 校验通过（dry）：${articles.length} 篇，id ${articles[0].id} … ${articles.at(-1).id}`)
  process.exit(0)
}

const db = new DatabaseSync(DB)
db.exec(`CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  topic TEXT NOT NULL,
  date TEXT NOT NULL,
  column_name TEXT NOT NULL DEFAULT '',
  content_json TEXT NOT NULL,
  read_time INTEGER NOT NULL,
  pullquote TEXT,
  finish_note TEXT,
  featured INTEGER NOT NULL DEFAULT 0
)`)

const ins = db.prepare(
  `INSERT INTO articles (id, title, summary, source, topic, date, column_name, content_json, read_time, pullquote, finish_note, featured)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
db.exec('BEGIN')
try {
  db.prepare('DELETE FROM articles').run()
  for (const a of articles) {
    ins.run(
      a.id,
      a.title,
      a.summary ?? '',
      a.source,
      a.topic,
      a.date,
      a.column ?? '',
      JSON.stringify(a.content),
      a.readTime,
      a.pullquote ?? null,
      a.finishNote ?? null,
      a.featured ? 1 : 0,
    )
  }
  db.exec('COMMIT')
} catch (err) {
  db.exec('ROLLBACK')
  console.error(`✗ 入库失败：${err.message}`)
  db.close()
  process.exit(1)
}
const total = db.prepare('SELECT COUNT(*) AS n FROM articles').get().n
db.close()
console.log(`✓ articles 入库 ${total} 篇 → ${path.relative(ROOT, DB)}`)
