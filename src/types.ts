/** 文章来源 */
export type ArticleSource = '人民日报' | '申论精读'

/** 录入/编辑文章时的输入 */
export interface ArticleInput {
  title: string
  summary: string
  content: string[]
  source: ArticleSource
  topic: ArticleTopic
  date: string
  pullquote?: string
  finishNote?: string
}

/** 文章主题（共 12 个） */
export type ArticleTopic =
  | '基层治理'
  | '民生保障'
  | '文化自信'
  | '乡村振兴'
  | '人民立场'
  | '时政评论'
  | '生态文明'
  | '科技创新'
  | '经济发展'
  | '法治建设'
  | '教育人才'
  | '对外开放'

/** 统一文章模型 */
export interface Article {
  id: string
  title: string
  /** 导语 / 摘要 */
  summary: string
  /**
   * 正文段落（按段存储，便于基于文本偏移量的标注）
   * meta 列表（GET /api/articles）不含正文；单篇（GET /api/articles/:id）含
   */
  content?: string[]
  /** 金句（引用块） */
  pullquote?: string
  /** 阅读结尾的摘录金句 */
  finishNote?: string
  source: ArticleSource
  topic: ArticleTopic
  /** YYYY-MM-DD */
  date: string
  /** 预计阅读分钟数 */
  readTime: number
  /** 是否首页推荐 */
  featured?: boolean
}

/** 阅读进度 */
export interface ReadingProgress {
  articleId: string
  /** 0-100 */
  percent: number
  /** 滚动位置（px） */
  lastPosition: number
  lastReadAt: string
  completed: boolean
  /** 首次打开时间 */
  startedAt?: string
  /** 累计阅读次数 */
  readCount: number
  favorite: boolean
  /** 实测累计阅读时长（秒），跨会话累加 */
  timeSpentSec?: number
}

export type ThemeName = 'paper' | 'blue' | 'night' | 'violet' | 'graphite'

/** 阅读器设置 */
export interface ReaderSettings {
  /** 正文字号 px */
  fontSize: number
  /** 行高 */
  lineHeight: number
  /** 正文字体 */
  fontFamily: 'songti' | 'jinkai' | 'kaiti' | 'fangsong' | 'sans' | 'system'
  /** 阅读页主题（空 = 跟随页面主题） */
  readerTheme: ThemeName | ''
  /** 减少动效 */
  reducedMotion: boolean
  /** 显示已保存的高亮/划线 */
  showAnnotations: boolean
  /** 段落聚焦：突出当前段落，其余淡化 */
  focusMode: boolean
  /** 版面宽度：normal 标准 / narrow 收窄（约 40 字/行） */
  measure: 'normal' | 'narrow'
  /** 段首缩进两格（默认开，与现有排版一致） */
  indent: boolean
}

export type AnnotationKind = 'highlight' | 'underline' | 'note'

/** 下划线样式 */
export const UNDERLINE_STYLES = ['solid', 'double', 'wavy', 'dotted'] as const
export type UnderlineStyle = (typeof UNDERLINE_STYLES)[number]

export const UNDERLINE_STYLE_LABELS: Record<UnderlineStyle, string> = {
  solid: '实线',
  double: '双线',
  wavy: '波浪',
  dotted: '点线',
}

/** 高亮可选颜色 */
export const HL_COLORS = ['yellow', 'blue', 'green', 'pink', 'violet'] as const
export type HighlightColor = (typeof HL_COLORS)[number]

export const HL_COLOR_LABELS: Record<HighlightColor, string> = {
  yellow: '暖黄',
  blue: '冷蓝',
  green: '松绿',
  pink: '樱粉',
  violet: '柔紫',
}

/**
 * 标注统一模型。
 * start / end 为文章正文扁平化文本（段落以 \n 连接）中的字符偏移。
 */
export interface Annotation {
  id: string
  articleId: string
  kind: AnnotationKind
  /** 选中的原文文字 */
  text: string
  start: number
  end: number
  createdAt: string
  /** highlight 类型的颜色（默认 yellow） */
  color?: HighlightColor
  /** underline 类型的样式（默认 solid） */
  underlineStyle?: UnderlineStyle
  /** note 类型时：笔记正文 */
  noteText?: string
  tags?: string[]
}
