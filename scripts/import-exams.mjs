#!/usr/bin/env node
/**
 * 申论国考真题结构化入库
 *
 * 数据源：《01】国考真题资料_AI解析》下的镜像 md（AI 解析产物，带 YAML 元数据）
 * 产出：data/articles.db（与文章同库，papers / materials / questions 三表）
 *
 * 用法：node scripts/import-exams.mjs [--src <解析目录>] [--db <输出db>] [--dry]
 *
 * 解析策略：宽容适配各年份三种标题写法
 *   - 标准版：【给定资料】/【作答要求】/参考答案
 *   - 早期版（2000–2008）：二、资料 / 三、申论要求
 *   - 2024+ 版：【材料一】/【问题一】
 *   - 2026 版：每题独立一段【作答要求】
 * 答案区形态杂（两套答案/含解析），按题号 best-effort 对齐，全文始终落 answers_raw 兜底。
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = process.argv.includes('--src')
  ? path.resolve(process.argv[process.argv.indexOf('--src') + 1])
  : '/Users/nif/Documents/人民时评/【01】国考真题资料_AI解析'
const DB = process.argv.includes('--db')
  ? path.resolve(process.argv[process.argv.indexOf('--db') + 1])
  : path.join(ROOT, 'data/articles.db')
const DRY = process.argv.includes('--dry')

// ---------- md 解析 ----------

function parseFrontmatter(text) {
  const m = /^---\n(.*?)\n---\n/s.exec(text)
  if (!m) return { meta: {}, body: text }
  const meta = {}
  for (const [, k, v] of m[1].matchAll(/^(\w+):\s*(.+)$/gm)) {
    const raw = v.trim().replace(/^"(.*)"$/, '$1')
    meta[k] = raw === 'True' ? true : raw === 'False' ? false : raw
  }
  return { meta, body: text.slice(m[0].length) }
}

const normalizeBody = (body) =>
  body
    .replace(/<!--\s*第\s*\d+\s*页\s*-->/g, '')
    .replace(/\r\n/g, '\n')
    // 页眉页脚噪声：孤立页码行、连续空行压缩
    .split('\n')
    .filter((l) => !/^\s*\d{1,3}\s*$/.test(l))
    .join('\n')

// ---------- 分节 ----------

const MATERIALS_START = [
  /^[ \t\u3000]*【?给定资料】?\s*$/m,
  /^[ \t\u3000]*[一二三四五六]、\s*给定?(资料|材料)/m, // 有的「材料1」与标题粘连同行
  /^[ \t\u3000]*[一二三四五六]、\s*资料\s*$/m,
  /^[ \t\u3000]*材料[0-9一二三四五六七八九十]+\s*$/m, // 2023 等无总标题、直接材料N 开头
  /^[ \t\u3000]*【材料一】/m,
]
const QUESTIONS_START = [
  /^[ \t\u3000]*【?作答要求】?/m, // 2026 每题一段也以它开头
  /^[ \t\u3000]*[一二三四五六]、\s*(?:申论)?作答要求.*$/m,
  /^[ \t\u3000]*[一二三四五六]、\s*申论要求.*$/m,
  /^[ \t\u3000]*问题[一二三四五六七八九十1-9]+[：:]?\s*$/m, // 2023「问题一」式
  /^[ \t\u3000]*【问题一】/m,
  /^[ \t\u3000]*申论要求\s*$/m,
]
const ANSWERS_START = [
  /^[ \t\u3000]*.{0,40}参考答案.{0,12}$/m,
  /^[ \t\u3000]*.{0,20}答案解析.*$/m,
  /^[ \t\u3000]*（解析）$/m,
  /^[ \t\u3000]*【题目一/m,
]

function findFirst(body, patterns, from = 0) {
  let best = null
  for (const re of patterns) {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    r.lastIndex = from
    const m = r.exec(body)
    while (m && m.index < from) m = r.exec(body)
    if (m && (best === null || m.index < best.index)) best = { index: m.index, text: m[0], re: re.source }
  }
  return best
}

// ---------- 材料/题目/答案切分 ----------

const CN = '一二三四五六七八九十'
const reMaterialHead = new RegExp(
  `^[ \\t]*(?:【?\\s*)?材料\\s*([0-9${CN}]+)\\s*[\\.、：:)）]?\\s*[^\n]*$`,
  'gm',
)
const reQNumCN = new RegExp(`^[ \\t]*([${CN}])[、\\.．]\\s*`, 'm')
const reQNumParen = new RegExp(`^[ \\t]*[（(](\\d{1,2}|[${CN}])[）)]\\s*`, 'm') // （1）/（一）混用（2019 实测两种并存）
const reQNumAr = /^[ \t\u3000]*(\d{1,2})[、\.．]\s*/m
const reQBracket = /^[ \t\u3000]*【(?:问题|题目)([一二三四五六七八九十1-9]+)】/m
const reQBlock2026 = /^[ \t\u3000]*【作答要求】\s*$/m
const reQWen = /^[ \t\u3000]*问题[一二三四五六七八九十1-9]+[：:]?/m // 2023 独立行 / 2022「问题一：题干…」行内式

