import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('dialog', (d) => d.accept())
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
// 新建文章
await page.goto('http://localhost:5173/admin', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
console.log('admin rows:', await page.locator('.admin-row').count())
await page.locator('.admin-form input[placeholder="文章标题"]').fill('测试录入：基层减负要久久为功')
await page.locator('.admin-form textarea[placeholder^="第一段"]').fill('基层是服务群众的最后一公里。\n减负不是减责任，而是把干部从形式主义中解放出来。')
await page.locator('.admin-form-actions .ghost').first().click()
await page.waitForTimeout(400)
console.log('rows after add:', await page.locator('.admin-row').count())
const has = await page.evaluate(() => document.body.innerText.includes('测试录入：基层减负要久久为功'))
console.log('new article in list:', has)
// 文章库可见
await page.goto('http://localhost:5173/library', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
const libHas = await page.evaluate(() => document.body.innerText.includes('测试录入：基层减负要久久为功'))
console.log('visible in library:', libHas)
// 阅读页
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.article-row')]
  const row = rows.find((r) => r.innerText.includes('测试录入'))
  if (row) row.click()
})
await page.waitForTimeout(600)
console.log('reading page:', await page.locator('.reading-page').count(), '| title ok:', await page.evaluate(() => document.body.innerText.includes('测试录入：基层减负要久久为功')))
// 编辑
await page.goto('http://localhost:5173/admin', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.admin-row')]
  const row = rows.find((r) => r.innerText.includes('测试录入'))
  const btns = row.querySelectorAll('button')
  for (const b of btns) if (b.textContent.includes('编辑')) b.click()
})
await page.waitForTimeout(300)
await page.locator('.admin-form input[placeholder="文章标题"]').fill('测试录入：基层减负要久久为功（改）')
await page.locator('.admin-form-actions .ghost').first().click()
await page.waitForTimeout(300)
console.log('edited visible:', await page.evaluate(() => document.body.innerText.includes('（改）')))
// 删除
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.admin-row')]
  const row = rows.find((r) => r.innerText.includes('测试录入'))
  const btns = row.querySelectorAll('button')
  for (const b of btns) if (b.textContent.includes('删除')) b.click()
})
await page.waitForTimeout(300)
console.log('after delete:', await page.evaluate(() => document.body.innerText.includes('测试录入')))
await browser.close()
