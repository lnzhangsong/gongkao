#!/usr/bin/env node
/**
 * 行测真题结构化入库（docs/行测做题模块设计方案.md X1）
 *
 * 数据源：data/xingce/*.json —— 每个文件一套卷，结构：
 * {
 *   "id": "guokao-xingce-2025-副省级",
 *   "year": 2025,
 *   "level": "副省级",
 *   "title": "2025年国家公务员考试《行测》题（副省级）",
 *   "durationMin": 120,
 *   "questions": [
 *     {
 *       "idx": 1,
 *       "section": "常识判断",
 *       "subtype": null,
 *       "groupId": null,              // 题组：资料分析一篇材料 5 题共用 groupId + groupStem
 *       "groupStem": null,
 *       "stem": "……",
 *       "options": [{"key":"A","text":"……"}, …],
 *       "answer": "C",
 *       "explanation": "……",
 *       "image": null                  // 题图：JSON 数组字符串的 data URL（入库时落盘 data/xingce-img/{paper_id}/，db 只存路径）
 *     }, …
 *   ]
 * }
 *
 * 产出：data/articles.db 新增 xg_papers / xg_questions 两表（与申论 papers/questions 平行，互不干扰）；
 *       base64 题图/材料图写进 data/xingce-img/{paper_id}/（db 不存 base64，否则整库几十 MB 且每次入库 git 全量重写）
 *
 * 用法：node scripts/import-xingce.mjs [--src data/xingce] [--db data/articles.db] [--dry]
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const IMG_DIR = path.join(ROOT, 'data', 'xingce-img')
const argPath = (flag, fallback) => {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return path.join(ROOT, fallback)
  const v = process.argv[idx + 1]
  return path.isAbsolute(v) ? v : path.join(ROOT, v)
}
const SRC = argPath('--src', 'data/xingce')
const DB = argPath('--db', 'data/articles.db')
const DRY = process.argv.includes('--dry')

const SECTIONS = ['政治理论', '常识判断', '言语理解', '言语理解与表达', '数量关系', '判断推理', '资料分析']

function ensureTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS xg_papers (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  level TEXT NOT NULL,
  title TEXT NOT NULL,
  duration_min INTEGER,
  source_file TEXT NOT NULL UNIQUE,
  question_count INTEGER NOT NULL DEFAULT 0,
  warnings TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_xg_papers_year ON xg_papers(year);
CREATE TABLE IF NOT EXISTS xg_questions (
  paper_id TEXT NOT NULL REFERENCES xg_papers(id),
  idx INTEGER NOT NULL,
  section TEXT NOT NULL,
  subtype TEXT,
  group_id INTEGER,
  group_stem TEXT,
  stem TEXT NOT NULL,
  options TEXT NOT NULL,
  answer TEXT,
  explanation TEXT,
  image TEXT,
  PRIMARY KEY (paper_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_xg_questions_group ON xg_questions(paper_id, group_id);`)
}

function validate(paper, _file) {
  const errs = []
  const warns = []
  for (const k of ['id', 'year', 'level', 'title']) if (paper[k] === undefined) errs.push(`缺字段 ${k}`)
  if (!Array.isArray(paper.questions) || paper.questions.length === 0) errs.push('questions 为空')
  if (errs.length) return { errs, warns }
  const seen = new Set()
  for (const q of paper.questions) {
    const at = `题${q.idx}`
    if (typeof q.idx !== 'number' || seen.has(q.idx)) errs.push(`${at} idx 缺失或重复`)
    seen.add(q.idx)
    if (!SECTIONS.includes(q.section)) errs.push(`${at} section 非法：${q.section}`)
    if (!q.stem) errs.push(`${at} stem 为空`)
    const opts = q.options
    const keys = Array.isArray(opts) ? opts.map((o) => o.key) : []
    if (!Array.isArray(opts) || opts.length < 2) {
      if (!q.image) errs.push(`${at} options 少于 2 项且无配图`)
    } else {
      if (new Set(keys).size !== keys.length) errs.push(`${at} 选项 key 重复`)
      // 图片选项题（图形推理/资料分析图形题）选项正文在截图里，允许空文本
      for (const o of opts) if (!o.text && !q.image) errs.push(`${at} 选项 ${o.key} 文本为空且无配图`)
    }
    if (q.answer == null) warns.push(`第${q.idx}题答案缺失（引流版解析未收录）`)
    else if (!/^[A-E]$/.test(q.answer)) errs.push(`${at} answer 非法：${q.answer}`)
    else if (!keys.includes(q.answer)) errs.push(`${at} answer 不在选项中`)
    if ((!Array.isArray(opts) || opts.length < 2) && !q.image) errs.push(`${at} 选项少于 2 项且无配图`)
  }
  return { errs, warns }
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`数据源目录不存在：${SRC}`)
    console.error('请把行测真题 JSON 放进 data/xingce/（schema 见本文件头注释）')
    process.exit(1)
  }

  /**
   * base64 题图落盘 → 返回可入库的路径数组字符串。
   * value 是 JSON 数组字符串的 data URL；已是路径（重跑）或空值时原样返回。
   * 存量同名文件直接覆盖：文件名由卷号+题号/组号决定，重裁后内容随之更新。
   */
  function materialize(paperId, kind, key, value) {
    if (!value) return null
    let urls
    try {
      const parsed = JSON.parse(value)
      urls = Array.isArray(parsed) ? parsed : [String(parsed)]
    } catch {
      urls = [value]
    }
    if (!urls.some((u) => u.startsWith('data:'))) return value
    const dir = path.join(IMG_DIR, paperId)
    fs.mkdirSync(dir, { recursive: true })
    const paths = urls.map((u, i) => {
      const ext = u.slice(5, u.indexOf(';')).split('/')[1] || 'png'
      const file = `${kind}${key}_${i}.${ext}`
      fs.writeFileSync(path.join(dir, file), Buffer.from(u.slice(u.indexOf('base64,') + 7), 'base64'))
      return `/xingce-img/${paperId}/${file}`
    })
    return JSON.stringify(paths)
  }

  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.json'))
  if (!files.length) {
    console.error(`${SRC} 下没有 .json 文件`)
    process.exit(1)
  }
  const db = DRY ? null : new DatabaseSync(DB)
  if (db) ensureTables(db)

  let ok = 0
  for (const file of files) {
    const paper = JSON.parse(fs.readFileSync(path.join(SRC, file), 'utf8'))
    const { errs, warns } = validate(paper, file)
    if (errs.length) {
      console.error(`✗ ${file}：\n  - ${errs.join('\n  - ')}`)
      continue
    }
    if (DRY) {
      console.log(`✓ ${file}（dry）：${paper.title}，${paper.questions.length} 题`)
      ok++
      continue
    }
    db.prepare('BEGIN').run()
    try {
      const warnings = warns.length ? [...(paper.warnings ?? []), ...warns].join('\n') : (paper.warnings ?? null)
      db.prepare(
        `INSERT INTO xg_papers (id, year, level, title, duration_min, source_file, question_count, warnings)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET year=excluded.year, level=excluded.level, title=excluded.title,
           duration_min=excluded.duration_min, source_file=excluded.source_file, question_count=excluded.question_count,
           warnings=excluded.warnings`,
      ).run(
        paper.id,
        paper.year,
        paper.level,
        paper.title,
        paper.durationMin ?? null,
        file,
        paper.questions.length,
        warnings,
      )
      db.prepare('DELETE FROM xg_questions WHERE paper_id = ?').run(paper.id)
      const ins = db.prepare(
        `INSERT INTO xg_questions (paper_id, idx, section, subtype, group_id, group_stem, group_image, stem, options, answer, explanation, image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const q of paper.questions) {
        ins.run(
          paper.id,
          q.idx,
          q.section,
          q.subtype ?? null,
          q.groupId ?? null,
          q.groupStem ?? null,
          materialize(paper.id, 'g', q.groupId ?? q.idx, q.groupImage ?? null),
          q.stem,
          JSON.stringify(q.options),
          q.answer ?? null,
          q.explanation ?? null,
          materialize(paper.id, 'q', q.idx, q.image ?? null),
        )
      }
      db.prepare('COMMIT').run()
      console.log(
        `✓ ${file}：${paper.title}，${paper.questions.length} 题入库${warns.length ? `（warnings ${warns.length} 条，已写入 papers.warnings）` : ''}`,
      )
      for (const w of warns.slice(0, 3)) console.log(`   - ${w}`)
      ok++
    } catch (err) {
      db.prepare('ROLLBACK').run()
      console.error(`✗ ${file} 入库失败：${err.message}`)
    }
  }
  console.log(`完成：${ok}/${files.length} 个文件`)
  db?.close()
}

main()
