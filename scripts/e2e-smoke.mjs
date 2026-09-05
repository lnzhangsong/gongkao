/* 端到端冒烟测试：用本机 Edge 无头浏览器验证路由、渲染、标注、删除与持久化
 * 依赖：本地 API server（node:sqlite 提供 /api），由本脚本自动拉起 */
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'

const BASE = process.env.E2E_BASE || 'http://localhost:5173'
const API_PORT = Number(process.env.E2E_API_PORT || 8787)

// 启动本地 API server（数据：data/articles.db）
const apiServer = spawn(process.execPath, ['scripts/api-server.mjs', String(API_PORT)], {
  stdio: 'ignore',
  detached: false,
})
await new Promise((r) => setTimeout(r, 1200))
const results = []
const errors = []

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  // 404：预期内的探测；ERR_FAILED：加载失败错误态用例主动 abort 所致
  if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('ERR_FAILED')) errors.push(`console: ${m.text()}`)
})
// 接受所有 confirm / alert（删除确认、导入确认等）
page.on('dialog', (d) => d.accept())

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/** 打开页面并等待 React 挂载、effects 生效 */
async function open(path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  // 首屏 loading 动画（最短 1.4s）结束后页面才可用
  await page.waitForSelector('.loading-screen', { timeout: 3000 }).catch(() => {})
  await page.waitForSelector('.loading-screen', { state: 'detached', timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(300)
  // 阅读页：正文异步拉取，等待段落渲染
  if (path.includes('/reading/')) {
    await page.waitForSelector('[data-para]', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(200)
  }
}

/** 从 IndexedDB 读取持久化数据（文章/进度/摘录已迁移到 IDB） */
function idbGet(key) {
  return page.evaluate(
    (k) =>
      new Promise((resolve) => {
        const req = indexedDB.open('readbook-db', 1)
        req.onupgradeneeded = () => {
          req.result.createObjectStore('kv')
        }
        req.onsuccess = () => {
          try {
            const db = req.result
            const tx = db.transaction('kv', 'readonly')
            const get = tx.objectStore('kv').get(k)
            get.onsuccess = () => resolve(get.result ?? null)
            get.onerror = () => resolve(null)
          } catch {
            resolve(null)
          }
        }
        req.onerror = () => resolve(null)
      }),
    key,
  )
}

/** 选中某段中的文字并弹出工具栏 */
async function selectRange(paraIndex, from, to) {
  // 段落可能已被标注拆成多个文本节点，按字符偏移遍历全部文本节点定位选区
  await page.evaluate(
    ([pi, f, t]) => {
      const p = document.querySelector(`[data-para="${pi}"]`)
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      const nodes = []
      let cur = walker.nextNode()
      while (cur) {
        nodes.push(cur)
        cur = walker.nextNode()
      }
      let acc = 0
      let startNode = null
      let startOff = 0
      let endNode = null
      let endOff = 0
      for (const n of nodes) {
        const len = n.data.length
        if (startNode === null && acc + len > f) {
          startNode = n
          startOff = f - acc
        }
        if (acc + len >= t) {
          endNode = n
          endOff = t - acc
          break
        }
        acc += len
      }
      const range = document.createRange()
      range.setStart(startNode, startOff)
      range.setEnd(endNode, endOff)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    },
    [paraIndex, from, to],
  )
  await page.waitForTimeout(200)
}

/** 点击创建工具栏（第一个 .selection-popover，排除管理菜单）中文字匹配的按钮 */
async function clickPopoverButton(matchText) {
  await page.evaluate((m) => {
    const pop = document.querySelector('.selection-popover')
    if (!pop) return
    const btns = pop.querySelectorAll('button')
    for (const b of btns) if (b.textContent.includes(m)) b.click()
  }, matchText)
  await page.waitForTimeout(250)
}

// ---------- 路由与渲染 ----------
for (const [path, sel] of [
  ['/', '#home'],
  ['/library', '#library'],
  ['/reading/p0001', '.reading-page'],
  ['/notes', '.notes-page'],
  ['/settings', '.settings-page'],
]) {
  await open(path)
  check(`路由 ${path} 渲染`, (await page.locator(sel).count()) > 0)
}
// 阅读页刷新不 404（HashRouter 静态托管安全）
await open('/reading/p0001')
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.loading-screen', { state: 'detached', timeout: 5000 }).catch(() => {})
await page.waitForTimeout(300)
check('阅读页刷新不 404', (await page.locator('.reading-page').count()) > 0)

// ---------- 首页 ----------
await open('/')
check('首页 hero 标题', (await page.locator('.hero h1').innerText()).includes('读懂时代'))
check('首页继续阅读卡片', (await page.locator('.main-card').count()) > 0)
check('首页推荐卡片 3 个', (await page.locator('.item').count()) === 3)

// ---------- 文章库 ----------
await open('/library')
const rows = await page.locator('.article-row').count()
check('文章库列表行', rows > 0, `${rows} 行`)
await page.locator('.search-box input').fill('基层治理')
await page.waitForTimeout(300)
check('搜索写入 URL', new URL(page.url()).searchParams.get('q') === '基层治理')
const filteredRows = await page.locator('.article-row').count()
check('搜索过滤生效', filteredRows > 0 && filteredRows <= rows, `${filteredRows} 行（每页 ${rows}）`)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
check('刷新后搜索保持', (await page.locator('.search-box input').inputValue()) === '基层治理')
await page.locator('.filter-pill', { hasText: '民生保障' }).first().click()
await page.waitForTimeout(300)
check('主题筛选写入 URL', new URL(page.url()).searchParams.get('topic') === '民生保障')

// ---------- 阅读页：进度 ----------
await open('/reading/p0001')
check('正文段落渲染', (await page.locator('[data-para]').count()) >= 5)
check('阅读工具侧栏', (await page.locator('.article-tools').count()) === 1)
await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }))
await page.waitForTimeout(2300)
const progressData = JSON.parse((await idbGet('readbook:articles')) ?? '{}')
const p01 = progressData.state?.progress?.['p0001']
check('滚动后进度持久化', p01 && p01.percent > 0, `percent=${p01?.percent ?? 'none'}`)
// 真实阅读时长：导航栏实时显示 MM:SS
const metaTime = await page.locator('.article-meta span').first().innerText()
check('阅读时长实时显示', /\d{2}:\d{2}$/.test(metaTime), metaTime)
// 阅读页切换主题 → 全局生效并持久化
const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme)
await page.evaluate(() => {
  const tools = [...document.querySelectorAll('.article-tools .tool')]
  const themeTool = tools.find((t) => t.querySelector('span')?.textContent === '阅读主题')
  themeTool?.querySelector('button')?.click()
})
await page.waitForTimeout(300)
const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme)
check('阅读页切主题全局生效', themeAfter !== themeBefore, `${themeBefore} → ${themeAfter}`)
const themeStoreData = await page.evaluate(() => JSON.parse(localStorage.getItem('readbook:theme') || '{}'))
check('阅读页切主题持久化', themeStoreData.state?.theme === themeAfter, `theme=${themeStoreData.state?.theme}`)
// 阅读辅助：正文字体自定义下拉（6 个选项，选择「仿宋」）
await page.locator('.article-tools .menu-select-trigger').click()
await page.waitForTimeout(200)
check('字体下拉弹出', (await page.locator('.menu-select-item').count()) === 6)
await page.locator('.menu-select-item', { hasText: '仿宋' }).click()
await page.waitForTimeout(250)
const fontData = await page.evaluate(() => JSON.parse(localStorage.getItem('readbook:reader') || '{}'))
check('正文字体下拉切换持久化', fontData.state?.settings?.fontFamily === 'fangsong', `fontFamily=${fontData.state?.settings?.fontFamily}`)

