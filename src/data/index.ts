import { PARSED_ARTICLES } from './articlesParsed'
import type { Article, ArticleTopic } from '../types'

/** 全部文章：由 data/articles.db（SQLite）生成，见 scripts/articles-pipeline.mjs */
export const ARTICLES: Article[] = PARSED_ARTICLES

export const TOPICS: ArticleTopic[] = [
  '基层治理',
  '民生保障',
  '文化自信',
  '乡村振兴',
  '人民立场',
  '时政评论',
  '生态文明',
  '科技创新',
  '经济发展',
  '法治建设',
  '教育人才',
  '对外开放',
]

export function getArticle(id: string): Article | undefined {
  return ARTICLES.find((a) => a.id === id)
}

/** 按字数估算阅读分钟数（录入文章时使用） */
export function computeReadTime(content: string[]): number {
  const chars = content.join('').length + 200
  return Math.max(3, Math.round(chars / 380))
}

/** 根据序号生成 NO. 编号，如 a01 -> 024 风格展示位 */
export function articleNo(id: string): string {
  const n = Number(id.replace(/\D/g, ''))
  return String(n + 10).padStart(3, '0')
}

export function formatDate(iso: string): string {
  return iso.replace(/-/g, '.')
}

export function monthLabel(iso: string): string {
  const [, m] = iso.split('-')
  const y = iso.slice(0, 4)
  return `${y} 年 ${m} 月`
}
