import { MOCK_ARTICLES } from './articlesPart1'
import { MOCK_ARTICLES_PART2 } from './articlesPart2'
import type { Article, ArticleTopic } from '../types'

export const MOCK_ARTICLES_ALL: Article[] = [...MOCK_ARTICLES, ...MOCK_ARTICLES_PART2]

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
  return MOCK_ARTICLES_ALL.find((a) => a.id === id)
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
