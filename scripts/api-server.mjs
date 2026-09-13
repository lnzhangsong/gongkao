/**
 * 本地 API server（开发/测试用）：与 Vercel Functions 同路由同逻辑
 *   node scripts/api-server.mjs [port]   默认 8787
 *
 * 读 handler 直接复用 api/*.ts（Node ≥22.18 原生剥离 TS 类型）：Vercel 打包
 * 只编译入口文件、api/*.ts 不能 import 兄弟模块的限制只约束 api/ 目录自身，
 * 反过来由这里 import 它们没有打包问题，且从根上消除两侧逻辑漂移。
 * 仅本地才有的写接口（试卷/规范词增删改，生产走 Supabase）仍在本文件实现。
 *
 * 路由（GET 全部转发 api/*.ts；写接口仅本地提供，生产只读或走 Supabase）：
 *   GET /api/articles         → api/articles.ts
 *   GET /api/terms            → api/terms.ts
 *   GET /api/exams            → api/exams.ts（?id= 详情在 handler 内）
 *   GET /api/xingce           → api/xingce.ts
 *   POST /api/ai              → api/ai.ts
 *   POST/PATCH/DELETE terms·exams  本地写接口（在本文件实现）
 *   （行测图片由前端 import.meta.glob 从 data/xingce-img/ 打进构建产物，无此路由）
 */
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 加载 .env / .env.local（Vite 只喂前端构建，不会传给本进程；不加载的话
// 照 .env.example 填的 WRITE_TOKEN 静默不生效——危险方向的失效）。
// 后加载的不会覆盖先加载的，故 .env.local 先读以保证其优先级与 Vite 一致；
// 真实 shell 环境变量仍然优先于两者。
for (const f of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(path.join(PROJECT_ROOT, f))
  } catch {
    /* 文件不存在：只用现有环境变量 */
  }
}

let _db = null

const articlesApi = await import('../api/articles.ts')
const aiApi = await import('../api/ai.ts')
const termsApi = await import('../api/terms.ts')
const examsApi = await import('../api/exams.ts')
const xingceApi = await import('../api/xingce.ts')

// ---------- 写接口鉴权 ----------
// 默认仅本机可用；若设置 WRITE_TOKEN 环境变量，则写请求必须带匹配的 x-write-token 头
// （前端 src/lib/api.ts 会自动附带 localStorage.readbook:write-token）
function writeAuthorized(req) {
  const expected = process.env.WRITE_TOKEN
  if (!expected) return true
  return req.headers['x-write-token'] === expected
}

function denyWrite(respond) {
  respond(json({ error: '未授权：缺少或错误的 x-write-token' }), 401)
}

// —— 申论真题写接口专用本地 DB 句柄（GET 已转发 api/exams.ts，生产只读）——
function openExamDb(opts) {
  const readOnly = !opts?.write
  if (_db && _dbReadOnly === readOnly) return _db
  if (_db) _db.close()
  _dbReadOnly = readOnly
  _db = new DatabaseSync(path.join(PROJECT_ROOT, 'data', 'articles.db'), { readOnly })
  return _db
}
let _dbReadOnly = true

// —— 行测真题/申论规范词的 GET 已随 exams/articles 一起转发 api/*.ts ——

const PORT = Number(process.argv[2] ?? 8787)

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      /* 本地 API 不缓存：数据（真题入库、图片重裁）随时在变，max-age 会让普通刷新
         拿到最多 5 分钟的旧响应，表现为「改了数据页面没变」。（线上走 Vercel Function，
         缓存策略由各 api/*.ts 自己声明。） */
      'cache-control': 'no-store',
      ...extra,
    },
  })

/** api/*.ts 的响应带线上缓存头（如 articles 的 max-age=300），本地开发必须剥掉，
 *  否则普通刷新会命中浏览器缓存、看不到刚改的数据 */
function noStore(resp) {
  const headers = new Headers(resp.headers)
  headers.set('cache-control', 'no-store')
  return new Response(resp.body, { status: resp.status, headers })
}

/** 读请求体（统一入口）：上限 2MB，超限直接回 413 后断开 socket。
 *  所有 POST/PATCH 写路由与 /api/ai 转发都必须走这里，禁止裸 req.on('data') 拼接
 *  （无上限的字符串累加可被大 body 打爆内存）。 */
const BODY_LIMIT = 2 * 1024 * 1024

