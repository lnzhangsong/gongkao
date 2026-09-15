#!/usr/bin/env node
/**
 * 《申论写作八讲》方法论书入库
 *
 * 数据源：data/shenlun-book/（仓库内，由 scripts/parse-shenlun-book.py 从本地 EPUB 生成）：
 *   book.json   { id, title, author, cover?, lectures[], units[] }——units 是「标题+内容块」
 *               的渲染单元（level 1=讲导语/2=节/3=目；kind=summary 为各节小结），blocks
 *               为 p/sig/center/img 内容块数组
 *   images/     图示（模型图/参考答案/例文扫描图，webp）
 * 产出：data/articles.db 的 shenlun_book（meta）+ shenlun_book_units（渲染单元）两表
 *       （与文章/真题/规范词同库，Vercel 单文件打包）。
 *
 * 用法：node scripts/import-shenlun-book.mjs [--src data/shenlun-book] [--db data/articles.db] [--dry]
 * 幂等：每次全量重建两张表。
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC_DIR = process.argv.includes('--src')
  ? path.resolve(process.argv[process.argv.indexOf('--src') + 1])
  : path.join(ROOT, 'data/shenlun-book')
const DB = process.argv.includes('--db')
  ? path.resolve(process.argv[process.argv.indexOf('--db') + 1])
  : path.join(ROOT, 'data/articles.db')
const DRY = process.argv.includes('--dry')

const book = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'book.json'), 'utf8'))
if (!Array.isArray(book.lectures) || !Array.isArray(book.units) || !book.units.length) {
  console.error(`✗ ${SRC_DIR}/book.json 缺少 lectures/units 数组——先跑 scripts/parse-shenlun-book.py`)
  process.exit(1)
}
for (const u of book.units) {
  if (!Array.isArray(u.blocks) || !u.blocks.length) {
    console.error(`✗ 单元 ${u.id} blocks 为空——解析切错了，回到 parse-shenlun-book.py 排查`)
    process.exit(1)
  }
  for (const b of u.blocks) {
    if (b.type !== 'img') continue
    // 引用与文件必须一致（同 import-xingce 的图片检查）
    if (!fs.existsSync(path.join(SRC_DIR, b.src))) {
      console.error(`✗ 单元 ${u.id} 引用的图片不存在：${b.src}`)
      process.exit(1)
    }
  }
}

const summaryCount = book.units.filter((u) => u.kind === 'summary').length
const imgCount = book.units.reduce((n, u) => n + u.blocks.filter((b) => b.type === 'img').length, 0)
console.log(
  `解析《${book.title}》：${book.lectures.length} 讲 / ${book.units.length} 单元` +
    `（${summaryCount} 小结）/ ${imgCount} 图`,
)

if (DRY) {
  console.log('--dry，抽查第 1 个单元：')
  console.log(JSON.stringify(book.units[0], null, 2).slice(0, 600))
  process.exit(0)
}

const db = new DatabaseSync(DB)
db.exec('DROP TABLE IF EXISTS shenlun_book')
db.exec('DROP TABLE IF EXISTS shenlun_book_units')
db.exec(`CREATE TABLE shenlun_book (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`)
db.exec(`CREATE TABLE shenlun_book_units (
  id TEXT PRIMARY KEY,
  lecture INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  level INTEGER NOT NULL,
  title TEXT,
  kind TEXT,
  blocks_json TEXT NOT NULL
)`)
db.exec('BEGIN')
db.prepare('INSERT INTO shenlun_book (key, value) VALUES (?, ?)').run(
  'meta',
  JSON.stringify({
    id: book.id,
    title: book.title,
    author: book.author,
    ...(book.cover ? { cover: book.cover } : {}),
    lectures: book.lectures,
  }),
)
const ins = db.prepare(
  'INSERT INTO shenlun_book_units (id, lecture, idx, level, title, kind, blocks_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
)
for (const u of book.units) {
  ins.run(u.id, u.lecture, u.idx, u.level, u.title, u.kind, JSON.stringify(u.blocks))
}
db.exec('COMMIT')
const total = db.prepare('SELECT COUNT(*) AS n FROM shenlun_book_units').get().n
console.log(`已写入 ${DB} → shenlun_book 1 行 meta + shenlun_book_units ${total} 行`)
