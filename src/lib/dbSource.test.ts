import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vite-plus/test'

/**
 * 「库 = 产物」守卫：`data/articles.db` 里可由**仓库内源**推导的部分，必须与源一致。
 *
 * 曾经只有 data/shenlun、data/xingce 有仓库内源；articles（517 篇）与 guifan_terms（3039 条）
 * 的源都在仓库外（docx / 合集 md），DB 事实上是唯一副本。2026-09-13 用
 * scripts/migrate-db-to-source.mjs 反导出可读源：
 *   data/articles/{id}.json  → articles
 *   data/guifan-terms.json   → guifan_terms（带 id，本地增删留下的空洞也要原样保留）
 * 于是整库可由 `vp run db:rebuild` 重建。
 *
 * 本测试锁住「源 ↔ 库」不漂移：有人只改 DB 不改源（或反之）会立刻红。
 * 完整重建等价性较重（要起 5 个子进程），默认跳过；`DB_REBUILD_CHECK=1 vp test run` 打开。
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DB = path.join(ROOT, 'data/articles.db')
const ARTICLES_DIR = path.join(ROOT, 'data/articles')
const TERMS_FILE = path.join(ROOT, 'data/guifan-terms.json')

const db = new DatabaseSync(DB, { readOnly: true })
afterAll(() => db.close())

type ArticleSource = {
  id: string
  title: string
  summary: string
  source: string
  topic: string
  column: string
  date: string
  readTime: number
  content: string[]
  pullquote: string | null
  finishNote: string | null
  featured: boolean
}

/** 库行 → 源格式（键序与 migrate-db-to-source.mjs 的 articleToSource 一致，便于整体比对） */
function rowToSource(r: Record<string, unknown>): ArticleSource {
  return {
    id: r.id as string,
    title: r.title as string,
    summary: r.summary as string,
    source: r.source as string,
    topic: r.topic as string,
    column: r.column_name as string,
    date: r.date as string,
    readTime: r.read_time as number,
    content: JSON.parse(r.content_json as string) as string[],
    pullquote: (r.pullquote ?? null) as string | null,
    finishNote: (r.finish_note ?? null) as string | null,
    featured: Boolean(r.featured),
  }
}

const articleFiles = fs.readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.json'))
const articleSources = articleFiles.map(
  (f) => JSON.parse(fs.readFileSync(path.join(ARTICLES_DIR, f), 'utf8')) as ArticleSource,
)
const articleRows = db.prepare('SELECT * FROM articles').all() as Record<string, unknown>[]

describe('data/articles/*.json ↔ articles 表', () => {
  it('源文件与库的行一一对应（id 集合相同）', () => {
    const fromSource = articleSources.map((a) => a.id).sort()
    const fromDb = articleRows.map((r) => r.id as string).sort()
    expect(fromSource).toEqual(fromDb)
    expect(fromSource.length).toBeGreaterThan(0)
  })

  it('每篇源与库的每个字段都一致', () => {
    const byId = new Map(articleRows.map((r) => [r.id as string, r]))
    const mismatched = articleSources
      .filter((a) => JSON.stringify(a) !== JSON.stringify(rowToSource(byId.get(a.id)!)))
      .map((a) => a.id)
    expect(
      mismatched,
      '源与库不一致（上面这些 id）。改源之后要 `vp run db:rebuild` 重建库；' +
        '若刚用本地管理 UI 改过数据（它直接写库），要先 `node scripts/migrate-db-to-source.mjs` 把改动导回源再提交——' +
        '否则库是构建产物，下次重建就把改动丢了。',
    ).toEqual([])
  })

  it('源字段合法（必填、readTime 正整数、content 段落数组、文件名 = id）', () => {
    const bad: string[] = []
    for (const f of articleFiles) {
      const a = JSON.parse(fs.readFileSync(path.join(ARTICLES_DIR, f), 'utf8')) as ArticleSource
      if (f !== `${a.id}.json`) bad.push(`${f}: 文件名与 id（${a.id}）不一致`)
      for (const k of ['title', 'source', 'topic', 'date'] as const) if (!a[k]) bad.push(`${f}: ${k} 为空`)
      if (!Number.isInteger(a.readTime) || a.readTime <= 0) bad.push(`${f}: readTime 非法（${a.readTime}）`)
      if (!Array.isArray(a.content) || a.content.length === 0) bad.push(`${f}: content 必须是非空数组`)
    }
    expect(bad).toEqual([])
  })
})