/** 真题干特征：题干含作答动词（用于剔除「要求：…」伪标题） */
const STEM_VERB =
  /请|谈谈|假如|梳理|概括|归纳|分析|写一|提出|建议|看法|理解|启示|围绕|为题|论证|概述|阐释|简述|草拟|撰写|拟写|指出|整理|说明|评价|如何看待/
/** 要求块首行的典型开头（如「观点明确，分析全面…」），直接判为伪题干 */
const REQ_PREFIX =
  /^(观点明确|条理清晰|层次分明|问题梳理|所提措施|不超过|语言流畅|内容全面|紧扣|针对性强|针对|提炼准确|准确全面|简明|全面、准确|观点|结构完整|切合主题|分条)/
const stemOk = (stem) => {
  const s = stem.replace(/\s/g, '')
  if (REQ_PREFIX.test(s)) return false
  return STEM_VERB.test(s.slice(0, 80))
}

function splitByHead(text, re) {
  re = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  const heads = []
  let m
  while ((m = re.exec(text))) heads.push({ index: m.index, head: m[0].trim(), num: (m[1] || '').trim() })
  const parts = heads.map((h, i) => ({
    ...h,
    text: text.slice(h.index + h.head.length, i + 1 < heads.length ? heads[i + 1].index : text.length).trim(),
  }))
  return { heads, parts }
}

/** 题目切分：多编号方案评分制——先按题干特征过滤再计分，选命中最多的方案；落选块并入上一题 */
function splitQuestions(text) {
  const schemes = [reQBracket, reQBlock2026, reQWen, reQNumParen, reQNumCN, reQNumAr].map((re) => {
    const { parts } = splitByHead(text, re)
    return parts.map((p) => ({ ...p, ok: p.text.length > 8 && stemOk(extractStemAndRequirement(p.text).stem) }))
  })
  let best = null
  for (const parts of schemes) {
    const okCount = parts.filter((p) => p.ok).length
    if (okCount < 2) continue
    if (!best || okCount > best.okCount) best = { parts, okCount }
  }
  if (!best) return []
  const out = []
  const seenStems = new Set()
  for (const p of best.parts) {
    const dupKey = p.text.replace(/\s/g, '').slice(0, 15)
    const isDup = p.ok && seenStems.has(dupKey)
    // 「回答下列两个问题」引导的短小题 → 并入引导题
    const isSub =
      p.ok && out.length && p.text.replace(/\s/g, '').length < 50 &&
      out.slice(-2).some((q) => /两个问题|下面两题|以下两题|下面的问题/.test(q.stem))
    if (p.ok && !isDup && !isSub) {
      seenStems.add(dupKey)
      out.push({ idx: out.length + 1, stem: p.text, head: p.head })
    } else if (out.length) out[out.length - 1].stem += '\n' + p.text // 要求块/重复块 → 并回上一题
  }
  return out
}