function readBody(req, res) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > BODY_LIMIT) {
        res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: '请求体超过 2MB 上限' }))
        req.destroy()
        reject(new Error('body too large'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** 把 Node 请求转成 handler 需要的 Web Request（body 经 readBody 限流）；
 *  PORT=0（测试）时用 OS 实分配端口。 */
async function toWebRequest(req, res) {
  const body = await readBody(req, res)
  const headers = new Headers()
  const ct = req.headers['content-type']
  if (ct) headers.set('content-type', ct)
  const base = `http://localhost:${PORT || server.address()?.port}`
  return new Request(`${base}${req.url}`, {
    method: req.method,
    headers,
    body: body.length ? body : undefined,
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  // 内部转发用 Request 的 base：PORT=0（测试）时用 OS 实分配端口，防 handler 校验 host 时踩坑
  const internalBase = `http://localhost:${PORT || server.address()?.port}`
  // GET 200 响应附带 ETag；浏览器带 If-None-Match 且内容未变时回 304，省掉响应体传输
  // （规范词全量等大 JSON 刷新页面后依然受益，与会话缓存互补）
  const respond = async (resp) => {
    try {
      // 总闸：请求体超限时 readBody 已直接回 413，随后写路由的 catch 还会试图补一个
      // 400——二次 writeHead 抛 ERR_HTTP_HEADERS_SENT，void 掉的 rejection 会成为
      // unhandled rejection 直接打挂进程。所有响应都从这里出，拦在这里即全局兜底。
      if (res.headersSent || res.writableEnded) return
      const headers = Object.fromEntries(resp.headers)
      if (req.method === 'GET' && resp.status === 200) {
        const body = await resp.text()
        const etag = 'W/"' + createHash('sha1').update(body).digest('base64url') + '"'
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { etag })
          res.end()
          return
        }
        res.writeHead(resp.status, { ...headers, etag })
        res.end(body)
        return
      }
      res.writeHead(resp.status, headers)
      res.end(await resp.text())
    } catch {
      /* 响应通道已坏（socket 断开/头已发送），无法补救；吞掉避免 unhandled rejection */
    }
  }

  if (url.pathname === '/api/articles' && req.method === 'GET') {
    // 转发 api/articles.ts GET（单篇 ?id= / 列表筛选都在 handler 内）
    void respond(noStore(articlesApi.GET(new Request(`${internalBase}${req.url}`))))
    return
  }

  if (url.pathname === '/api/terms' && req.method === 'GET') {
    // 转发 api/terms.ts GET（theme / q 过滤在 handler 内）
    void respond(noStore(termsApi.GET(new Request(`${internalBase}${req.url}`))))
    return
  }

  // 新增规范词（body: { theme, term, example? }）
  if (url.pathname === '/api/terms' && req.method === 'POST') {
    if (!writeAuthorized(req)) return denyWrite(respond)
    try {
      const data = JSON.parse((await readBody(req, res)).toString())
      const term = String(data.term || '').trim()
      const theme = String(data.theme || '').trim() || '综合其他'
      const example = String(data.example || '').trim()
      if (!term) {
        void respond(json({ error: 'term 必填' }, 400))
        return
      }
      const d = openExamDb({ write: true })
      const { lastInsertRowid } = d
        .prepare('INSERT INTO guifan_terms (theme, term, example) VALUES (?, ?, ?)')
        .run(theme, term, example)
      void respond(json({ ok: true, id: Number(lastInsertRowid) }))
    } catch (err) {
      void respond(json({ error: String(err) }, 400))
    }
    return
  }

  // 修改规范词（部分更新：传了哪个字段改哪个）
  if (url.pathname.startsWith('/api/terms/') && req.method === 'PATCH') {
    if (!writeAuthorized(req)) return denyWrite(respond)
    const id = Number(decodeURIComponent(url.pathname.slice('/api/terms/'.length)))
    if (!Number.isInteger(id) || id <= 0) {
      void respond(json({ error: '无效 id' }, 400))
      return
    }
    try {
      const data = JSON.parse((await readBody(req, res)).toString())
      const sets = []
      const vals = []
      for (const key of ['theme', 'term', 'example']) {
        if (typeof data[key] === 'string') {
          const v = data[key].trim()
          if (key !== 'example' && !v) {
            void respond(json({ error: `${key} 不能为空` }, 400))
            return
          }
          sets.push(`${key} = ?`)
          vals.push(v)
        }
      }
      if (sets.length === 0) {
        void respond(json({ error: '没有可更新的字段' }, 400))
        return
      }
      const d = openExamDb({ write: true })
      const r = d.prepare(`UPDATE guifan_terms SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
      if (r.changes === 0) {
        void respond(json({ error: 'not found' }, 404))
        return
      }
      void respond(json({ ok: true }))
    } catch (err) {
      void respond(json({ error: String(err) }, 400))
    }
    return
  }

  // 删除规范词
  if (url.pathname.startsWith('/api/terms/') && req.method === 'DELETE') {
    if (!writeAuthorized(req)) return denyWrite(respond)
    const id = Number(decodeURIComponent(url.pathname.slice('/api/terms/'.length)))
    if (!Number.isInteger(id) || id <= 0) {
      void respond(json({ error: '无效 id' }, 400))
      return
    }
    try {
      const d = openExamDb({ write: true })
      const r = d.prepare('DELETE FROM guifan_terms WHERE id = ?').run(id)
      if (r.changes === 0) {
        void respond(json({ error: 'not found' }, 404))
        return
      }
      void respond(json({ ok: true }))
    } catch (err) {
      void respond(json({ error: String(err) }, 400))
    }
    return
  }

  if (url.pathname === '/api/exams' && req.method === 'GET') {
    // 转发 api/exams.ts GET（?id= 详情、year/level 过滤都在 handler 内）
    void respond(noStore(examsApi.GET(new Request(`${internalBase}${req.url}`))))
    return
  }
  // 编辑保存（仅本地 api-server；Vercel 生产不提供写接口）
  if (url.pathname === '/api/xingce' && req.method === 'GET') {
    // 转发 api/xingce.ts GET（?id= 详情在 handler 内）
    void respond(noStore(xingceApi.GET(new Request(`${internalBase}${req.url}`))))
    return
  }
  if (url.pathname === '/api/exams' && req.method === 'POST') {
    if (!writeAuthorized(req)) return denyWrite(respond)
    try {
      const data = JSON.parse((await readBody(req, res)).toString())
      const year = parseInt(data.year, 10)
      const level = String(data.level || '未分级')
      const title = String(data.title || '').trim()
      if (!year || !title) {
        void respond(json({ error: 'year 与 title 必填' }, 400))
        return
      }
      const d = openExamDb({ write: true })
      const id = `guokao-shenlun-${year}-${level}`
      if (d.prepare('SELECT id FROM papers WHERE id = ?').get(id)) {
        void respond(json({ error: `已存在同年份同层级的试卷：${id}` }, 409))
        return
      }
      d.prepare(
        `INSERT INTO papers (id, year, level, title, subject, source_file)
         VALUES (?, ?, ?, ?, '申论', ?)`,
      ).run(id, year, level, title, `manual/${id}.md`)
      void respond(json({ ok: true, id }))
    } catch (err) {
      void respond(json({ error: String(err) }, 400))
    }
    return
  }

  if (url.pathname.startsWith('/api/exams/') && req.method === 'POST') {
    if (!writeAuthorized(req)) return denyWrite(respond)
    const id = decodeURIComponent(url.pathname.slice('/api/exams/'.length))
    const d0 = openExamDb({ write: true })
    const exists = d0.prepare('SELECT id FROM papers WHERE id = ?').get(id)
    if (!exists) {
      void respond(json({ error: 'not found' }, 404))
      return
    }
    try {
      const data = JSON.parse((await readBody(req, res)).toString())
      // 年份/级别可调：变化时同步改 papers.id 并迁移 materials/questions
      const d = openExamDb({ write: true })
      const paper = d.prepare('SELECT * FROM papers WHERE id = ?').get(id)
      if (!paper) {
        void respond(json({ error: 'not found' }, 404))
        return
      }
      const newYear = data.year ? parseInt(data.year, 10) : paper.year
      const newLevel = typeof data.level === 'string' && data.level.trim() ? data.level.trim() : paper.level
      const newId = `guokao-shenlun-${newYear}-${newLevel}`
      if (newId !== id && d.prepare('SELECT id FROM papers WHERE id = ?').get(newId)) {
        void respond(json({ error: `已存在同年份同层级的试卷：${newId}` }, 409))
        return
      }
      const updPaper = d.prepare('UPDATE papers SET id = ?, year = ?, level = ?, title = ?, warnings = ? WHERE id = ?')
      const delMats = d.prepare('DELETE FROM materials WHERE paper_id = ?')
      const insMat = d.prepare(
        'INSERT INTO materials (id, paper_id, idx, label, content, chars) VALUES (?, ?, ?, ?, ?, ?)',
      )
      const delQs = d.prepare('DELETE FROM questions WHERE paper_id = ?')
      const insQ = d.prepare(
        'INSERT INTO questions (id, paper_id, idx, type, stem, requirement, word_limit, word_limit_json, points, answer, answer_matched) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      d.exec('BEGIN')
      updPaper.run(
        newId,
        newYear,
        newLevel,
        typeof data.title === 'string' ? data.title : '',
        typeof data.warnings === 'string' ? data.warnings : null,
        id,
      )
      if (newId !== id) {
        d.prepare('UPDATE materials SET paper_id = ? WHERE paper_id = ?').run(newId, id)
        d.prepare('UPDATE questions SET paper_id = ? WHERE paper_id = ?').run(newId, id)
      }
      // 整卷替换：materials/questions 按提交顺序重排 idx（支持新增与删除行）
      delMats.run(newId)
      for (const [i, m] of (data.materials ?? []).entries()) {
        if (typeof m.content !== 'string') continue
        insMat.run(`${newId}-m${i + 1}`, newId, i + 1, m.label || `材料${i + 1}`, m.content, m.content.length)
      }
      delQs.run(newId)
      for (const [i, q] of (data.questions ?? []).entries()) {
        if (typeof q.stem !== 'string') continue
        const wl = q.wordLimit ?? null
        insQ.run(
          `${newId}-q${i + 1}`,
          newId,
          i + 1,
          q.type || null,
          q.stem,
          q.requirement || '',
          wl,
          wl ? JSON.stringify({ max: wl }) : null,
          q.points ?? null,
          q.answer ?? null,
          q.answer ? 1 : 0,
        )
      }
      d.exec('COMMIT')
      void respond(json({ ok: true, id: newId }))
    } catch (err) {
      try {
        d.exec('ROLLBACK')
      } catch {}
      void respond(json({ error: String(err) }, 400))
    }
    return
  }

  // 删除试卷（连同其材料与题目）
  if (url.pathname.startsWith('/api/exams/') && req.method === 'DELETE') {
    if (!writeAuthorized(req)) return denyWrite(respond)
    const id = decodeURIComponent(url.pathname.slice('/api/exams/'.length))
    const d = openExamDb({ write: true })
    const delPaper = d.prepare('DELETE FROM papers WHERE id = ?')
    const delMats = d.prepare('DELETE FROM materials WHERE paper_id = ?')
    const delQs = d.prepare('DELETE FROM questions WHERE paper_id = ?')
    d.exec('BEGIN')
    try {
      delMats.run(id)
      delQs.run(id)
      const info = delPaper.run(id)
      if (info.changes === 0) {
        d.exec('ROLLBACK')
        void respond(json({ error: 'not found' }, 404))
        return
      }
      d.exec('COMMIT')
      void respond(json({ ok: true }))
    } catch (err) {
      try {
        d.exec('ROLLBACK')
      } catch {}
      void respond(json({ error: String(err) }, 400))
    }
    return
  }

  // AI 纯转发（BYOK）：直接转发 api/ai.ts POST，SSRF 防护与错误提示单点维护
  if (url.pathname === '/api/ai' && req.method === 'POST') {
    try {
      const webReq = await toWebRequest(req, res)
      void respond(await aiApi.POST(webReq))
    } catch {
      // readBody 超限时已直接回 413 并断开；这里只兜真正的意外
    }
    return
  }

  // 能力探测：回答「**这个请求方**能不能写」而非「服务端支不支持写」——
  // 设了 WRITE_TOKEN 时无令牌的探测也要拿到 false，前端才不会渲染点了必 401 的按钮
  if (url.pathname === '/api/capabilities' && req.method === 'GET') {
    void respond(json({ write: writeAuthorized(req) }))
    return
  }

  void respond(json({ error: 'not found' }, 404))
})

// 默认只绑回环：未设 WRITE_TOKEN 时写接口对局域网开放，绑所有网卡意味着
// 同网段任何人都能改/删本地库。需要局域网调试时 API_HOST=0.0.0.0 打开
// （不用 HOST 名字：zsh 等会导出通用名 HOST，被继承后绑到错误地址）。
const HOST = process.env.API_HOST || '127.0.0.1'
server.listen(PORT, HOST, () => {
  // PORT=0（测试用）时打印 OS 实际分配的端口
  const port = PORT || (server.address()?.port ?? PORT)
  console.log(`API server 就绪 → http://localhost:${port}/api/articles`)
})
