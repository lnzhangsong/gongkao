import type { ArticleStudy, StudyStatus } from '../stores/shenlunStore'

/**
 * 学习者数据模型：推导层（docs/学习者数据模型设计.md 第 2 期）
 *
 * 文章层状态推导规则（初版）：
 * - 任一主动加工证据（核心观点/分论点/段意/骨架有实质内容）→ 学习中；
 * - 学习心得 → 已掌握候选（本文先做到候选提示，确认仍归用户，见第 3/4 期）。
 * 用户手动设置过的状态视为「钉住」（pinned），推导不再升降，直到解除钉住。
 */

/** 核心观点 / 分论点 / 段意 / 骨架任一有实质内容 */
export function hasStudyContent(study: ArticleStudy | undefined): boolean {
  if (!study) return false
  if (study.coreThesis.trim()) return true
  if (study.subTheses.some((t) => t.trim())) return true
  if (study.paragraphSummaries?.some((p) => p.summary.trim())) return true
  const sk = study.skeleton
  if (sk?.opening?.trim() || sk?.closing?.trim()) return true
  if (sk?.bodyLayers?.some((t) => t.trim()) || sk?.transitions?.some((t) => t.trim())) return true
  return false
}

/**
 * 状态自动推进建议：未钉住、仍为「未学」且有实质加工内容 → 学习中。
 * 返回 null 表示维持现状。
 */
export function deriveStatus(study: ArticleStudy | undefined): StudyStatus | null {
  if (!study) return null
  if (study.pinned) return null
  if (study.status === 'new' && hasStudyContent(study)) return 'learning'
  return null
}
