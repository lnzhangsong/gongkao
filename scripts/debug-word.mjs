import { chromium } from 'playwright-core'
import { readFileSync } from 'fs'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto('http://localhost:5173/admin', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
// 上传 docx
await page.setInputFiles('input[type="file"]', {
  name: 'sample.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: readFileSync('scripts/fixtures/sample.docx'),
})
await page.waitForTimeout(1200)
console.log('title filled:', await page.locator('.admin-form input[placeholder="文章标题"]').inputValue())
const content = await page.locator('.admin-form textarea[placeholder^="第一段"]').inputValue()
console.log('content lines:', JSON.stringify(content.split('\n')))
console.log('error shown:', await page.evaluate(() => document.body.innerText.includes('Word')))
await browser.close()
