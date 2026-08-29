import type { ArticleTopic } from '../types'

/** 主题分类（构建期数据） */
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

/**
 * 文章数据不再打包进前端（2.1MB 年编正文）：
 * - meta 列表：GET /api/articles（不含正文，轻量，供首页/文章库/搜索/管理）
 * - 单篇全文：GET /api/articles/:id（含正文段落，阅读页按需拉取）
 * 数据源：data/articles.db（SQLite），由 Vercel Functions / 本地 api-server 只读提供。
 */

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

/** ISO 时间戳 → 本地日期字符串（yyyy.mm.dd）。
 *  注意不能用 toISOString().slice(0,10)：那是 UTC 日期，东八区晚 8 点后会提前一天 */
export function formatLocalDate(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

/** 文章 id → 统一编号展示（NO. 003 风格），全站一致 */
export function formatArticleNo(id: string): string {
  const n = Number(id.replace(/\D/g, ''))
  return Number.isNaN(n) ? id : String(n).padStart(3, '0')
}

export function monthLabel(iso: string): string {
  const [, m] = iso.split('-')
  const y = iso.slice(0, 4)
  return `${y} 年 ${m} 月`
}