// ---------- 阅读页：段落聚焦（带内可读 / 带外淡化） ----------
await page.evaluate(() => {
  const tools = [...document.querySelectorAll('.article-tools .tool')]
  const focusTool = tools.find((t) => t.querySelector('span')?.textContent === '段落聚焦')
  focusTool?.querySelector('button')?.click()
})
await page.waitForTimeout(300)
// 滚到页中段，等延迟补算（400ms）完成后检查带内外分布
await page.evaluate(() => window.scrollTo({ top: (document.documentElement.scrollHeight - window.innerHeight) * 0.5, behavior: 'instant' }))
await page.waitForTimeout(700)
const focusDist = await page.evaluate(() => ({
  dim: document.querySelectorAll('.article-body p.dim').length,
  total: document.querySelectorAll('.article-body p').length,
}))
check('段落聚焦带外淡化', focusDist.dim >= 1 && focusDist.dim < focusDist.total, `${focusDist.total - focusDist.dim}/${focusDist.total} 可读`)
await page.evaluate(() => {
  const tools = [...document.querySelectorAll('.article-tools .tool')]
  const focusTool = tools.find((t) => t.querySelector('span')?.textContent === '段落聚焦')
  focusTool?.querySelector('button')?.click()
})
await page.waitForTimeout(300)
check('段落聚焦关闭恢复', (await page.locator('.article-body p.dim').count()) === 0)

