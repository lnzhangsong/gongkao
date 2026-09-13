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
 *       "image": null                  // 题图引用：[{file:"q{idx}_0.webp", w, h}]，字节在 data/xingce-img/
 *     }, …
 *   ]
 * }
 *
 * 产出：data/articles.db 新增 xg_papers / xg_questions 两表（与申论 papers/questions 平行，互不干扰）；
 *       图片**不经过本脚本落盘**——scripts/parse-xingce-images.py 直接写进 data/xingce-img/{paper_id}/，
 *       JSON 只存引用。本脚本从引用收集宽高，生成 src/data/xingceImageDims.generated.ts。
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

/** 句末标点：上一行以这些结尾时是真心换行（分句/分段边界），可带收尾引号/括号，不并入下一行 */
const REFLOW_TERMINAL_RE = /[。！？；…：.!?][”』」)]*$/
/** 行首枚举标记：下一行以这些开头时保留换行（①②③/(1)/一、/1. 逐条一行，配合前端 CondLines） */
const REFLOW_MARK_RE =
  /^(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]|[（(][0-9一二三四五六七八九十]{1,3}[)）]|[一二三四五六七八九十]{1,3}、|\d{1,2}[.、](?!\d)|【)/

/**
 * 重排解析文本：把视觉换行造成的句中硬断行并回一句（如「均无明\n显规律」「②号沿着宫格\n最外圈…」），
 * 真边界保留——句末标点后的换行、枚举标记行首的换行（①②③/(1)/1. 逐条一行，配合前端 CondLines）、
 * 空行（段落；连续空行收敛为一个）。表格行（含 " | "）不参与合并。
 * 只作用于解析与选项文本；题干/材料的换行是有意结构，不重排。
 */
function reflowText(text) {
  if (!text || !text.includes('\n')) return text
  const out = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    const prev = out.length ? out[out.length - 1] : null
    const joinable =
      prev &&
      prev !== '' &&
      !prev.includes(' | ') &&
      !line.includes(' | ') &&
      !REFLOW_TERMINAL_RE.test(prev) &&
      !REFLOW_MARK_RE.test(line)
    if (joinable) {
      /* 两侧都是 ASCII 时补空格，避免英文单词被粘连；中文直接相连 */
      const sep = /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(line) ? ' ' : ''
      out[out.length - 1] = prev + sep + line
    } else {
      out.push(line)
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

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
    /* 逻辑填空题干被截断的特征（2026 副省 38-45 实际踩过）：「依次填入…」被切剩「依次」 */ else if (
      /[。！？] ?依次$/.test(q.stem)
    )
      warns.push(`第${q.idx}题题干疑似截断（以「依次」结尾）`)
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
   * 收集题图/材料图尺寸。JSON 只存**引用** {file,w,h}，字节由 scripts/parse-xingce-images.py
   * 直接落盘 data/xingce-img/{paper_id}/（不再往 JSON 塞 base64：同一张图会被 git 存两份，
   * 且每次重裁都重写 MB 级 JSON）。这里只校验文件在、并生成尺寸清单。
   */
  const imageDims = {}
  const missingImages = []
  const legacyImages = []
  function collectImageDims(paperId, value) {
    if (!value) return
    if (typeof value === 'string') {
      legacyImages.push(paperId)
      return
    }
    if (!Array.isArray(value)) return
    for (const it of value) {
      if (!it?.file) continue
      const key = `${paperId}/${String(it.file).replace(/\.(webp|png)$/, '')}`
      if (it.w > 0 && it.h > 0) imageDims[key] = { w: it.w, h: it.h }
      if (!fs.existsSync(path.join(IMG_DIR, paperId, it.file))) missingImages.push(key)
    }
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
      // paper.warnings 可能是字符串（老 parse-xingce26 格式）、字符串数组（xingce-images.py）或缺失
      const paperWarns = Array.isArray(paper.warnings) ? paper.warnings : paper.warnings ? [String(paper.warnings)] : []
      const allWarns = [...paperWarns, ...warns]
      const warnings = allWarns.length ? allWarns.join('\n') : null
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
        /* 图片字节在 data/xingce-img/，这里只登记尺寸；db 不存图片路径
           （前端按「卷号+题号/组号」从构建产物取图） */
        collectImageDims(paper.id, q.groupImage)
        collectImageDims(paper.id, q.image)
        // 解析/选项重排：PDF 视觉换行的句中断行并回一句。题干与材料不重排——
        // 它们的换行是导入时就有意拼接/分条的结构（当前数据均为零换行）
        const options = q.options.map((o) => ({ ...o, text: reflowText(o.text ?? '') }))
        ins.run(
          paper.id,
          q.idx,
          q.section,
          q.subtype ?? null,
          q.groupId ?? null,
          q.groupStem ?? null,
          null,
          q.stem,
          JSON.stringify(options),
          q.answer ?? null,
          reflowText(q.explanation ?? '') || null,
          null,
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
  if (legacyImages.length) {
    console.error(
      `✗ 以下卷的 image/groupImage 还是旧的 base64 字符串格式，请重跑 scripts/parse-xingce-images.py：${[...new Set(legacyImages)].join('、')}`,
    )
  }
  if (missingImages.length) {
    console.error(
      `✗ 以下图片在 data/xingce-img/ 下不存在（引用与文件不一致）：${missingImages.slice(0, 10).join('、')}`,
    )
  }

  // 生成尺寸清单 TS：前端按「卷号/文件名」查 w/h，给 <img> 预留布局防抖动
  // dry 模式不落盘：否则会把上次全量导入收集到的尺寸清空（图片文件并未重建）
  if (!DRY) {
    const dimsLines = Object.entries(imageDims)
      .map(([k, d]) => `  '${k}': { w: ${d.w}, h: ${d.h} },`)
      .join('\n')
    fs.writeFileSync(
      path.join(ROOT, 'src', 'data', 'xingceImageDims.generated.ts'),
      `/** 由 scripts/import-xingce.mjs 生成：题图/材料图像素尺寸（<img> 预留布局防抖动）。勿手改。 */\nexport const XINGCE_IMAGE_DIMS: Record<string, { w: number; h: number }> = {\n${dimsLines}\n}\n`,
    )
  }
  db?.close()
}

main()
