// @vitest-environment happy-dom
import { describe, expect, it } from 'vite-plus/test'
import { escapeToHtml, isNoteEmpty, noteHtmlToText, sanitizeNoteHtml } from './richNote'

/**
 * 富文本笔记的 HTML 净化 —— 安全边界。
 * 笔记内容可来自用户输入与 AI，必须保证脚本、事件处理器、javascript: 链接
 * 与越界样式无法穿过净化层落进 IndexedDB 并在之后被渲染。
 */

describe('sanitizeNoteHtml：危险内容必须被清除', () => {
  it('script 标签被去掉（内容退化为纯文本，不可执行）', () => {
    const out = sanitizeNoteHtml('<p>前</p><script>alert(1)</script><p>后</p>')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/alert\(1\)\s*<\/script>/i)
    expect(out).toContain('前')
    expect(out).toContain('后')
  })

  it('事件处理器属性被剥掉', () => {
    const out = sanitizeNoteHtml('<p onclick="alert(1)" onmouseover="x()">文字</p>')
    expect(out).not.toMatch(/onclick/i)
    expect(out).not.toMatch(/onmouseover/i)
    expect(out).toContain('文字')
  })

  it('javascript: 链接被剥掉（标签保留）', () => {
    const out = sanitizeNoteHtml('<a href="javascript:alert(1)">点我</a>')
    expect(out).not.toMatch(/javascript:/i)
    expect(out).toContain('点我')
  })

  it('iframe / object / style 等标签被去掉，文字保留', () => {
    const out = sanitizeNoteHtml('<iframe src="https://evil"></iframe><object></object><p>正文</p>')
    expect(out).not.toMatch(/<iframe|<object/i)
    expect(out).toContain('正文')
  })

  it('非白名单标签被拆掉但保留其文字（含嵌套）', () => {
    const out = sanitizeNoteHtml('<table><tr><td>单元格</td></tr></table>')
    expect(out).not.toMatch(/<table|<tr|<td/i)
    expect(out).toContain('单元格')
  })

  it('style 只放行 SPAN / MARK 上的 color 与 background-color', () => {
    const span = sanitizeNoteHtml('<span style="color:red;background-color:blue;position:fixed">x</span>')
    expect(span).toContain('color:red')
    expect(span).toContain('background-color:blue')
    expect(span).not.toContain('position')

    /* 其它标签上的 style 一律去掉 */
    const p = sanitizeNoteHtml('<p style="color:red">x</p>')
    expect(p).not.toContain('style')
  })

  it('img：只允许 data:image 与 https 源，alt 保留', () => {
    expect(sanitizeNoteHtml('<img src="data:image/png;base64,AAA" alt="图">')).toContain(
      'src="data:image/png;base64,AAA"',
    )
    expect(sanitizeNoteHtml('<img src="https://cdn.example.com/a.png">')).toContain('https://cdn.example.com/a.png')
    expect(sanitizeNoteHtml('<img src="http://insecure.example.com/a.png">')).not.toContain('src=')
    expect(sanitizeNoteHtml('<img src="javascript:alert(1)">')).not.toContain('src=')
  })
})

describe('sanitizeNoteHtml：正常排版被保留', () => {
  it('白名单标签原样留下', () => {
    const html =
      '<p><strong>粗</strong><em>斜</em><u>下划</u><s>删</s></p><ul><li>项</li></ul><blockquote>引</blockquote><h2>标题</h2>'
    const out = sanitizeNoteHtml(html)
    for (const tag of ['<p>', '<strong>', '<em>', '<u>', '<s>', '<ul>', '<li>', '<blockquote>', '<h2>']) {
      expect(out).toContain(tag)
    }
  })

  it('https 链接补上 target 与 rel', () => {
    const out = sanitizeNoteHtml('<a href="https://example.com">外链</a>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noreferrer"')
  })
})

describe('noteHtmlToText', () => {
  it('取纯文本、把不换行空格还原为普通空格、首尾去空', () => {
    expect(noteHtmlToText('<p>  你好&nbsp;世界  </p>')).toBe('你好 世界')
    expect(noteHtmlToText('<p>a</p><p>b</p>')).toContain('a')
  })
})

describe('isNoteEmpty', () => {
  it('无文字且无图片 → 空', () => {
    expect(isNoteEmpty('')).toBe(true)
    expect(isNoteEmpty('<p></p>')).toBe(true)
    expect(isNoteEmpty('<p><br></p>')).toBe(true)
    expect(isNoteEmpty('<p>   </p>')).toBe(true)
  })

  it('有文字 → 非空', () => {
    expect(isNoteEmpty('<p>x</p>')).toBe(false)
  })

  it('只有图片 → 非空', () => {
    expect(isNoteEmpty('<p><img src="data:image/png;base64,AAA"></p>')).toBe(false)
  })
})

describe('escapeToHtml', () => {
  it('转义尖括号与 &，并按换行拆成段落', () => {
    expect(escapeToHtml('a<b')).toBe('<p>a&lt;b</p>')
    expect(escapeToHtml('a&b')).toBe('<p>a&amp;b</p>')
    expect(escapeToHtml('一\n二')).toBe('<p>一</p><p>二</p>')
  })

  it('忽略空行', () => {
    expect(escapeToHtml('一\n\n\n二')).toBe('<p>一</p><p>二</p>')
    expect(escapeToHtml('')).toBe('')
  })
})
