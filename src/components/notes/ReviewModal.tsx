import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import type { Annotation } from '../../types'
import { useAnnotationStore } from '../../stores/annotationStore'
import { useLearningEventStore } from '../../stores/learningEventStore'
import { useArticleStore } from '../../stores/articleStore'
import { MATERIAL_TYPE_LABELS } from '../../data/material'

/**
 * 复习翻转卡（docs/申论阅读处理设计方案.md D6 / 学习者数据模型第 4 期）：
 * 正面金句/句式原句 → 翻面看模板与来源 → 自评 模糊/掌握，回写素材掌握度并记复习证据。
 * 事件层的同日去重保证一天内多次复习只计一条证据，次日重新可记。
 */
export function ReviewModal({ queue, onClose }: { queue: Annotation[]; onClose: () => void }) {
  const update = useAnnotationStore((s) => s.update)
  const getArticle = useArticleStore((s) => s.getArticle)
  const navigate = useNavigate()
  const [idx, setIdx] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [graded, setGraded] = useState<{ fuzzy: number; mastered: number }>({ fuzzy: 0, mastered: 0 })

  const ann = queue[idx]
  const articleTitle = useMemo(() => (ann ? (getArticle(ann.articleId)?.title ?? '') : ''), [ann, getArticle])

  if (!ann) {
    return (
      <div className="review-backdrop" onClick={onClose}>
        <div className="review-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="复习完成">
          <button className="review-close" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
          <div className="review-done">
            <span className="shenlun-eyebrow">REVIEW DONE</span>
            <h3>本轮复习完成</h3>
            <p>
              掌握 {graded.mastered} 条 · 仍模糊 {graded.fuzzy} 条
            </p>
            <button className="shenlun-save" onClick={onClose}>
              好的
            </button>
          </div>
        </div>
      </div>
    )
  }

  const grade = (lv: 1 | 2) => {
    update(ann.id, { mastery: lv, memorized: true })
    useLearningEventStore.getState().log('mastery-self', ann.id)
    setGraded((g) => (lv === 2 ? { ...g, mastered: g.mastered + 1 } : { ...g, fuzzy: g.fuzzy + 1 }))
    setRevealed(false)
    setIdx((i) => i + 1)
  }

  return (
    <div className="review-backdrop" onClick={onClose}>
      <div className="review-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="复习翻转卡">
        <button className="review-close" onClick={onClose} aria-label="关闭">
          <X size={16} />
        </button>

        <div className="review-progress">
          {idx + 1} / {queue.length}　·　{MATERIAL_TYPE_LABELS[ann.materialType!]}
        </div>

        <button
          className={`review-card${revealed ? ' flipped' : ''}`}
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? '翻回正面' : '翻面看答案'}
        >
          {!revealed ? (
            <blockquote>“{ann.text}”</blockquote>
          ) : (
            <div className="review-back">
              {ann.materialType === 'pattern' && (ann.pattern || ann.text) && (
                <p className="review-pattern">
                  <span className="skeleton-label">可迁移模板</span>
                  {ann.pattern || '（还没填模板，可到摘录页补充）'}
                </p>
              )}
              {ann.materialType === 'quote' && ann.noteText && (
                <p className="review-pattern">
                  <span className="skeleton-label">我的笔记</span>
                  {ann.noteText}
                </p>
              )}
              <p className="review-source">来源：{articleTitle || '未知文章'}</p>
              <span className="review-hint">这张卡会了吗？</span>
            </div>
          )}
        </button>
        {!revealed && <p className="review-hint">点击卡片翻面</p>}

        {revealed && (
          <div className="review-actions">
            <button className="ghost" onClick={() => grade(1)}>
              还模糊
            </button>
            <button
              className="primary"
              onClick={() => {
                grade(2)
              }}
            >
              已掌握
            </button>
          </div>
        )}

        {articleTitle && (
          <button className="text-btn review-goto" onClick={() => navigate(`/reading/${ann.articleId}`)}>
            回到原文 →
          </button>
        )}
      </div>
    </div>
  )
}
