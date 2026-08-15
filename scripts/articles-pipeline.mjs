/**
 * 文章数据管线：Word (.docx) → SQLite → 生成源码数据
 *
 * 用法：
 *   node scripts/articles-pipeline.mjs import   解析 docx 写入 data/articles.db
 *   node scripts/articles-pipeline.mjs gen      从 data/articles.db 生成 src/data/articlesParsed.ts
 *   node scripts/articles-pipeline.mjs all      import + gen
 *
 * 依赖：node:sqlite（Node 22.5+ 内置）、mammoth（devDependency）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'
import mammoth from 'mammoth'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(__dirname)
const DB_PATH = `${ROOT}/data/articles.db`
const OUT_PATH = `${ROOT}/src/data/articlesParsed.ts`

/** 年编 docx 文件（可按需增删） */
const SOURCES = [
  { file: '/Users/nif/Documents/人民时评/人民日报评论年编2025（人民时评）.docx', column: '人民时评' },
  { file: '/Users/nif/Documents/人民时评/人民日报评论年编2025（人民论坛） .docx', column: '人民论坛' },
  { file: '/Users/nif/Documents/人民时评/人民日报评论年编2025（人民观点） .docx', column: '人民观点' },
  { file: '/Users/nif/Documents/人民时评/人民日报评论年编2025（评论员观察） .docx', column: '评论员观察' },
]

const pad = (n) => String(n).padStart(2, '0')

/** 标题关键词 → 主题（优先级从高到低） */
const TOPIC_RULES = [
  ['生态文明', ['生态', '绿色', '环境', '碳', '气候', '黄河', '长江', '森林', '湿地', '降碳', '节能']],
  ['科技创新', ['科技', '创新', '人工智能', '芯片', '算力', '数字', '算法', '机器人', '量子', '卫星', '航天']],
  ['教育人才', ['教育', '人才', '教师', '学生', '校园', '高校', '学子', '学习', '读书', '院士']],
  ['文化自信', ['文化', '非遗', '遗产', '文艺', '阅读', '博物馆', '传统', '文明', '戏曲', '典籍', '文物', '书店', '书法']],
  ['乡村振兴', ['乡村', '农村', '农民', '农业', '振兴', '县域', '农田', '粮食', '农产品', '种粮']],
  ['基层治理', ['基层', '社区', '干部', '街道', '网格', '驻村', '村务', '小巷', '服务群众']],
  ['民生保障', ['民生', '养老', '医疗', '就业', '社保', '医保', '住房', '托育', '生育', '健康']],
  ['经济发展', ['经济', '产业', '消费', '市场', '企业', '营商', '金融', '投资', '民营', '制造业', '外贸']],
  ['法治建设', ['法治', '法律', '司法', '法院', '检察', '条例', '法规', '立法', '执法', '公平正义']],
  ['对外开放', ['开放', '出口', '进口', '一带一路', '国际', '全球', '贸易', '外资']],
  ['人民立场', ['人民', '群众', '民心', '百姓', '基层民众']],
]

function classifyTopic(text) {
  const t = text ?? ''
  for (const [topic, kws] of TOPIC_RULES) {
    if (kws.some((k) => t.includes(k))) return topic
  }
  return '时政评论'
}

/** 解析单个 docx → 文章块列表 */
async function parseDocx(file, column) {
  const buf = readFileSync(file)
  const result = await mammoth.extractRawText({ buffer: buf })
  let text = result.value
  // 截断前言（四份年编前言均以“2026年1月”结尾），之后开始是第一篇正文
  const pre = text.indexOf('2026年1月')
  if (pre >= 0) text = text.slice(pre)

  const lines = text
    .split('\n')
    .map((l) => l.replace(/\u3000/g, ' ').trim())
    .filter((l) => l.length > 0)
  // 丢弃前言的“编辑说明日期”（如 2026年1月），避免被当成首篇文章标题
  while (lines.length > 0 && /^20\d{2}年\d{1,2}月$/.test(lines[0])) lines.shift()

  const blocks = []
  let cur = []
  for (const line of lines) {
    const m = line.match(/^（(20\d{2})年(\d{1,2})月(\d{1,2})日）$/)
    if (m) {
      if (cur.length > 0) {
        blocks.push({ lines: cur, date: `${m[1]}-${pad(m[2])}-${pad(m[3])}` })
      }
      cur = []
    } else {
      cur.push(line)
    }
  }

  return blocks.map((b) => {
    const title = b.lines[0]
    let rest = b.lines.slice(1)
    // 作者行：≤6 字符且不含句子标点
    if (rest.length > 0 && rest[0].length <= 6 && !/[。！？；，,、：:]/.test(rest[0])) {
      rest = rest.slice(1)
    }
    // 导语：下一短行（≤80 字符）且不以句号结尾
    let summary = ''
    if (rest.length > 0 && rest[0].length <= 80 && !rest[0].endsWith('。')) {
      summary = rest[0]
      rest = rest.slice(1)
    }
    return {
      title,
      summary,
      content: rest,
      source: '人民日报',
      topic: classifyTopic(`${title} ${summary} ${rest[0] ?? ''}`),
      date: b.date,
      column,
    }
  })
}