// ---------- 阅读页：graphite（墨夜）主题 ----------
await page.evaluate(() => localStorage.setItem('readbook:theme', JSON.stringify({ state: { theme: 'graphite', autoDark: false }, version: 0 })))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.loading-screen', { state: 'detached', timeout: 8000 }).catch(() => {})
await page.waitForTimeout(600)
const gTheme = await page.evaluate(() => document.documentElement.dataset.theme)
const gBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
check('graphite 主题生效', gTheme === 'graphite' && gBg !== 'rgb(244, 240, 233)', `${gTheme} bg=${gBg}`)
// 还原暖纸，避免影响后续用例
await page.evaluate(() => localStorage.setItem('readbook:theme', JSON.stringify({ state: { theme: 'paper', autoDark: false }, version: 0 })))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.loading-screen', { state: 'detached', timeout: 8000 }).catch(() => {})
await page.waitForTimeout(400)

// ---------- 阅读页：正文加载失败错误态 ----------
// 拦截单篇全文请求（meta 列表不受影响）；p0009 从未打开过，无离线缓存可回退
await page.route('**/api/articles?id=p0009*', (route) => route.abort())
await open('/reading/p0009')
check('加载失败显示错误态', (await page.locator('.reading-page').innerText()).includes('正文暂时无法加载'))
check('错误态可返回文库', (await page.locator('.reading-page a', { hasText: '返回文库' }).count()) === 1)
await page.unroute('**/api/articles?id=p0009*')

// ---------- 阅读页：高亮 ----------
await open('/reading/p0001')
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
await page.waitForTimeout(300)
await selectRange(0, 4, 16)
check('选择后弹出工具栏', (await page.evaluate(() => document.querySelector('.selection-popover')?.classList.contains('show'))) === true)
check('色板含 6 种颜色', (await page.locator('.hl-dots .hl-dot').count()) === 6)
const dotRect = await page.evaluate(() => {
  const r = document.querySelector('.hl-dot').getBoundingClientRect()
  return { w: r.width, h: r.height }
})
check('高亮色点为正圆', Math.abs(dotRect.w - dotRect.h) < 0.5, `${dotRect.w}×${dotRect.h}`)
check('首字放大已移除', (await page.evaluate(() => {
  const p = document.querySelector('.article-body p')
  return getComputedStyle(p, '::first-letter').fontSize === getComputedStyle(p).fontSize
})) === true)
check('段首空两格', (await page.evaluate(() => {
  const p = document.querySelector('.article-body p')
  return getComputedStyle(p).textIndent === '34px'
})) === true)
check('小字号提升到 12px', (await page.evaluate(() => {
  const el = document.querySelector('.article-head .tag')
  return getComputedStyle(el).fontSize === '12px'
})) === true)
// 点击蓝色色点 → 蓝色高亮
await page.evaluate(() => {
  const dot = document.querySelector('.hl-dot.blue')
  if (dot) dot.click()
})
await page.waitForTimeout(250)
const hlCount = await page.locator('.article-body .highlighted').count()
check('高亮标记渲染', hlCount >= 1, `${hlCount} 处`)
check('蓝色高亮渲染', (await page.locator('.article-body .highlighted.hl-blue').count()) >= 1)
const anns = JSON.parse((await idbGet('readbook:annotations')) ?? '{}').state?.annotations ?? []
const hlAnn = anns.find((a) => a.kind === 'highlight')
check('高亮持久化', Boolean(hlAnn), `${anns.length} 条标注`)
check('高亮颜色持久化', hlAnn?.color === 'blue', `color=${hlAnn?.color ?? 'none'}`)

// 重叠高亮合并：再选 [10,24) 用绿色高亮，应与 [4,16) 合并为一条 [4,24)
await selectRange(0, 10, 24)
await page.evaluate(() => {
  const dot = document.querySelector('.hl-dot.green')
  if (dot) dot.click()
})
await page.waitForTimeout(250)
const mergedAnns = JSON.parse((await idbGet('readbook:annotations')) ?? '{}').state?.annotations ?? []
const hlMerged = mergedAnns.filter((a) => a.kind === 'highlight' && a.articleId === 'p0001')
check('重叠高亮合并为一条', hlMerged.length === 1, `${hlMerged.length} 条`)
check('合并区间取并集', hlMerged[0]?.start === 4 && hlMerged[0]?.end === 24, `[${hlMerged[0]?.start},${hlMerged[0]?.end})`)
check('合并后正文单段高亮', (await page.locator('.article-body .highlighted').count()) === 1)


