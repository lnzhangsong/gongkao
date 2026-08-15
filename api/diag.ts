/**
 * 诊断端点：GET /api/diag —— 返回函数运行环境信息（部署后访问即可定位 500 原因）
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function GET(request: Request) {
  const out: Record<string, unknown> = { ok: false, node: process.version }

  // 1) node:sqlite 是否可用
  try {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t(a)')
    out.nodeSqlite = 'OK'
    db.close()
  } catch (e) {
    out.nodeSqlite = `FAIL: ${(e as Error).message}`
  }

  // 2) db 文件候选路径（includeFiles 打包后位置未知，全部探测）
  const here = path.dirname(fileURLToPath(import.meta.url))
  out.here = here
  const root = path.resolve(here, '..')
  const candidates = [
    path.join(here, 'data', 'articles.db'),
    path.join(root, 'data', 'articles.db'),
    path.join(process.cwd(), 'data', 'articles.db'),
    path.join(process.cwd(), 'articles.db'),
  ]
  out.paths = candidates.map((p) => ({ p, exists: existsSync(p) }))

  // 3) 尝试只读打开第一个存在的
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      const db = new DatabaseSync(p, { readOnly: true })
      out.opened = p
      out.rows = (db.prepare('SELECT COUNT(*) c FROM articles').get() as { c: number }).c
      db.close()
      out.ok = true
      break
    } catch (e) {
      out.openError = (e as Error).message
    }
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