function openDb() {
  const db = new DatabaseSync(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
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
    );
  `)
  return db
}

function computeReadTime(content) {
  const chars = content.join('').length + 200
  return Math.max(3, Math.round(chars / 380))
}

/** 子命令：import */
async function cmdImport() {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  const db = openDb()
  const existing = new Set(db.prepare('SELECT title FROM articles').all().map((r) => r.title))
  let total = 0
  let skipped = 0
  let seq = 0
  for (const src of SOURCES) {
    console.log(`解析 ${src.column}: ${src.file.split('/').pop()}`)
    const blocks = await parseDocx(src.file, src.column)
    const ins = db.prepare(
      `INSERT OR IGNORE INTO articles (id, title, summary, source, topic, date, column_name, content_json, read_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const b of blocks) {
      if (!b.title || b.content.length === 0) continue
      if (existing.has(b.title)) {
        skipped++
        continue
      }
      seq += 1
      const id = `p${String(seq).padStart(4, '0')}`
      ins.run(id, b.title, b.summary, b.source, b.topic, b.date, b.column, JSON.stringify(b.content), computeReadTime(b.content))
      existing.add(b.title)
      total++
    }
    console.log(`  → ${blocks.length} 块，入库 ${blocks.filter((x) => x.title && x.content.length).length}，跳过重复 ${blocks.filter((x) => existing.has(x.title)).length}`)
  }
  console.log(`\n合计入库 ${total} 篇，跳过重复 ${skipped} 篇 → ${DB_PATH}`)
  db.close()
}

/** 子命令：gen */
function cmdGen() {
  if (!existsSync(DB_PATH)) {
    console.error(`数据库不存在：${DB_PATH}，先运行 import`)
    process.exit(1)
  }
  const db = openDb()
  const rows = db
    .prepare('SELECT id, title, summary, source, topic, date, content_json, read_time, pullquote, finish_note FROM articles ORDER BY date DESC, id')
    .all()
  const lines = rows.map((r) => {
    const content = JSON.parse(r.content_json)
    return `  {
    id: '${r.id}',
    title: ${JSON.stringify(r.title)},
    summary: ${JSON.stringify(r.summary)},
    content: ${JSON.stringify(content)},
    source: '${r.source}',
    topic: '${r.topic}',
    date: '${r.date}',
    readTime: ${r.read_time},
    ${r.pullquote ? `pullquote: ${JSON.stringify(r.pullquote)},` : ''}
    ${r.finish_note ? `finishNote: ${JSON.stringify(r.finish_note)},` : ''}
  }`
  })
  const header = `/* eslint-disable */
// ⚠️ 本文件由 scripts/articles-pipeline.mjs 从 data/articles.db 自动生成，请勿手改。
// 重新生成：npm run db:all
import type { Article } from '../types'

export const PARSED_ARTICLES: Article[] = [
`
  writeFileSync(OUT_PATH, header + lines.join(',\n') + '\n]\n')
  console.log(`已生成 ${rows.length} 篇文章 → ${OUT_PATH}`)
  db.close()
}

const cmd = process.argv[2] ?? 'all'
if (cmd === 'import') await cmdImport()
else if (cmd === 'gen') cmdGen()
else if (cmd === 'all') {
  await cmdImport()
  cmdGen()
} else {
  console.error('用法: node scripts/articles-pipeline.mjs [import|gen|all]')
  process.exit(1)
}
