/**
 * 申论真题文本工具：段落重排 / 题干元信息抽取 / 题干-材料关联。
 * 从 ExamPreviewPage 抽出，供页面与其子组件共用。
 */

/** 段内硬换行拼接：返回重排后的段落数组 */
export function joinParagraphs(text: string): string[] {
  const HEAD = /^(?:材料\s*[0-9一二三四五六七八九十]+|【[^】]*】|问题\s*[一二三四五六七八九十1-9]+[：:：]?|[一二三四五六七八九十]+[、.]|\d{1,2}[、.．]|要求[（(:：]|答卷|参考答案)/
  const paras: string[] = []
  let cur = ''
  for (const raw of text.split('\n')) {
    const line = raw.replace(/[ \t\u3000]+/g, ' ').trim()
    if (!line) {
      if (cur) paras.push(cur)
      cur = ''
      continue
    }
    if (!cur) {
      cur = line
      continue
    }
    if (HEAD.test(line) || /[。！？；…”）』」!?]$/.test(cur)) {
      paras.push(cur)
      cur = line
    } else {
      cur += line
    }
  }
  if (cur) paras.push(cur)
  return paras
}

export const reflowParagraphs = (text: string) => joinParagraphs(text).join('\n\n')
export const reflowInline = (text: string) => text.replace(/\s+/g, '')

/* 从题干自动读取字数限制与分值（“不超过300字”“250-300字”“（15分）”等） */
const toAsciiNum = (s: string) => parseInt(s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)), 10)

export function extractWordLimit(text: string): number | null {
  for (const [, a, b] of text.matchAll(/(?:不超过|不多于|不多于|不超过|不得超过|字数\s*(?:在|为)?|控制在)?\s*([0-9０-９]{2,4})\s*(?:[-—~至]\s*([0-9０-９]{2,4}))?\s*字/g)) {
    const hi = b ? toAsciiNum(b) : toAsciiNum(a)
    if (hi >= 20 && hi <= 5000) return hi
  }
  return null
}

export function extractPoints(text: string): number | null {
  for (const m of text.matchAll(/(?:^|[^\d])([0-9０-９]{1,3})\s*分/g)) {
    const v = toAsciiNum(m[1])
    if (v >= 1 && v <= 100) return v
  }
  return null
}

/* 题干/要求中引用的材料编号（“给定资料N”“材料N”“资料1-4”，含中文数字） */
const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const toNum = (num: string): number => {
  const ascii = num.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248))
  return /^[0-9]+$/.test(ascii) ? parseInt(ascii, 10) : CN_NUM[num] ?? 0
}

export function questionMaterials(q: { stem: string; requirement: string }): number[] {
  const text = `${q.stem}\n${q.requirement}`
  const found = new Set<number>()
  for (const [, a, b] of text.matchAll(/(?:给定)?[材资]料?\s*([0-9０-９]+|[一二三四五六七八九十]+)(?:\s*[-—~至]\s*([0-9０-９]+|[一二三四五六七八九十]+))?/g)) {
    const start = toNum(a)
    const end = b ? toNum(b) : start
    for (let n = start; n >= 1 && n <= end && n - start < 12; n++) found.add(n)
  }
  return [...found].sort((x, y) => x - y)
}

/* 层级 → 卡片底色（与首页三卡同源的配色语言；未知层级回退纸面） */
export function levelClass(level: string): string {
  if (level.includes('副省')) return ' exam-lv-a'
  if (level.includes('地市')) return ' exam-lv-b'
  if (level.includes('行政执法')) return ' exam-lv-c'
  return ''
}

/* 层级 → 右下角水印单字 */
export function levelMark(level: string): string {
  if (level.includes('副省')) return '省'
  if (level.includes('地市')) return '市'
  if (level.includes('行政执法')) return '法'
  return ''
}
