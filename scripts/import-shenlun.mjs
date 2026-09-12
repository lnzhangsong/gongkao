#!/usr/bin/env node
/**
 * 申论国考真题（2000–2025）入库
 *
 * 数据源：data/shenlun/*.json —— 每卷一个文件，由 scripts/parse-shenlun-pdf.py 从推荐版 PDF 提取：
 * {
 *   "id": "guokao-shenlun-2010-副省级",
 *   "year": 2010, "level": "副省级", "title": "...", "sourceFile": "...pdf", "pages": 8,
 *   "materials": [{ "idx": 1, "label": "材料1", "content": "..." }],
 *   "questions": [{ "idx": 1, "type": "概括", "stem": "...", "requirement": "...",
 *                   "wordLimit": { "max": 200 }, "points": 10, "answer": "...", "answerMatched": true }],
 *   "answersRaw": "...", "warnings": "..."
 * }
 *
 * 产出：data/articles.db 的 papers / materials / questions 三表（与文章/行测同库）。
 * 全量年份统一走本管线（含 2024/2025）：按 id 先删后插，未出现在 data/shenlun 的卷保持不动。
 *
 * 用法：node scripts/import-shenlun.mjs [--src data/shenlun] [--db data/articles.db] [--dry]
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const argPath = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  if (i === -1) return path.join(ROOT, fallback)
  const v = process.argv[i + 1]
  return path.isAbsolute(v) ? v : path.join(ROOT, v)
}
const SRC = argPath('--src', 'data/shenlun')
const DB = argPath('--db', 'data/articles.db')
const DRY = process.argv.includes('--dry')

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.json'))
const papers = []
for (const f of files) {
  papers.push(JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8')))
}
papers.sort((a, b) => a.year - b.year || a.level.localeCompare(b.level))

const report = {
  papers: papers.length,
  questions: papers.reduce((n, p) => n + p.questions.length, 0),
  materials: papers.reduce((n, p) => n + p.materials.length, 0),
  answerMatched: papers.reduce((n, p) => n + p.questions.filter((q) => q.answerMatched).length, 0),
  emptyAnswer: papers.flatMap((p) => p.questions.filter((q) => !q.answer).map((q) => `${p.id}#q${q.idx}`)),
  oddQuestions: papers
    .filter((p) => p.questions.length < 2 || p.questions.length > 6)
    .map((p) => `${p.id}: ${p.questions.length}`),
}
console.log(JSON.stringify({ ...report, db: DB }, null, 2))
if (DRY) process.exit(0)

fs.mkdirSync(path.dirname(DB), { recursive: true })
const db = new DatabaseSync(DB)
/* 必须用 DELETE（回滚日志）而非 WAL：本库随函数打包部署，而 Vercel 的函数目录是只读的。
 * WAL 库即使以 readOnly 打开也要创建 -wal/-shm 旁路文件，只读盘上直接 SQLITE_CANTOPEN，
 * 线上四个 /api/* 全挂。原先是 WAL，故这里改回 DELETE 并见文件末尾的断言。 */
db.exec(`
  PRAGMA journal_mode = DELETE;
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
  CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    label TEXT NOT NULL,
    content TEXT NOT NULL,
    chars INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS questions (
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
  CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
  CREATE INDEX IF NOT EXISTS idx_questions_paper ON questions(paper_id);
  CREATE INDEX IF NOT EXISTS idx_materials_paper ON materials(paper_id);
`)

const insP = db.prepare(
  `INSERT INTO papers (id, year, level, title, subject, source_file, source_format, pages, chars, status, has_answer, answers_raw, warnings)
   VALUES (?, ?, ?, ?, '申论', ?, ?, ?, ?, 'ok', ?, ?, ?)`,
)
const insM = db.prepare('INSERT INTO materials (id, paper_id, idx, label, content, chars) VALUES (?, ?, ?, ?, ?, ?)')
const insQ = db.prepare(
  `INSERT INTO questions (id, paper_id, idx, type, stem, requirement, word_limit, word_limit_json, points, answer, answer_matched)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
const delM = db.prepare('DELETE FROM materials WHERE paper_id = ?')
const delQ = db.prepare('DELETE FROM questions WHERE paper_id = ?')
const delP = db.prepare('DELETE FROM papers WHERE id = ?')
const before = db.prepare('SELECT COUNT(*) c FROM papers').get().c

db.exec('BEGIN')
try {
  for (const p of papers) {
    delM.run(p.id)
    delQ.run(p.id)
    delP.run(p.id)
    const chars =
      p.materials.reduce((n, m) => n + m.content.length, 0) +
      p.questions.reduce((n, q) => n + q.stem.length + (q.requirement?.length ?? 0), 0)
    insP.run(
      p.id,
      p.year,
      p.level,
      p.title,
      p.sourceFile,
      'pdf',
      p.pages ?? null,
      chars,
      p.questions.some((q) => q.answer) ? 1 : 0,
      p.answersRaw ?? null,
      p.warnings ?? null,
    )
    p.materials.forEach((m, i) => insM.run(`${p.id}-m${i + 1}`, p.id, i + 1, m.label, m.content, m.content.length))
    p.questions.forEach((q) =>
      insQ.run(
        `${p.id}-q${q.idx}`,
        p.id,
        q.idx,
        q.type ?? null,
        q.stem,
        q.requirement ?? '',
        q.wordLimit?.max ?? null,
        q.wordLimit ? JSON.stringify(q.wordLimit) : null,
        q.points ?? null,
        q.answer ?? null,
        q.answerMatched ? 1 : 0,
      ),
    )
  }
  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  throw e
}

const after = db.prepare('SELECT COUNT(*) c FROM papers').get().c
const byYear = db.prepare('SELECT year, COUNT(*) c FROM papers GROUP BY year ORDER BY year').all()
console.log(`papers: ${before} → ${after}`)
console.log('年份分布:', byYear.map((r) => `${r.year}:${r.c}`).join(' '))
const guarded = db.prepare('SELECT id FROM papers WHERE year IN (2024,2025) ORDER BY id').all()
console.log('受保护卷:', guarded.map((r) => r.id).join(', '))

/* 部署约束断言：导入结束后库必须处于 DELETE 模式（见文件开头注释），
 * 否则提交上去的 articles.db 会让生产 API 全线 CANTOPEN。 */
const journalMode = db.prepare('PRAGMA journal_mode').get().journal_mode
if (journalMode !== 'delete') throw new Error(`导入后 journal_mode=${journalMode}，应为 delete`)
db.close()
