/** 富文本笔记工具：HTML 净化、纯文本提取、图片压缩 */

/** 笔记 HTML 白名单净化：只保留排版/图片/链接所需的最小标签与属性 */
export function sanitizeNoteHtml(html: string): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const ALLOWED = new Set([
    'P', 'BR', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE',
    'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'IMG', 'A', 'MARK',
  ])

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      walk(child)
      if (!ALLOWED.has(child.tagName)) {
        // 不在白名单的元素：用其子内容替代（保留文字，去掉标签）
        child.replaceWith(...Array.from(child.childNodes))
        continue
      }
      // 属性白名单
      const keep: Array<[string, string | null]> = []
      if (child.tagName === 'IMG') {
        const src = child.getAttribute('src') ?? ''
        // 只允许 data:（本地压缩图）与 https: 图片
        if (/^(data:image\/|https:\/\/)/.test(src)) keep.push(['src', src])
        keep.push(['alt', child.getAttribute('alt')])
      }
      if (child.tagName === 'A') {
        const href = child.getAttribute('href') ?? ''
        if (/^(https?:\/\/)/.test(href)) {
          keep.push(['href', href])
          keep.push(['target', '_blank'])
          keep.push(['rel', 'noreferrer'])
        }
      }
      if (child.tagName === 'MARK' || child.tagName === 'SPAN') {
        const style = child.getAttribute('style')
        // 只放行背景色（高亮）与文字色
        const safe = style?.match(/(?:background-color|color)\s*:\s*[^;]+/g)?.join(';') ?? null
        if (safe) keep.push(['style', safe])
      }
      for (const attr of Array.from(child.attributes)) {
        if (!keep.some(([k, v]) => k === attr.name && v === attr.value)) {
          child.removeAttribute(attr.name)
        }
      }
      for (const [k, v] of keep) {
        if (v !== null) child.setAttribute(k, v)
      }
    }
  }
  walk(tpl.content as unknown as Element)
  return tpl.innerHTML
}

/** HTML → 纯文本（用于搜索、导出与空判断） */
export function noteHtmlToText(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return (div.textContent ?? '').replace(/\u00a0/g, ' ').trim()
}

/** 笔记是否无实质内容（无文字且无图片） */
export function isNoteEmpty(html: string): boolean {
  if (noteHtmlToText(html)) return false
  return !/<img\s/i.test(html)
}

/** 旧纯文本 → 安全 HTML（转义后按换行拆段） */
export function escapeToHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join('')
}

/** 图片文件压缩为 dataURL（长边 ≤1280、JPEG 0.82），控制笔记存储体积 */
export function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('不是图片文件'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const MAX = 1280
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(reader.result as string)
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.onerror = () => reject(new Error('图片读取失败'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}
