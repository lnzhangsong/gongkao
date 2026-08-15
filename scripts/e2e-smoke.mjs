/* 端到端冒烟测试：用本机 Edge 无头浏览器验证路由、渲染、标注、删除与持久化 */
import { chromium } from 'playwright-core'

const BASE = 'http://localhost:5173'
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
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(`console: ${m.text()}`)
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
  await page.waitForTimeout(700)
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

/** 点击弹出工具栏中文字匹配的按钮 */
async function clickPopoverButton(matchText) {
  await page.evaluate((m) => {
    const btns = document.querySelectorAll('.selection-popover button')
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
await page.waitForTimeout(700)
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
const navTime = await page.locator('.article-status span').last().innerText()
check('阅读时长实时显示', /^\d{2}:\d{2}$/.test(navTime), navTime)
// 阅读页切换主题 → 全局生效并持久化
const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme)
await page.evaluate(() => {
  const btns = document.querySelectorAll('.article-tools .tool button')
  for (const b of btns) if (b.textContent.includes('↻')) b.click()
})
await page.waitForTimeout(300)
const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme)
check('阅读页切主题全局生效', themeAfter !== themeBefore, `${themeBefore} → ${themeAfter}`)
const themeStoreData = await page.evaluate(() => JSON.parse(localStorage.getItem('readbook:theme') || '{}'))
check('阅读页切主题持久化', themeStoreData.state?.theme === themeAfter, `theme=${themeStoreData.state?.theme}`)

// ---------- 阅读页：高亮 ----------
await open('/reading/p0001')
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
await page.waitForTimeout(300)
await selectRange(0, 4, 16)
check('选择后弹出工具栏', (await page.evaluate(() => document.querySelector('.selection-popover')?.classList.contains('show'))) === true)
check('色板含 5 种颜色', (await page.locator('.hl-dots .hl-dot').count()) === 5)
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

// ---------- 跨文章隔离：a01 的高亮不能出现在 a02 ----------
await open('/reading/p0002')
check('其他文章无串标', (await page.locator('.article-body .highlighted').count()) === 0)
await open('/reading/p0001')
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
await page.waitForTimeout(300)

// ---------- 阅读页：下划线 ----------
await selectRange(1, 2, 10)
await clickPopoverButton('下划线')
check('下划线标记渲染', (await page.locator('.article-body .underlined').count()) >= 1)

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

// ---------- 我的摘录 ----------
await open('/notes')
// 离开阅读页后，实测时长已落盘
const afterLeave = JSON.parse((await idbGet('readbook:articles')) ?? '{}')
const spent = afterLeave.state?.progress?.['p0001']?.timeSpentSec
check('阅读时长持久化', spent >= 1, `timeSpentSec=${spent}`)
const noteRows = await page.locator('.note-row').count()
check('摘录列表', noteRows >= 3, `${noteRows} 行`)
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

// ---------- 原文内删除：高亮 ----------
await page.evaluate(() => {
  const el = document.querySelector('.article-body .highlighted')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
check('点击高亮出现删除操作', (await page.evaluate(() => document.querySelector('.ann-popover')?.classList.contains('show'))) === true)
await page.evaluate(() => {
  const btns = document.querySelectorAll('.ann-popover button')
  for (const b of btns) if (b.textContent.includes('删除')) b.click()
})
await page.waitForTimeout(250)
check('删除后高亮消失', (await page.locator('.article-body .highlighted').count()) === 0)
const annAfterDel = JSON.parse((await idbGet('readbook:annotations')) ?? '{}').state?.annotations ?? []
check('删除后持久化同步', !annAfterDel.some((a) => a.kind === 'highlight'))

// ---------- 原文内删除：笔记 ----------
// 先点击 ✦ 锚点展开 inline note（默认收起）
await page.evaluate(() => {
  const mark = document.querySelector('.article-body .note-mark')
  if (mark) mark.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
check('点击锚点展开笔记', (await page.locator('.inline-note.show').count()) === 1)
await page.evaluate(() => {
  const btns = document.querySelectorAll('.inline-note.show .note-head button')
  for (const b of btns) if (b.textContent.includes('删除')) b.click()
})
await page.waitForTimeout(250)
check('删除笔记后锚点消失', (await page.locator('.article-body .note-mark').count()) === 0)
const annAfterNoteDel = JSON.parse((await idbGet('readbook:annotations')) ?? '{}').state?.annotations ?? []
check('笔记删除持久化同步', !annAfterNoteDel.some((a) => a.kind === 'note'))

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

// ---------- 文章管理：录入 / 编辑 / 删除 ----------
await open('/admin')
await page.locator('.admin-form input[placeholder="文章标题"]').fill('测试录入：基层减负要久久为功')
await page.locator('.admin-form textarea[placeholder^="第一段"]').fill('基层是服务群众的最后一公里。\n减负不是减责任，而是把干部从形式主义中解放出来。')
await page.locator('.admin-form-actions .ghost').first().click()
await page.waitForTimeout(300)
check('录入文章加入列表', (await page.evaluate(() => document.body.innerText.includes('测试录入：基层减负要久久为功'))))
await open('/library')
check('录入文章进入文章库', (await page.evaluate(() => document.body.innerText.includes('测试录入：基层减负要久久为功'))))
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.article-row')].find((r) => r.innerText.includes('测试录入'))
  if (row) row.click()
})
await page.waitForTimeout(500)
check('录入文章可阅读', (await page.locator('.reading-page').count()) === 1)
await open('/admin')
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.admin-row')].find((r) => r.innerText.includes('测试录入'))
  for (const b of row.querySelectorAll('button')) if (b.textContent.includes('编辑')) b.click()
})
await page.waitForTimeout(300)
await page.locator('.admin-form input[placeholder="文章标题"]').fill('测试录入：基层减负要久久为功（改）')
await page.locator('.admin-form-actions .ghost').first().click()
await page.waitForTimeout(300)
check('编辑文章生效', (await page.evaluate(() => document.body.innerText.includes('（改）'))))
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.admin-row')].find((r) => r.innerText.includes('测试录入'))
  for (const b of row.querySelectorAll('button')) if (b.textContent.includes('删除')) b.click()
})
await page.waitForTimeout(300)
check('删除文章', (await page.evaluate(() => !document.body.innerText.includes('测试录入'))))

