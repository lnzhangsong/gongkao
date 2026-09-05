import type { Annotation } from '../types'
import type { LearningEvent } from '../stores/learningEventStore'

/**
 * 素材可提取概率估计（docs/学习者数据模型设计.md「使用中强化」算法选型）。
 *
 * 选型：FSRS-4.5 的幂律遗忘曲线简化版，R(t) = (1 + t / (FACTOR·S))^(−DECAY)。
 * - FSRS（DSR 模型）是当前间隔重复的实测最优开源算法，但完整版需要逐次「对/错」二元
 *   评分历史；本产品目前只有事件时间戳 + 掌握度自评（0/1/2），故只取其遗忘曲线，
 *   稳定性 S 用「当前掌握度 + 使用次数」近似，不引入逐次评分。
 * - SM-2（Anki 经典）需要固定间隔调度，与「使用即复习」的非定期提取不匹配；
 *   半衰期回归（Half-Life Regression）需要训练数据，单机场景没有。
 * - 升级路径：若翻转卡/回声里开始收集「对/错」评分，可平滑升级为完整 FSRS 参数拟合。
 *
 * 用途：不是调度器，是排序器——决定旧素材在 AI 召回（回声）中的优先序，
 * 快忘的先被使用，使用本身完成复习。
 */

const FACTOR = 9
const DECAY = 2

/** 稳定性初值（天）：按当前自评掌握度近似 */
function baseStability(mastery: Annotation['mastery']): number {
  if (mastery === 2) return 15
  if (mastery === 1) return 6
  return 3
}

/** 素材当前的可提取概率 R ∈ (0, 1]：距最近一次证据越久越低，用过/掌握过越稳越高 */
export function recallProbability(ann: Annotation, events: LearningEvent[]): number {
  const lastAt = events.reduce<string | null>(
    (acc, e) => (e.objectId === ann.id && (!acc || e.at > acc) ? e.at : acc),
    null,
  )
  const s = baseStability(ann.mastery)
  if (!lastAt) {
    /* 从无证据的背记素材按创建时间起算，避免恒为 1 */
    const days = (Date.now() - new Date(ann.createdAt).getTime()) / 86400000
    return Math.pow(1 + days / (FACTOR * s), -DECAY)
  }
  /* 使用是最强巩固：每次使用（material-use）让稳定性 ×1.3，封顶 5 次 */
  const uses = events.filter((e) => e.objectId === ann.id && e.kind === 'material-use').length
  const stability = s * Math.pow(1.3, Math.min(uses, 5))
  const days = (Date.now() - new Date(lastAt).getTime()) / 86400000
  return Math.pow(1 + days / (FACTOR * stability), -DECAY)
}

/** 回声排序：可提取概率低的排前（快忘的优先被 AI 看见/使用）；同概率按创建时间早的优先 */
export function echoCompare(
  a: { annotation: Annotation },
  b: { annotation: Annotation },
  events: LearningEvent[],
): number {
  const ra = recallProbability(a.annotation, events)
  const rb = recallProbability(b.annotation, events)
  if (ra !== rb) return ra - rb
  return a.annotation.createdAt.localeCompare(b.annotation.createdAt)
}