// ---------- 点击标注管理：切颜色 / 加下划线 ----------
await page.evaluate(() => {
  const el = document.querySelector('.article-body .highlighted')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
check('点击高亮弹出管理', (await page.evaluate(() => document.querySelector('.ann-popover')?.classList.contains('show'))) === true)
await page.evaluate(() => {
  const d = document.querySelector('.ann-popover .hl-dot.pink')
  if (d) d.click()
})
await page.waitForTimeout(250)
const afterColor = JSON.parse((await idbGet('readbook:annotations')) ?? '{}').state?.annotations ?? []
const hlAfter = afterColor.find((a) => a.kind === 'highlight' && a.articleId === 'p0001')
check('点击高亮切换颜色', hlAfter?.color === 'pink', `color=${hlAfter?.color ?? 'none'}`)
check('切换颜色后渲染', (await page.locator('.article-body .highlighted.hl-pink').count()) >= 1)
check('无下划线时菜单不显示样式点', (await page.evaluate(() => document.querySelectorAll('.ann-popover .ul-dot').length)) === 0)
check('无下划线时无删除下划线', (await page.evaluate(() => [...document.querySelectorAll('.ann-popover button')].some((b) => b.textContent.includes('删除下划线')))) === false)
// 下划线经选中文字创建（菜单只切换不新增）
await selectRange(0, 10, 24)
await page.evaluate(() => { const d = document.querySelector('.ul-dot.solid'); if (d) d.click() })
await page.waitForTimeout(250)
const withUl = JSON.parse((await idbGet('readbook:annotations')) ?? '{}').state?.annotations ?? []
const ulAnn = withUl.find((a) => a.kind === 'underline' && a.articleId === 'p0001' && a.end === 24)
check('选中文字创建下划线', Boolean(ulAnn), `start=${ulAnn?.start} end=${ulAnn?.end}`)
check('同段下划线渲染', (await page.locator('.article-body .underlined').count()) >= 1)

// 加笔记：创建锚点但不直接展开编辑
await page.evaluate(() => {
  const el = document.querySelector('.article-body .highlighted')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
await page.evaluate(() => {
  const btns = document.querySelectorAll('.ann-popover button')
  for (const b of btns) if (b.textContent.includes('加笔记')) b.click()
})
await page.waitForTimeout(250)
check('加笔记直接进入编辑', (await page.locator('.inline-note.show textarea').count()) === 1)
// 填内容并保存第一条笔记（避免空笔记被自动删除）
await page.locator('.inline-note.show textarea').fill('第一条笔记内容')
await page.evaluate(() => {
  const btns = document.querySelectorAll('.inline-note.show button')
  for (const b of btns) if (b.textContent.includes('保存')) b.click()
})
await page.waitForTimeout(250)
check('加笔记锚点出现', (await page.locator('.article-body .note-mark').count()) >= 1)
// 空笔记自动删除：再加一条但不填，执行其他操作后被清理
await page.evaluate(() => {
  const el = document.querySelector('.article-body .highlighted')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
await page.evaluate(() => {
  const btns = document.querySelectorAll('.ann-popover button')
  for (const b of btns) if (b.textContent.includes('加笔记')) b.click()
})
await page.waitForTimeout(250)
const beforeEmpty = JSON.parse((await idbGet('readbook:annotations')) ?? '{}').state?.annotations ?? []
const emptyCountBefore = beforeEmpty.filter((a) => a.kind === 'note' && a.articleId === 'p0001').length
// 不填内容，直接点正文其他标注（执行其他操作）
await page.evaluate(() => {
  const el = document.querySelector('.article-body .underlined')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(250)
const afterEmpty = JSON.parse((await idbGet('readbook:annotations')) ?? '{}').state?.annotations ?? []
const emptyCountAfter = afterEmpty.filter((a) => a.kind === 'note' && a.articleId === 'p0001').length
// 空笔记应被清理，已保存笔记保留：after = before - 1
check('空笔记自动删除', emptyCountAfter === emptyCountBefore - 1, `${emptyCountBefore} → ${emptyCountAfter}`)

// 点击右上角星标：直接展开/收起笔记（同段含高亮+下划线也不受影响）
await page.evaluate(() => {
  const star = document.querySelector('.article-body .note-star')
  if (star) star.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
check('星标可收起笔记', (await page.locator('.inline-note.show').count()) === 0)
await page.evaluate(() => {
  const star = document.querySelector('.article-body .note-star')
  if (star) star.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
check('点击星标直接展开笔记', (await page.locator('.inline-note.show').count()) === 1)

// 同一段话可添加多条笔记
await page.evaluate(() => {
  const el = document.querySelector('.article-body .highlighted')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
await page.evaluate(() => {
  const btns = document.querySelectorAll('.ann-popover button')
  for (const b of btns) if (b.textContent.includes('加笔记')) b.click()
})
await page.waitForTimeout(250)
check('同段可加第二条笔记', (await page.locator('.article-body .note-star').count()) >= 1)
// 两条笔记同时展开（填内容保存第二条，避免空笔记被删）
await page.locator('.inline-note.show textarea').fill('第二条笔记内容')
await page.evaluate(() => {
  const btns = document.querySelectorAll('.inline-note.show button')
  for (const b of btns) if (b.textContent.includes('保存')) b.click()
})
await page.waitForTimeout(250)
check('两条笔记同时展开', (await page.locator('.inline-note.show').count()) === 2)
// 星标切换：收起全部 → 再展开全部
await page.evaluate(() => {
  const star = document.querySelector('.article-body .note-star')
  if (star) star.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
check('星标收起全部笔记', (await page.locator('.inline-note.show').count()) === 0)
await page.evaluate(() => {
  const star = document.querySelector('.article-body .note-star')
  if (star) star.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
check('星标展开全部笔记', (await page.locator('.inline-note.show').count()) === 2)
// 执行其他操作（切颜色）时笔记保持展开
await page.evaluate(() => {
  const el = document.querySelector('.article-body .highlighted')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
await page.evaluate(() => {
  const d = document.querySelector('.ann-popover .hl-dot.violet')
  if (d) d.click()
})
await page.waitForTimeout(250)
check('切换颜色后笔记保持展开', (await page.locator('.inline-note.show').count()) === 2)

// ---------- 跨文章隔离：a01 的高亮不能出现在 a02 ----------
await open('/reading/p0002')
check('其他文章无串标', (await page.locator('.article-body .highlighted').count()) === 0)
await open('/reading/p0001')
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
await page.waitForTimeout(300)

// ---------- 阅读页：下划线（波浪样式） ----------
await selectRange(1, 2, 10)
await page.evaluate(() => {
  const d = document.querySelector('.ul-dot.wavy')
  if (d) d.click()
})
await page.waitForTimeout(250)
check('波浪下划线渲染', (await page.locator('.article-body .underlined.ul-wavy').count()) >= 1)



// ---------- 阅读页：笔记 ----------
await selectRange(2, 2, 14)
await clickPopoverButton('笔记')
check('笔记表单出现', (await page.locator('.note-form.show textarea').count()) === 1)
await page.locator('.note-form.show textarea').fill('这是测试笔记内容')
await page.evaluate(() => {
  const btns = document.querySelectorAll('.note-form.show button')
  for (const b of btns) if (b.textContent.includes('保存')) b.click()
})
await page.waitForTimeout(250)
check('笔记锚点渲染', (await page.locator('.article-body .note-mark').count()) >= 1)
check('inline note 展开', (await page.locator('.inline-note.show').count()) === 1)

// 纯笔记段（无高亮/划线）：菜单统一含色点/样式点，点色点即可加高亮
await page.evaluate(() => {
  const el = document.querySelector('.article-body .note-mark:not(.highlighted):not(.underlined)')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
check('纯笔记段菜单含高亮色点', (await page.evaluate(() => document.querySelectorAll('.ann-popover .hl-dot').length)) === 6)
check('纯笔记段菜单无下划线样式点', (await page.evaluate(() => document.querySelectorAll('.ann-popover .ul-dot').length)) === 0)
check('纯笔记段无删除下划线', (await page.evaluate(() => [...document.querySelectorAll('.ann-popover button')].some((b) => b.textContent.includes('删除下划线')))) === false)
// 点色点给纯笔记段加高亮
await page.evaluate(() => {
  const d = document.querySelector('.ann-popover .hl-dot.pink')
  if (d) d.click()
})
await page.waitForTimeout(250)
check('纯笔记段点色点加高亮', (await page.locator('.article-body .highlighted.hl-pink').count()) >= 1)

// ---------- 我的摘录 ----------
await open('/notes')
// 离开阅读页后，实测时长已落盘
const afterLeave = JSON.parse((await idbGet('readbook:articles')) ?? '{}')
const spent = afterLeave.state?.progress?.['p0001']?.timeSpentSec
check('阅读时长持久化', spent >= 1, `timeSpentSec=${spent}`)
const noteRows = await page.locator('.note-row').count()
check('摘录列表', noteRows >= 3, `${noteRows} 行`)
const markerCounts = await page.evaluate(() => ({
  hl: document.querySelectorAll('.note-row .hl-swatch').length,
  ul: document.querySelectorAll('.note-row .ul-swatch').length,
  note: document.querySelectorAll('.note-row .note-swatch').length,
}))
check('摘录标记可区分', markerCounts.hl > 0 && markerCounts.ul > 0 && markerCounts.note > 0, JSON.stringify(markerCounts))
check('一段话多条笔记标记', (await page.evaluate(() => document.body.innerText.includes('✦×2'))))
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.note-row')].find((r) => r.innerText.includes('规划建议提出'))
  if (row) row.click()
})
await page.waitForTimeout(200)
check('详情展示多条笔记', (await page.locator('.detail-note').count()) >= 2, `${await page.locator('.detail-note').count()} 条`)
check('摘录详情面板', (await page.locator('.note-detail blockquote').count()) === 1)
await page.locator('.note-search input').fill('测试笔记内容')
await page.waitForTimeout(300)
check('摘录搜索', (await page.locator('.note-row').count()) === 1)
await page.locator('.note-search input').fill('')
await page.waitForTimeout(200)
await page.locator('.note-row').first().click()
await page.waitForTimeout(200)
await page.locator('.detail-source a').first().click()
await page.waitForTimeout(500)
check('打开原文跳转', new URL(page.url()).pathname.startsWith('/reading/'))

// ---------- 原文内删除：按类型逐个删 ----------
// 删除高亮（该段还有下划线/笔记，应只删高亮）
await page.evaluate(() => {
  const el = document.querySelector('.article-body .highlighted')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
check('点击标注弹出管理', (await page.evaluate(() => document.querySelector('.ann-popover')?.classList.contains('show'))) === true)
await page.evaluate(() => {
  const btns = document.querySelectorAll('.ann-popover button')
  for (const b of btns) if (b.textContent.includes('删除高亮')) b.click()
})
await page.waitForTimeout(500)
check('删除高亮后消失', (await page.locator('.article-body .highlighted').count()) <= 1)

// ---------- 素材标记（申论五类，D15） ----------
await selectRange(0, 30, 44)
await page.evaluate(() => {
  const btn = document.querySelector('.selection-popover .mat-btn-thesis')
  if (btn) btn.click()
})
await page.waitForTimeout(250)
check('素材标记渲染类型色与徽标', (await page.locator('.article-body .mat-thesis').count()) >= 1)
const matAnns = JSON.parse((await idbGet('readbook:annotations')) ?? '{}').state?.annotations ?? []
const matAnn = matAnns.find((a) => a.materialType === 'thesis')
check('素材类型持久化', Boolean(matAnn), `materialType=${matAnn?.materialType ?? 'none'}`)

// 标注管理弹层：取消素材标记 + 句式模板
await page.evaluate(() => document.querySelector('.article-body .mat-thesis')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
await page.waitForTimeout(200)
check('管理弹层含素材行', (await page.locator('.ann-popover .mat-row').count()) === 1)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.ann-popover .mat-btn')].find((b) => b.textContent.includes('句式'))
  if (btn) btn.click()
})
await page.waitForTimeout(200)
check('句式模板输入出现', (await page.locator('.ann-popover .pattern-input').count()) === 1)

// ---------- 申论拆解 / 范文精读面板 ----------
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.article-tools .tool button')].find((b) => b.textContent.includes('拆解'))
  if (btn) btn.click()
})
await page.waitForTimeout(300)
check('拆解面板打开', (await page.locator('.shenlun-panel').count()) === 1)
check('面板含每段大意区', (await page.locator('.shenlun-panel .para-summary').count()) >= 3)
check('面板含结构骨架区', (await page.locator('.shenlun-panel .skeleton-field').count()) >= 3)
// 学习状态：设为「学习中」并验证持久化（申论链路：标记 → 学习状态）
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.shenlun-panel button')].find((b) => b.textContent.includes('学习中'))
  if (btn) btn.click()
})
await page.waitForTimeout(300)
const studyRaw = JSON.parse((await idbGet('readbook:shenlun')) ?? '{}')
check('学习状态持久化', studyRaw.state?.study?.p0001?.status === 'learning', `status=${studyRaw.state?.study?.p0001?.status ?? 'none'}`)
await page.evaluate(() => document.querySelector('.shenlun-close')?.click())
await page.waitForTimeout(200)
check('拆解面板可关闭', (await page.locator('.shenlun-panel').count()) === 0)
const delAnns1 = JSON.parse((await idbGet('readbook:annotations')) ?? '{}').state?.annotations ?? []
check('删除高亮持久化', !delAnns1.some((a) => a.kind === 'highlight' && a.start === 4 && a.end === 24))
// 同段下划线仍在
check('同段下划线保留', delAnns1.some((a) => a.kind === 'underline' && a.articleId === 'p0001' && a.end === 24))

// 删除下划线（该段单独删，不影响其它下划线）
await page.evaluate(() => {
  const el = document.querySelector('.article-body .underlined')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
await page.evaluate(() => {
  const btns = document.querySelectorAll('.ann-popover button')
  for (const b of btns) if (b.textContent.includes('删除下划线')) b.click()
})
await page.waitForTimeout(500)
const delAnns2 = JSON.parse((await idbGet('readbook:annotations')) ?? '{}').state?.annotations ?? []
check('删除下划线', !delAnns2.some((a) => a.kind === 'underline' && a.articleId === 'p0001' && a.end === 24))
check('其他下划线保留', delAnns2.filter((a) => a.kind === 'underline' && a.articleId === 'p0001').length >= 1)

// 删除该段笔记（点击 → 管理菜单 → 删除笔记）
await page.evaluate(() => {
  const el = document.querySelector('.article-body .note-mark')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
check('点击笔记弹出管理', (await page.evaluate(() => document.querySelector('.ann-popover')?.classList.contains('show'))) === true)
await page.evaluate(() => {
  const btns = document.querySelectorAll('.ann-popover button')
  for (const b of btns) if (b.textContent.includes('删除笔记')) b.click()
})
await page.waitForTimeout(250)
const delAnns3 = JSON.parse((await idbGet('readbook:annotations')) ?? '{}').state?.annotations ?? []
check('删除该段笔记', !delAnns3.some((a) => a.kind === 'note' && a.start === 4 && a.end === 24))

// ---------- 设置页 ----------
await open('/settings')
await page.locator('.theme-dot.night').click()
await page.waitForTimeout(200)
check('主题切换生效', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'night')
await page.locator('.font-size-ctl button').nth(1).click()
await page.waitForTimeout(200)
const readerData = await page.evaluate(() => JSON.parse(localStorage.getItem('readbook:reader') || '{}'))
check('字号设置持久化', readerData.state?.settings?.fontSize === 18, `fontSize=${readerData.state?.settings?.fontSize}`)

// ---------- 主题跨页保持 + 刷新持久化 ----------
await open('/')
check('主题跨页保持', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'night')
await open('/notes')
check('刷新后摘录仍在', (await page.locator('.note-row').count()) >= 1)

// ---------- 文章管理：仅允许添加（/admin 列表 + /admin/new 录入；编辑/删除已移除） ----------
await open('/admin')
await page.locator('.toolbar-tools button.ghost').click()
await page.waitForTimeout(500)
check('跳转到新建页', (await page.evaluate(() => window.location.pathname)) === '/admin/new')
await page.locator('.admin-edit input[placeholder="文章标题"]').fill('测试录入：基层减负要久久为功')
await page.locator('.admin-edit textarea[placeholder^="第一段"]').fill('基层是服务群众的最后一公里。\n减负不是减责任，而是把干部从形式主义中解放出来。')
await page.locator('.admin-form-actions .ghost').first().click()
await page.waitForTimeout(500)
check('保存后回到列表', (await page.evaluate(() => window.location.pathname)) === '/admin')
check('录入文章加入列表', (await page.evaluate(() => document.body.innerText.includes('测试录入：基层减负要久久为功'))))
await open('/library')
check('录入文章进入文章库', (await page.evaluate(() => document.body.innerText.includes('测试录入：基层减负要久久为功'))))
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.article-row')].find((r) => r.innerText.includes('测试录入'))
  if (row) row.click()
})
await page.waitForTimeout(500)
check('录入文章可阅读', (await page.locator('.reading-page').count()) === 1)
// 列表行只保留「阅读」入口（编辑已移除）
await open('/admin')
const rowBtns = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.admin-row')].find((r) => r.innerText.includes('测试录入'))
  return row ? [...row.querySelectorAll('button, a')].map((b) => b.textContent) : []
})
check('列表行无编辑入口', !rowBtns.some((t) => t.includes('编辑')), rowBtns.join('/'))
// 新建页无删除按钮
await open('/admin/new')
const newPageBtns = await page.evaluate(() =>
  [...document.querySelectorAll('.admin-form-actions button')].map((b) => b.textContent),
)
check('新建页无删除按钮', !newPageBtns.some((t) => t.includes('删除')), newPageBtns.join('/'))
await open('/admin')

// ---------- 已读文章标题置灰 ----------
await open('/library')
const readState = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.article-row')].find((r) => r.innerText.includes('以法治护航全民阅读'))
  if (!row) return null
  return {
    isRead: !!row.querySelector('.article-title.is-read'),
    hasTailText: row.innerText.includes('已读'),
  }
})
check('已读文章标题置灰', readState?.isRead === true)
check('行尾不再显示已读', readState?.hasTailText === false)

// ---------- 数据导入 ----------
await open('/settings')
const importPayload = {
  exportedAt: '2024-06-01T00:00:00.000Z',
  theme: 'night',
  readerSettings: { fontSize: 20, lineHeight: 2.0, fontFamily: 'kaiti', readerTheme: '', reducedMotion: false, showAnnotations: true },
  articles: [{ id: 'a05', title: 'x', topic: '时政评论', source: '申论精读', date: '2024-05-06', progress: { articleId: 'a05', percent: 42, lastPosition: 0, lastReadAt: '2024-06-01T00:00:00.000Z', completed: false, readCount: 1, favorite: false, timeSpentSec: 120 } }],
  annotations: [{ id: 'imp-1', articleId: 'a05', kind: 'highlight', text: '导入测试高亮文字', start: 1, end: 5, createdAt: '2024-06-01T00:00:00.000Z', color: 'green' }],
  shenlun: [{ articleId: 'a05', status: 'mastered', mastery: 3, coreThesis: '导入测试总论点', subTheses: [], createdAt: '2024-06-01T00:00:00.000Z', updatedAt: '2024-06-01T00:00:00.000Z' }],
}
await page.setInputFiles('input[type="file"]', {
  name: 'readbook-import.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(importPayload)),
})
/* 导入走自定义 confirmDialog（非原生 dialog 事件），需点击「确定」 */
await page.waitForTimeout(300)
const impConfirm = page.locator('.exam-modal button', { hasText: '确定' })
if (await impConfirm.count()) await impConfirm.first().click()
await page.waitForTimeout(900)
const impTheme = await page.evaluate(() => document.documentElement.dataset.theme)
check('导入主题生效', impTheme === 'night', impTheme)
const impArt = JSON.parse((await idbGet('readbook:articles')) ?? '{}')
check('导入进度合并', impArt.state?.progress?.['a05']?.percent === 42, `percent=${impArt.state?.progress?.['a05']?.percent}`)
const impAnn = JSON.parse((await idbGet('readbook:annotations')) ?? '{}')
check('导入摘录合并', (impAnn.state?.annotations ?? []).some((a) => a.id === 'imp-1'))
const impStudy = JSON.parse((await idbGet('readbook:shenlun')) ?? '{}')
check('导入学习记录合并', impStudy.state?.study?.a05?.status === 'mastered', `status=${impStudy.state?.study?.a05?.status ?? 'none'}`)

// ---------- P0 入口规则 + 本周统计 ----------
await open('/')
const entrySmall = await page.locator('.entry small').innerText()
check('入场卡真实编号', /NO\. \d{3}/.test(entrySmall), entrySmall)
const homeEyebrow = await page.locator('.eyebrow').first().innerText()
const today = new Date().toISOString().slice(0, 10)
check('首页 eyebrow 当日日期', homeEyebrow.includes(today), homeEyebrow)
check('本周阅读统计卡', (await page.locator('.week-stats').count()) === 1)
// 申论统计行：拆解/导入产生学习记录 + 素材标记后，首页展示「已拆解 X 篇 · 素材 Y 条」
const homeStats = await page.locator('.week-stats').innerText()
check('首页申论统计行', /已拆解 \d+ 篇 · 素材 \d+ 条/.test(homeStats.replace(/\n/g, ' ')), homeStats.replace(/\n/g, ' '))

// ---------- 相邻文章导航（上一篇/下一篇） ----------
const listRes = await fetch(`http://localhost:${API_PORT}/api/articles`).then((r) => r.json())
const cur = listRes.articles[5]
const prevArt = listRes.articles[4]
const nextArt = listRes.articles[6]
await open(`/reading/${cur.id}`)
check('文末相邻导航', (await page.locator('.article-pager').count()) === 1)
check('顶部相邻导航', (await page.locator('.article-pager-top').count()) === 1)
check('文末显示下一篇标题', (await page.locator('.article-pager .pager-item.next').innerText()).includes(nextArt.title.slice(0, 8)))
check('上一篇指向排序前一篇', (await page.locator('.article-pager-top a', { hasText: '上一篇' }).getAttribute('href')) === `/reading/${prevArt.id}`)
await page.locator('.article-pager-top a', { hasText: '下一篇' }).click()
await page.waitForTimeout(1000)
check('下一篇跳转', new URL(page.url()).pathname.endsWith(nextArt.id), page.url())

// ---------- 全文搜索（正文命中） ----------
const fullArt = await fetch(`http://localhost:${API_PORT}/api/articles?id=${cur.id}`).then((r) => r.json())
const para = fullArt.content[1] ?? fullArt.content[0]
const kw = para.slice(3, 11)
const metaHit = `${fullArt.title}${fullArt.summary}`.toLowerCase().includes(kw.toLowerCase())
await open(`/library?q=${encodeURIComponent(kw)}`)
await page.waitForTimeout(900) // 前端 300ms 防抖 + 服务端检索
const ftRows = await page.locator('.article-row').count()
check('全文搜索正文命中', ftRows > 0, `kw=${kw}　meta命中=${metaHit}　${ftRows} 行`)

// ---------- 摘要 ----------
console.log('\n================ 测试摘要 ================')
const fails = results.filter((r) => !r.ok)
console.log(`共 ${results.length} 项，失败 ${fails.length} 项`)
if (errors.length) {
  console.log('浏览器错误：')
  errors.slice(0, 10).forEach((e) => console.log('  ', e))
}
await browser.close()
apiServer.kill()
process.exit(fails.length > 0 || errors.length > 0 ? 1 : 0)