describe('data/guifan-terms.json ↔ guifan_terms 表', () => {
  it('源与库逐条一致（含 id 空洞）', () => {
    const source = JSON.parse(fs.readFileSync(TERMS_FILE, 'utf8')) as unknown
    const rows = db.prepare('SELECT id, theme, term, example FROM guifan_terms ORDER BY id').all()
    expect(
      source,
      '规范词源与库不一致。改源后 `vp run db:rebuild`；若刚用 TermsPage 增删改过（直接写库），' +
        '先 `node scripts/migrate-db-to-source.mjs` 导回源再提交，否则重建会丢掉这些改动。',
    ).toEqual(rows)
    expect(rows.length).toBeGreaterThan(0)
  })
})

/* ---------- 库 → 源的完整性与「半个库」自愈 ---------- */

describe('库 → 源 的完整性与修复', () => {
  it('migrate-db-to-source --check：三种源与库逐字节一致（含 shenlun 孤儿文件检测）', () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/migrate-db-to-source.mjs'), '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(out).toContain('逐字节一致')
  })

  it('ensure-db 会把「只有一张表的半个库」重建完整（只判文件存在是不够的）', () => {
    const partial = path.join(os.tmpdir(), `readbook-partial-${process.pid}.db`)
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(partial + suffix, { force: true })
    const stub = new DatabaseSync(partial)
    stub.exec('CREATE TABLE articles (id TEXT)') // 模拟单独跑 import-articles 建出的残件
    stub.close()

    execFileSync(process.execPath, [path.join(ROOT, 'scripts/ensure-db.mjs'), '--db', partial], {
      cwd: ROOT,
      stdio: 'ignore',
    })
    const fixed = new DatabaseSync(partial, { readOnly: true })
    try {
      const tables = (
        fixed.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
      ).map((r) => r.name)
      expect(tables).toEqual(
        expect.arrayContaining([
          'articles',
          'guifan_terms',
          'papers',
          'materials',
          'questions',
          'xg_papers',
          'articles_fts',
        ]),
      )
      expect((fixed.prepare('SELECT COUNT(*) AS n FROM articles').get() as { n: number }).n).toBeGreaterThan(0)
    } finally {
      fixed.close()
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(partial + suffix, { force: true })
    }
  })
})

/* ---------- 可选：完整重建等价性（较重，默认跳过） ---------- */

const rebuildCheck = process.env.DB_REBUILD_CHECK === '1'
const tmpDb = path.join(os.tmpdir(), `readbook-rebuild-check-${process.pid}.db`)

describe('vp run db:rebuild 重建等价性', () => {
  afterAll(() => {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(tmpDb + suffix, { force: true })
  })

  it.skipIf(!rebuildCheck)('从源重建的库与现库逐表逐列一致（created_at 是入库时间戳，不参与）', () => {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/rebuild-db.mjs'), '--db', tmpDb], {
      cwd: ROOT,
      stdio: 'ignore',
    })
    const rebuilt = new DatabaseSync(tmpDb, { readOnly: true })
    try {
      const tables = ['articles', 'guifan_terms', 'papers', 'materials', 'questions', 'xg_papers', 'xg_questions']
      const mismatched: string[] = []
      for (const t of tables) {
        const cols = (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[])
          .map((c) => c.name)
          .filter((c) => c !== 'created_at')
        const select = `SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${t}" ORDER BY ${cols.join(', ')}`
        if (JSON.stringify(db.prepare(select).all()) !== JSON.stringify(rebuilt.prepare(select).all())) {
          mismatched.push(t)
        }
      }
      expect(mismatched).toEqual([])
    } finally {
      rebuilt.close()
    }
  })
})