/** 答案切分：best-effort 按题号对齐 */
function splitAnswers(text) {
  const patterns = [
    /^【题目([一二三四五六七八九十1-9]+)参考答案】?[^\n]*$/m,
    /^【?问题([一二三四五六七八九十1-9]+)[】]?[^\n]{0,4}参考答案[^\n]*$/m,
    /^第([一二三四五六1-9])问\s*参考答案[^\n]*$/m,
    new RegExp(`^第?([${CN}1-9])[、\\.．]\\s*参考答案[^\n]*$`, 'm'),
    new RegExp(`^([${CN}1-9])[、\\.．]\\s*【?(?:参考答案|答案提示|参考例文|答案)】?`, 'm'),
    new RegExp(`^([${CN}])[、\\.．]\\s*参考答案.*$`, 'm'),
  ]
  for (const re of patterns) {
    const { parts } = splitByHead(text, re)
    if (parts.length >= 2) {
      const cnIdx = (s) => CN.indexOf(s) + 1 || parseInt(s, 10) || 0
      return parts.map((p) => ({ num: cnIdx(p.num), text: p.text, head: p.head }))
    }
  }
  return []
}

// ---------- 字段抽取 ----------

function extractStemAndRequirement(blockText) {
  const lines = blockText.split('\n')
  const reqIdx = lines.findIndex((l) => /^要求[（(:：]/.test(l.trim()) || /^要求：/.test(l.trim()))
  if (reqIdx > 0) {
    return {
      stem: lines.slice(0, reqIdx).join('\n').trim(),
      requirement: lines.slice(reqIdx).join('\n').trim(),
    }
  }
  // 有的「要求：」混在题干行尾部
  const m = /^(.*\S[^\n]*?)(要求[（(:：].*)$/.exec(blockText)
  if (m) return { stem: m[1].trim(), requirement: m[2].trim() }
  return { stem: blockText.trim(), requirement: '' }
}

function extractWordLimit(text) {
  for (const [, a, b] of text.matchAll(/(\d{3,4})\s*[-–~至到]\s*(\d{3,4})\s*字/g)) return { min: +a, max: +b }
  for (const [, n] of text.matchAll(/(?:不超过|不多于|在)\s*(\d{3,4})\s*字/g)) return { max: +n }
  for (const [, n] of text.matchAll(/(\d{3,4})\s*字(?:左右|以内|上下)/g)) return { max: +n }
  return null
}

function extractPoints(text) {
  const m = /[（(]\s*(\d{1,2})\s*分\s*[）)]/.exec(text)
  return m ? +m[1] : null
}

function classifyQuestion(stem, requirement, wordLimit) {
  const t = stem + requirement
  if (/写一篇(?:文章|议论文|文章)|自拟题目|自选角度|作文|写一篇.{0,6}文章/.test(t)) return '大作文'
  if (/文章|议论/.test(t) && wordLimit && (wordLimit.max >= 900 || (wordLimit.min ?? 0) >= 900)) return '大作文'
  if (/提案|讲话稿|发言稿|倡议书|公开信|报告|提纲|宣传稿|简报|编者按|导言|新闻稿|公众号|短评|讲解稿|备询|经验介绍|材料(?:的)?(?:标题|导语)/.test(t))
    return '应用文'
  if (/对策|建议|措施|解决办法|解决.{0,6}问题|如何(解决|改善|推进)|工作思路/.test(t)) return '对策'
  if (/分析|谈谈|看法|理解|启示|评价|见解|含义|认识|比较/.test(t)) return '分析'
  if (/概括|归纳|梳理|指出|哪些方面|有哪些|特点|原因|过程|变化|差异|不同/.test(t)) return '概括'
  return null
}

// ---------- 试卷级解析 ----------

/** 材料去污：切掉内嵌的「作答要求」标题及之后一并吞入的题目文本（与 questions 表重复） */
function cleanMaterial(content) {
  for (const m of content.matchAll(/作答要求/g)) {
    const before = m.index > 0 ? content[m.index - 1] : '\n'
    const after = content.slice(m.index + 4, m.index + 6)
    if (after.startsWith('两')) continue // 注意事项 boilerplate：「与作答要求两部分构成」
    if (before in '\n【、三二一' || /^\s*[（(一二三四五1-9【问\n]/.test(after)) {
      return content.slice(0, m.index).replace(/[【（(]\s*$/, '').replace(/\s+$/, '')
    }
  }
  return content
}

/** 标题去污：截断吞入的注意事项/满分/本题本/材料正文，去掉【…】尾缀与页码残渣 */
function cleanTitle(t) {
  const cut = t.search(/一、注意事项|注意事项|满分\s*[：:]?\s*100|本题本|材料一/)
  if (cut > 0) t = t.slice(0, cut)
  return t
    .replace(/【[^】]*】\s*$/, '')
    .replace(/^\d+\s*\/\s*\d+\s+/, '')
    .replace(/[—－-]+\s*$/, '')
    .trim()
}

function parseLevel(meta, title) {
  const s = `${meta.level || ''}${title}`
  if (/行政执法/.test(s)) return '行政执法'
  if (/副省|省部|省级/.test(s)) return '副省级'
  if (/地市|市地/.test(s)) return '地市级'
  return '未分级'
}

function parsePaper(relPath, text) {
  const { meta, body: raw } = parseFrontmatter(text)
  if (meta.subject !== '申论' || meta.source_priority !== 'recommended') return null
  if (!/^ok/.test(meta.status || '')) return null
  if (/答题(纸|卡)/.test(relPath)) return null // 答题纸模板非试卷
  const base = relPath.split('/').pop()
  if (/(?:答案解析|大作文参考答案)\.md$/.test(base)) return null // 纯答案/解析文件，不是完整试卷

  const body = normalizeBody(raw)
  const rawTitle = body.split('\n').map((l) => l.trim()).find((l) => l.length > 6) || meta.source_file
  const title = cleanTitle(rawTitle)
  const level = parseLevel(meta, title)
  const year = parseInt(meta.year, 10)

  const warnings = []
  const qStart = findFirst(body, QUESTIONS_START)
  const mStart = findFirst(body, MATERIALS_START)
  const aStart = findFirst(body, ANSWERS_START, qStart ? qStart.index + 10 : 0)

  // —— 特例 A：2026 式「作答要求/参考答案」逐题交错 ——
  const qMarksAll = [...body.matchAll(/^[ \t\u3000]*【作答要求】\s*$/gm)].map((m) => m.index)
  const aMarksAll = [...body.matchAll(/^[ \t\u3000]*【参考答案】\s*$/gm)].map((m) => m.index)
  const interleaved =
    qMarksAll.length >= 2 && aMarksAll.length >= 2 && aMarksAll[0] < qMarksAll[1]
  const finishQuestions = (list) =>
    list.map((q) => {
      // 题干开头残留的序号（一、/（一）/1.）剥掉
      q.stem = q.stem.replace(/^[ \t\u3000]*(?:[一二三四五六七八九十]+[、\.．]|[（(][一二三四五六七八九十1-9]+[）)]|\d{1,2}[、\.．])[ \t\u3000]*/, '')
      const { stem, requirement } = extractStemAndRequirement(q.stem)
      const wordLimit = extractWordLimit(requirement) || extractWordLimit(stem)
      return {
        idx: q.idx,
        stem,
        requirement,
        word_limit_json: wordLimit ? JSON.stringify(wordLimit) : null,
        word_limit: wordLimit?.max ?? null,
        points: extractPoints(stem + requirement),
        type: classifyQuestion(stem, requirement, wordLimit),
        answer: q.answer ?? null,
        answer_matched: q.answer ? 1 : 0,
      }
    })

  if (interleaved) {
    const marks = [
      ...qMarksAll.map((i) => ({ i, t: 'q' })),
      ...aMarksAll.map((i) => ({ i, t: 'a' })),
    ].sort((x, y) => x.i - y.i)
    const questions = []
    let cur = null
    for (const [k, mk] of marks.entries()) {
      const end = k + 1 < marks.length ? marks[k + 1].i : body.length
      const text = body.slice(body.indexOf('\n', mk.i) + 1, end).trim()
      if (mk.t === 'q') {
        cur = { idx: questions.length + 1, stem: text }
        questions.push(cur)
      } else if (cur) {
        cur.answer = text
      }
    }
    if (questions.length) {
      // 材料区 = 首个【作答要求】之前
      const matHead = mStart || findFirst(body, [/^[ \t\u3000]*材料[0-9一二三四五六七八九十]+/m])
      const matRegion = matHead && matHead.index < qMarksAll[0] ? body.slice(matHead.index + matHead.text.length, qMarksAll[0]) : ''
      const { parts: materials } = matRegion ? splitByHead(matRegion, reMaterialHead) : { parts: [] }
      return {
        paper: paperMeta(relPath, meta, title, level, year, questions, ['作答要求/参考答案逐题交错，按块解析'],
          questions.filter((q) => q.answer).map((q) => `【第${q.idx}题参考答案】\n${q.answer}`).join('\n\n')),
        materials,
        questions: finishQuestions(questions),
      }
    }
  }

  // —— 特例 B：无「作答要求」标题，题目直接跟在最后一段材料后（2008 式）——
  let qRegionStart = qStart ? qStart.index + qStart.text.length : null
  if (!qStart && aStart && mStart) {
    let lastMat = null
    for (const m of body.matchAll(new RegExp(reMaterialHead.source, 'gm')))
      if (m.index < aStart.index) lastMat = m
    qRegionStart = lastMat ? lastMat.index + lastMat[0].length : mStart.index + mStart.text.length
    warnings.push('无「作答要求」标题，题目区按材料区之后推定')
  }

  const matEnd = qRegionStart !== null ? qRegionStart : aStart ? aStart.index : body.length
  const matRegion = mStart && mStart.index < matEnd ? body.slice(mStart.index + mStart.text.length, matEnd) : ''
  const { parts: materials } = matRegion ? splitByHead(matRegion, reMaterialHead) : { parts: [] }
  for (const m of materials) m.text = cleanMaterial(m.text)
  if (mStart && materials.length === 0 && matRegion.trim()) {
    materials.push({ index: 0, head: '', num: '1', text: matRegion.trim() })
    warnings.push('材料未按「材料N」分块，整体记为材料1')
  }

  const qRegion = qRegionStart !== null ? body.slice(qRegionStart, aStart ? aStart.index : body.length) : ''
  const questions = finishQuestions(splitQuestions(qRegion))
  if (!qStart && qRegionStart === null) warnings.push('未定位到作答要求区')
  if (qStart && questions.length === 0) warnings.push('作答要求区未切分出题目')

  let answers = []
  let answersRaw = ''
  if (aStart) {
    answersRaw = body.slice(aStart.index).trim()
    answers = splitAnswers(answersRaw)
    const aTexts = new Map(answers.map((a) => [a.num, a.text]))
    for (const q of questions) {
      const a = aTexts.get(q.idx)
      q.answer = a || null
      q.answer_matched = a ? 1 : 0
    }
  } else {
    warnings.push('未定位到参考答案区')
  }

  return {
    paper: paperMeta(relPath, meta, title, level, year, questions, warnings, answersRaw),
    materials: materials.map((m, i) => ({
      idx: i + 1,
      label: m.head || `材料${m.num}`,
      content: m.text,
    })),
    questions,
  }
}

function paperMeta(relPath, meta, title, level, year, questions, warnings, answersRaw) {
  return {
    id: `guokao-shenlun-${year}-${level}`,
    year,
    level,
    title: title.slice(0, 120),
    source_file: relPath,
    pages: +meta.pages || null,
    chars: +meta.chars || null,
    source_format: meta.source_format || null,
    status: meta.status,
    has_answer: answersRaw ? 1 : 0,
    answers_raw: answersRaw || null,
    warnings: warnings.join('; ') || null,
  }
}

// ---------- 主流程 ----------

function walkMd(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkMd(p))
    else if (e.name.endsWith('.md') && e.name !== '索引.md') out.push(p)
  }
  return out
}

const papers = []
for (const f of walkMd(SRC)) {
  const parsed = parsePaper(path.relative(SRC, f), fs.readFileSync(f, 'utf8'))
  if (parsed) papers.push(parsed)
}

// 同年同级重复卷（如 _1213233422 后缀）取字数更大的一份
const seen = new Map()
for (const p of papers) {
  const prev = seen.get(p.paper.id)
  if (!prev || (p.paper.chars || 0) > (prev.paper.chars || 0)) seen.set(p.paper.id, p)
}
const deduped = [...seen.values()].sort((a, b) => a.paper.year - b.paper.year)

const report = {
  files: papers.length,
  papers: deduped.length,
  skippedDuplicates: papers.length - deduped.length,
  questionTotal: deduped.reduce((n, p) => n + p.questions.length, 0),
  materialTotal: deduped.reduce((n, p) => n + p.materials.length, 0),
  answerMatched: deduped.reduce((n, p) => n + p.questions.filter((q) => q.answer_matched).length, 0),
  typeDist: {},
  warnings: deduped.filter((p) => p.paper.warnings).map((p) => ({ id: p.paper.id, w: p.paper.warnings })),
  oddQuestionCounts: deduped
    .filter((p) => p.questions.length < 3 || p.questions.length > 5)
    .map((p) => `${p.paper.id}: ${p.questions.length} 题`),
}
for (const p of deduped) for (const q of p.questions) report.typeDist[q.type || '未识别'] = (report.typeDist[q.type || '未识别'] || 0) + 1

if (DRY) {
  console.log(JSON.stringify(report, null, 2))
  for (const p of deduped)
    console.log(
      `${p.paper.year} ${p.paper.level.padEnd(4)} 材料${p.materials.length} 题${p.questions.length} 答${p.questions.filter((q) => q.answer_matched).length}/${p.questions.length} | ${p.paper.title.slice(0, 40)}`,
    )
  if (process.argv.includes('--inspect'))
    for (const p of deduped) {
      console.log(`\n### ${p.paper.id} (${p.questions.length} 题)`)
      for (const q of p.questions) console.log(`  Q${q.idx}[${q.type}]: ${q.stem.replace(/\n/g, ' ').slice(0, 64)}`)
    }
  process.exit(0)
}

// ---------- 入库 ----------
fs.mkdirSync(path.dirname(DB), { recursive: true })
const db = new DatabaseSync(DB)
db.exec(`
  PRAGMA journal_mode = WAL;
  DELETE FROM questions;
  DELETE FROM materials;
  DELETE FROM papers;
  CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    year INTEGER NOT NULL,
    level TEXT NOT NULL,
    title TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '申论',
    source_file TEXT NOT NULL UNIQUE,
    source_format TEXT, pages INTEGER, chars INTEGER, status TEXT,
    has_answer INTEGER NOT NULL DEFAULT 0,
    answers_raw TEXT,
    warnings TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE materials (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    label TEXT NOT NULL,
    content TEXT NOT NULL,
    chars INTEGER NOT NULL
  );
  CREATE TABLE questions (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    type TEXT,
    stem TEXT NOT NULL,
    requirement TEXT NOT NULL DEFAULT '',
    word_limit INTEGER,
    word_limit_json TEXT,
    points INTEGER,
    answer TEXT,
    answer_matched INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_papers_year ON papers(year);
  CREATE INDEX idx_questions_paper ON questions(paper_id);
  CREATE INDEX idx_materials_paper ON materials(paper_id);
`)

const insP = db.prepare(
  `INSERT INTO papers (id, year, level, title, source_file, source_format, pages, chars, status, has_answer, answers_raw, warnings)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
const insM = db.prepare('INSERT INTO materials (id, paper_id, idx, label, content, chars) VALUES (?, ?, ?, ?, ?, ?)')
const insQ = db.prepare(
  `INSERT INTO questions (id, paper_id, idx, type, stem, requirement, word_limit, word_limit_json, points, answer, answer_matched)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)

for (const { paper, materials, questions } of deduped) {
  insP.run(
    paper.id, paper.year, paper.level, paper.title, paper.source_file,
    paper.source_format, paper.pages, paper.chars, paper.status, paper.has_answer, paper.answers_raw, paper.warnings,
  )
  for (const [i, m] of materials.entries())
    insM.run(`${paper.id}-m${i + 1}`, paper.id, i + 1, m.label, m.content, m.content.length)
  for (const q of questions)
    insQ.run(
      `${paper.id}-q${q.idx}`, paper.id, q.idx, q.type, q.stem, q.requirement,
      q.word_limit, q.word_limit_json, q.points, q.answer, q.answer_matched ? 1 : 0,
    )
}

console.log(JSON.stringify({ ...report, db: DB }, null, 2))
