import type { Annotation, ReaderSettings, ReadingProgress, ThemeName } from '../types'
import { THEMES } from '../stores/themeStore'

export interface ParsedImport {
  theme?: ThemeName
  readerSettings?: Partial<ReaderSettings>
  /** 文章阅读进度（按 articleId 合并覆盖） */
  progress?: Record<string, ReadingProgress>
  /** 摘录（按 id 去重合并） */
  annotations: Annotation[]
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

  // 文章进度（整包导出时每个 article 带 progress 字段）
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
