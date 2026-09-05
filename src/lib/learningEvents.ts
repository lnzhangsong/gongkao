/**
 * 学习者数据模型：证据类型表（docs/学习者数据模型设计.md 3.2）
 *
 * 理念：掌握度是推导出来的输出，不是用户手动申报的输入。
 * 用户每个动作都是对某个掌握对象的一次证据采集，只追加、不改写。
 * 权重为理念示意，推导规则以「何种证据组合触发何种状态」为准（learnerProfile）。
 */

export type LearningObjectType = 'article' | 'material' | 'ability' | 'term'

export type EvidenceKind =
  | 'read-finish' /* 完成阅读（percent ≥ 95） */
  | 'deconstruct' /* 主动加工：核心观点/分论点/段意/骨架 */
  | 'review-note' /* 写学习心得 */
  | 'tag-material' /* 标注为素材 */
  | 'memorize' /* 加入背记 */
  | 'mastery-self' /* 掌握度自评 */
  | 'material-use' /* 素材被用进框架/作答（使用即复习，最强素材证据） */
  | 'exam-answer' /* 真题要点加工（第 3 期回流） */
  | 'infer-answer' /* AI 反向出题作答（第 3 期回流） */
  | 'term-seen' /* 规范词在视区驻留 ≥8s：注意力级「见过」证据 */

export const EVIDENCE: Record<EvidenceKind, { objectType: LearningObjectType; weight: 1 | 2 | 3 | 4 }> = {
  'read-finish': { objectType: 'article', weight: 1 },
  deconstruct: { objectType: 'article', weight: 2 },
  'review-note': { objectType: 'article', weight: 3 },
  'tag-material': { objectType: 'material', weight: 1 },
  memorize: { objectType: 'material', weight: 1 },
  'mastery-self': { objectType: 'material', weight: 2 },
  'material-use': { objectType: 'material', weight: 4 },
  'exam-answer': { objectType: 'ability', weight: 4 },
  'infer-answer': { objectType: 'ability', weight: 3 },
  'term-seen': { objectType: 'term', weight: 1 },
}
