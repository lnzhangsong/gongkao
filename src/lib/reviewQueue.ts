import type { Annotation } from '../types'
import type { LearningEvent } from '../stores/learningEventStore'

/**
 * 复习队列（docs/学习者数据模型设计.md 第 4 期）：
 * 背记素材的到期计算——事件层时间戳的直接消费者。
 *
 * 到期规则（初版，可演进为间隔重复）：
 * - 池：金句 / 句式且已加入背记；
 * - 未掌握（mastery ≠ 2）→ 立即到期；
 * - 已掌握 → 距上次复习证据超过 7 天重新到期。
 */

const RE_REVIEW_DAYS = 7

export function reviewQueue(
  annotations: Annotation[],
  events: LearningEvent[],
): Annotation[] {
  const lastAt = new Map<string, string>()
  for (const e of events) {
    const prev = lastAt.get(e.objectId)
    if (!prev || e.at > prev) lastAt.set(e.objectId, e.at)
  }
  const now = Date.now()
  const pool = annotations.filter(
    (a) =>
      a.kind === 'highlight' &&
      (a.materialType === 'quote' || a.materialType === 'pattern') &&
      a.memorized === true,
  )
  const due = pool.filter((a) => {
    if (a.mastery !== 2) return true
    const at = lastAt.get(a.id)
    if (!at) return true
    return now - new Date(at).getTime() > RE_REVIEW_DAYS * 24 * 3600 * 1000
  })
  /* 未掌握在前，其余按最近证据最旧优先 */
  return due.sort((x, y) => {
    if ((x.mastery === 2) !== (y.mastery === 2)) return x.mastery === 2 ? 1 : -1
    return (lastAt.get(x.id) ?? '').localeCompare(lastAt.get(y.id) ?? '')
  })
}