// ---------- 数据导入 ----------
await open('/settings')
const importPayload = {
  exportedAt: '2024-06-01T00:00:00.000Z',
  theme: 'night',
  readerSettings: { fontSize: 20, lineHeight: 2.0, fontFamily: 'kaiti', readerTheme: '', reducedMotion: false, showAnnotations: true },
  articles: [{ id: 'a05', title: 'x', topic: '时政评论', source: '申论精读', date: '2024-05-06', progress: { articleId: 'a05', percent: 42, lastPosition: 0, lastReadAt: '2024-06-01T00:00:00.000Z', completed: false, readCount: 1, favorite: false, timeSpentSec: 120 } }],
  annotations: [{ id: 'imp-1', articleId: 'a05', kind: 'highlight', text: '导入测试高亮文字', start: 1, end: 5, createdAt: '2024-06-01T00:00:00.000Z', color: 'green' }],
}
await page.setInputFiles('input[type="file"]', {
  name: 'readbook-import.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(importPayload)),
})
await page.waitForTimeout(900)
const impTheme = await page.evaluate(() => document.documentElement.dataset.theme)
check('导入主题生效', impTheme === 'night', impTheme)
const impArt = JSON.parse((await idbGet('readbook:articles')) ?? '{}')
check('导入进度合并', impArt.state?.progress?.['a05']?.percent === 42, `percent=${impArt.state?.progress?.['a05']?.percent}`)
const impAnn = JSON.parse((await idbGet('readbook:annotations')) ?? '{}')
check('导入摘录合并', (impAnn.state?.annotations ?? []).some((a) => a.id === 'imp-1'))

// ---------- 摘要 ----------
console.log('\n================ 测试摘要 ================')
const fails = results.filter((r) => !r.ok)
console.log(`共 ${results.length} 项，失败 ${fails.length} 项`)
if (errors.length) {
  console.log('浏览器错误：')
  errors.slice(0, 10).forEach((e) => console.log('  ', e))
}
await browser.close()
process.exit(fails.length > 0 || errors.length > 0 ? 1 : 0)
