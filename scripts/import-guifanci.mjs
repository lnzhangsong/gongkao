#!/usr/bin/env node
/**
 * 申论规范词入库
 *
 * 数据源（两种，按扩展名分流）：
 *  1. data/guifan-terms.json（默认）—— 仓库内源，[{id, theme, term, example}]，重建走这份
 *  2. 申论规范词合集（去重合并版）.md —— 上游原始文档（7 份去重合并，~3000 条，**在仓库外**）：
 *     「## 一、主题（N 条）」分节，条目为「N. **词** 〔n源〕」+ 缩进「例：……」。
 *     仅在需要重新生成 data/guifan-terms.json 时用：--src <md> 后自行反导。
 * 产出：data/articles.db 的 guifan_terms 表（与文章/真题同库，Vercel 单文件打包）
 *
 * 用法：node scripts/import-guifanci.mjs [--src <json|md>] [--db <输出db>] [--dry]
 * 幂等：每次全量重建 guifan_terms 表。
 * 注意：id 必须原样写回——本地增删导致 id 有空洞（1..3043 共 3039 条），
 *       重新编号会让前端 term-seen 事件里记录的 id 对不上。
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = process.argv.includes('--src')
  ? path.resolve(process.argv[process.argv.indexOf('--src') + 1])
  : path.join(ROOT, 'data/guifan-terms.json')
const DB = process.argv.includes('--db')
  ? path.resolve(process.argv[process.argv.indexOf('--db') + 1])
  : path.join(ROOT, 'data/articles.db')
const DRY = process.argv.includes('--dry')

const raw = fs.readFileSync(SRC, 'utf8')

// ---------- 解析 ----------

let terms
if (SRC.endsWith('.json')) {
  /* 仓库内源：带 id，入库时显式写回（见文件头「注意」） */
  terms = JSON.parse(raw)
  if (!Array.isArray(terms)) {
    console.error(`✗ ${SRC} 应是 [{id,theme,term,example}] 数组`)
    process.exit(1)
  }
} else {
  /* 上游 md：解析出 {theme, term, example}，id 交给 AUTOINCREMENT */
  const md = raw.replace(/\r\n/g, '\n')
  terms = []
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
}

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
/* 带 id 的源（data/guifan-terms.json）显式写回、保住 id 空洞；md 源无 id，交给 AUTOINCREMENT */
const withId = terms.every((t) => Number.isInteger(t.id))
const ins = withId
  ? db.prepare('INSERT INTO guifan_terms (id, theme, term, example) VALUES (?, ?, ?, ?)')
  : db.prepare('INSERT INTO guifan_terms (theme, term, example) VALUES (?, ?, ?)')
db.exec('BEGIN')
for (const t of terms) {
  if (withId) ins.run(t.id, t.theme, t.term, t.example ?? '')
  else ins.run(t.theme, t.term, t.example ?? '')
}
db.exec('COMMIT')
const total = db.prepare('SELECT COUNT(*) AS n FROM guifan_terms').get().n
console.log(`已写入 ${DB} → guifan_terms ${total} 条`)
