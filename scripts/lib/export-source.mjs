/**
 * DB → 仓库内可读源 的导出函数（与各 import-*.mjs 互为逆映射）。
 *
 * 数据流是单向的：**源是真相，库是产物**。所以任何直接改库的地方（本地 api-server 的写接口、
 * scripts/migrate-db-to-source.mjs）都必须把结果写回源，否则下次 `db:rebuild` 会把改动丢掉。
 * 本模块收口这些映射，避免「库格式 ↔ 源格式」在多个脚本里各写一份。
 *
 * 保真：三种源都能**逐字节**还原已提交的文件（formatted = JSON.stringify(x, null, 2) + '\n'），
 * 所以写回不会产生无意义的 diff。src/lib/dbSource.test.ts 守着「源 ↔ 库」一致。
 */
import fs from 'node:fs'
import path from 'node:path'

/* ---------- articles ---------- */

/** articles 行 → data/articles/{id}.json 的对象（键序固定，字段显式写全含 null） */
export function articleToSource(r) {
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

/** 全量重写 data/articles/：源是逐篇文件，整目录重来时先清空避免残留 */
export function exportArticles(db, dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const rows = db.prepare('SELECT * FROM articles ORDER BY id').all()
  for (const r of rows) writeJson(path.join(dir, `${r.id}.json`), articleToSource(r))
  return rows.length
}

/* ---------- guifan_terms ---------- */

/** 全量重写 data/guifan-terms.json。id 带空洞，原样保留（前端 term-seen 事件按 id 记） */
export function exportGuifanTerms(db, file) {
  const rows = db.prepare('SELECT id, theme, term, example FROM guifan_terms ORDER BY id').all()
  writeJson(file, rows)
  return rows.length
}

/* ---------- 申论试卷（papers / materials / questions） ---------- */

/** 单卷 → data/shenlun/{id}.json 的对象；与 scripts/import-shenlun.mjs 的读法一一对应 */
export function shenlunPaperToSource(db, paperId) {
  const p = db.prepare('SELECT * FROM papers WHERE id = ?').get(paperId)
  if (!p) return null
  const materials = db.prepare('SELECT idx, label, content FROM materials WHERE paper_id = ? ORDER BY idx').all(paperId)
  const questions = db.prepare('SELECT * FROM questions WHERE paper_id = ? ORDER BY idx').all(paperId)
  return {
    id: p.id,
    year: p.year,
    level: p.level,
    title: p.title,
    sourceFile: p.source_file,
    pages: p.pages,
    warnings: p.warnings,
    materials: materials.map((m) => ({ label: m.label, content: m.content, idx: m.idx })),
    questions: questions.map((q) => ({
      idx: q.idx,
      type: q.type,
      stem: q.stem,
      requirement: q.requirement,
      wordLimit: q.word_limit_json ? JSON.parse(q.word_limit_json) : null,
      points: q.points,
      answer: q.answer,
      answerMatched: Boolean(q.answer_matched),
    })),
    answersRaw: p.answers_raw,
  }
}

export function shenlunSourceFile(dir, paperId) {
  return path.join(dir, `${paperId}.json`)
}

export function exportShenlunPaper(db, dir, paperId) {
  const src = shenlunPaperToSource(db, paperId)
  if (!src) return false
  writeJson(shenlunSourceFile(dir, paperId), src)
  return true
}

/** 删卷时同步删源文件（库里已删、源还留着会让下次重建把它复活） */
export function removeShenlunSource(dir, paperId) {
  fs.rmSync(shenlunSourceFile(dir, paperId), { force: true })
}

export function exportShenlunAll(db, dir) {
  const ids = db.prepare('SELECT id FROM papers ORDER BY year, level').all()
  for (const { id } of ids) exportShenlunPaper(db, dir, id)
  return ids.length
}

/* ---------- 公共 ---------- */

/** 统一格式：2 空格缩进 + 结尾换行。已提交的源都是这个形状，重写才不产生假 diff */
export function formatSource(data) {
  return JSON.stringify(data, null, 2) + '\n'
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, formatSource(data))
}
