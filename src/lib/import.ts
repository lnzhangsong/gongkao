import type {
  Annotation,
  Article,
  ArticleSource,
  ArticleTopic,
  ReaderSettings,
  ReadingProgress,
  ThemeName,
} from '../types'
import { THEMES } from '../stores/themeStore'
import { TOPICS, computeReadTime } from '../data'

export interface ParsedImport {
  theme?: ThemeName
  readerSettings?: Partial<ReaderSettings>
  /** 文章阅读进度（按 articleId 合并覆盖） */
  progress?: Record<string, ReadingProgress>
  /** 摘录（按 id 去重合并） */
  annotations: Annotation[]
  /** 文章（带正文内容，按 id 覆盖/追加） */
  articles?: Article[]
}

export interface ImportFailure {
  error: string
}

/** 校验一条摘录的最小结构 */
function isAnnotationShape(v: unknown): v is Annotation {
  if (!v || typeof v !== 'object') return false
  const a = v as Record<string, unknown>
  return (
    typeof a.id === 'string' &&
    typeof a.articleId === 'string' &&
    (a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'note') &&
    typeof a.text === 'string' &&
    typeof a.start === 'number' &&
    typeof a.end === 'number'
  )
}

/** 校验一篇文章进度条目 */
function isProgressShape(v: unknown): v is ReadingProgress {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return typeof p.articleId === 'string' && typeof p.percent === 'number'
}

/** 从整包导出中提取带正文的文章 */
function parseArticles(v: unknown): Article[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Article[] = []
  for (const item of v) {
    const a = item as Record<string, unknown>
    if (
      !a ||
      typeof a.id !== 'string' ||
      typeof a.title !== 'string' ||
      !Array.isArray(a.content)
    ) {
      continue
    }
    const content = (a.content as unknown[]).filter((p): p is string => typeof p === 'string')
    if (content.length === 0) continue
    const topic = TOPICS.includes(a.topic as ArticleTopic)
      ? (a.topic as ArticleTopic)
      : TOPICS[0]
    const source: ArticleSource = a.source === '申论精读' ? '申论精读' : '人民日报'
    out.push({
      id: a.id,
      title: a.title,
      summary: typeof a.summary === 'string' ? a.summary : '',
      content,
      source,
      topic,
      date: typeof a.date === 'string' ? a.date : new Date().toISOString().slice(0, 10),
      readTime: computeReadTime(content),
      pullquote: typeof a.pullquote === 'string' ? a.pullquote : undefined,
      finishNote: typeof a.finishNote === 'string' ? a.finishNote : undefined,
      featured: a.featured === true ? true : undefined,
    })
  }
  return out.length > 0 ? out : undefined
}

/**
 * 解析导入文件内容。
 * 支持两种格式：
 *  1. 设置页导出的整包：{ exportedAt, theme, readerSettings, articles:[{...progress}], annotations:[...] }
 *  2. 摘录页导出的数组：Annotation[]
 * 校验失败的字段会被跳过，完全不认识的内容返回错误。
 */
export function parseImportData(raw: string): ParsedImport | ImportFailure {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { error: '文件不是有效的 JSON，请选择导出的 .json 文件' }
  }

  // 格式 2：直接是摘录数组
  if (Array.isArray(data)) {
    const annotations = data.filter(isAnnotationShape)
    if (annotations.length === 0) return { error: '文件中没有可识别的摘录数据' }
    return { annotations }
  }

  if (!data || typeof data !== 'object') {
    return { error: '无法识别的数据格式' }
  }
  const obj = data as Record<string, unknown>

  const result: ParsedImport = { annotations: [] }
  let recognized = false

  // 主题
  if (typeof obj.theme === 'string' && THEMES.some((t) => t.name === obj.theme)) {
    result.theme = obj.theme as ThemeName
    recognized = true
  }

  // 阅读器设置
  if (obj.readerSettings && typeof obj.readerSettings === 'object') {
    const rs = obj.readerSettings as Record<string, unknown>
    const partial: Partial<ReaderSettings> = {}
    if (typeof rs.fontSize === 'number') partial.fontSize = rs.fontSize
    if (typeof rs.lineHeight === 'number') partial.lineHeight = rs.lineHeight
    if (typeof rs.fontFamily === 'string') partial.fontFamily = rs.fontFamily as ReaderSettings['fontFamily']
    if (typeof rs.readerTheme === 'string') partial.readerTheme = rs.readerTheme as ThemeName | ''
    if (typeof rs.reducedMotion === 'boolean') partial.reducedMotion = rs.reducedMotion
    if (typeof rs.showAnnotations === 'boolean') partial.showAnnotations = rs.showAnnotations
    if (Object.keys(partial).length > 0) {
      result.readerSettings = partial
      recognized = true
    }
  }

  // 文章进度与正文（整包导出时每个 article 带 progress / content 字段）
  if (Array.isArray(obj.articles)) {
    const progress: Record<string, ReadingProgress> = {}
    for (const item of obj.articles) {
      const art = item as Record<string, unknown>
      if (art && typeof art.id === 'string' && isProgressShape(art.progress)) {
        progress[art.id] = art.progress
      }
    }
    if (Object.keys(progress).length > 0) {
      result.progress = progress
      recognized = true
    }
    const articles = parseArticles(obj.articles)
    if (articles) {
      result.articles = articles
      recognized = true
    }
  }

  // 摘录
  if (Array.isArray(obj.annotations)) {
    const annotations = obj.annotations.filter(isAnnotationShape)
    if (annotations.length > 0) {
      result.annotations = annotations
      recognized = true
    }
  }

  if (!recognized) return { error: '文件内容与读本导出的数据格式不匹配' }
  return result
}
