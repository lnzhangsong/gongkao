#!/usr/bin/env node
/**
 * 申论规范词入库
 *
 * 数据源：申论规范词合集（去重合并版）.md（7 份文档去重合并，~3000 条）
 *   结构：「## 一、主题（N 条）」分节，条目为「N. **词** 〔n源〕」+ 缩进「例：……」
 * 产出：data/articles.db 新增 guifan_terms 表（与文章/真题同库，Vercel 单文件打包）
 *
 * 用法：node scripts/import-guifanci.mjs [--src <md路径>] [--db <输出db>] [--dry]
 * 幂等：每次全量重建 guifan_terms 表。
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = process.argv.includes('--src')
  ? path.resolve(process.argv[process.argv.indexOf('--src') + 1])
  : '/Users/nif/Documents/人民时评/【01】国考真题资料_AI解析/2026申论规范词合集【保存自己网盘再打开】/申论规范词合集（去重合并版）.md'
const DB = process.argv.includes('--db')
  ? path.resolve(process.argv[process.argv.indexOf('--db') + 1])
  : path.join(ROOT, 'data/articles.db')
const DRY = process.argv.includes('--dry')

const md = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')

// ---------- 解析 ----------

const terms = []
let theme = ''
let cur = null // { theme, term, exampleLines[] }

const flush = () => {
  if (!cur) return
  const example = cur.exampleLines.join(' ').replace(/\s+/g, ' ').trim()
  terms.push({ theme: cur.theme, term: cur.term, example })
  cur = null
}

for (const line of md.split('\n')) {
  // 主题分节：## 一、思想认识（41 条）
  const sec = /^#{2,3}\s+[一二三四五六七八九十\d]+[、.]\s*(.+?)\s*(?:（\d+\s*条）)?\s*$/.exec(line)
  if (sec) {
    flush()
    theme = sec[1].trim()
    continue
  }
  // 条目头：1. **责任意识** 〔2源〕（〔n源〕可省略）
  const head = /^\s*\d+[.、]\s*\*\*(.+?)\*\*\s*(?:〔(\d+)源〕)?\s*$/.exec(line)
  if (head) {
    flush()
    cur = { theme, term: head[1].trim(), exampleLines: [] }
    continue
  }
  // 例句行（缩进「例：」，可能折行）
  if (cur) {
    const ex = /^\s*(?:例[:：]\s*)?(.*)$/.exec(line)
    if (ex && line.startsWith('   ') && line.trim()) cur.exampleLines.push(ex[1].trim())
  }
}
flush()

// ---------- 入库 ----------

const byTheme = new Map()
for (const t of terms) byTheme.set(t.theme, (byTheme.get(t.theme) ?? 0) + 1)
console.log(`解析 ${terms.length} 条，${byTheme.size} 个主题：`)
for (const [k, v] of byTheme) console.log(`  ${k}: ${v}`)

if (DRY) {
  console.log('--dry，抽查 3 条：')
  console.log(JSON.stringify(terms.slice(0, 3), null, 2))
  process.exit(0)
}

const db = new DatabaseSync(DB)
db.exec('DROP TABLE IF EXISTS guifan_terms')
db.exec(`CREATE TABLE guifan_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme TEXT NOT NULL,
  term TEXT NOT NULL,
  example TEXT NOT NULL DEFAULT ''
)`)
const ins = db.prepare('INSERT INTO guifan_terms (theme, term, example) VALUES (?, ?, ?)')
db.exec('BEGIN')
for (const t of terms) ins.run(t.theme, t.term, t.example)
db.exec('COMMIT')
const total = db.prepare('SELECT COUNT(*) AS n FROM guifan_terms').get().n
console.log(`已写入 ${DB} → guifan_terms ${total} 条`)
