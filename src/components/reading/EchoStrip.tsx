import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAnnotationStore } from '../../stores/annotationStore'
import { useArticleStore } from '../../stores/articleStore'
import { useShenlunStore } from '../../stores/shenlunStore'
import { recallProbability } from '../../lib/mastery'
import { useLearningEventStore } from '../../stores/learningEventStore'
import type { ArticleTopic } from '../../types'

interface EchoItem {
  key: string
  to: string
  label: string
  meta: string
}

/**
 * 回声条（学习者数据模型「使用即复习」）：打开一篇新文章时，
 * 让旧积累以线索的形式回到眼前——快忘的背记素材优先（ recallProbability 升序），
 * 其次是同主题拆过的文章。只陈述关联，不打断阅读。
 */
export function EchoStrip({ articleId, topic }: { articleId: string; topic?: ArticleTopic }) {
  const annotations = useAnnotationStore((s) => s.annotations)
  const events = useLearningEventStore((s) => s.events)
  const study = useShenlunStore((s) => s.study)
  const getArticle = useArticleStore((s) => s.getArticle)

  const items = useMemo<EchoItem[]>(() => {
    const out: EchoItem[] = []
    /* 快忘的背记素材优先：同主题优先，不足再取其他主题 */
    const mats = annotations.filter(
      (a) =>
        a.articleId !== articleId &&
        a.kind === 'highlight' &&
        a.memorized === true &&
        (a.materialType === 'quote' || a.materialType === 'pattern'),
    )
    const ranked = [...mats].sort(
      (x, y) => recallProbability(x, events) - recallProbability(y, events),
    )
    const sameTopic = ranked.filter((a) => getArticle(a.articleId)?.topic === topic)
    const picked = [...sameTopic, ...ranked.filter((a) => !sameTopic.includes(a))].slice(0, 3)
    for (const a of picked) {
      const art = getArticle(a.articleId)
      const days = Math.max(1, Math.round((Date.now() - new Date(a.createdAt).getTime()) / 86400000))
      out.push({
        key: a.id,
        to: `/reading/${a.articleId}?ann=${a.id}`,
        label: `“${a.text.length > 30 ? `${a.text.slice(0, 30)}…` : a.text}”`,
        meta: `${days} 天前存 ·《${art?.title ?? '未知文章'}》`,
      })
    }
    /* 同主题拆过的文章 */
    for (const s of Object.values(study)) {
      if (s.articleId === articleId || s.status === 'new') continue
      const art = getArticle(s.articleId)
      if (!art || art.topic !== topic) continue
      out.push({
        key: `study-${s.articleId}`,
        to: `/reading/${s.articleId}`,
        label: `你拆过《${art.title}》`,
        meta: s.status === 'mastered' ? '已掌握 · 同主题' : '学习中 · 同主题',
      })
      if (out.length >= 5) break
    }
    return out
  }, [annotations, events, study, articleId, topic, getArticle])

  if (items.length === 0) return null
  return (
    <aside className="echo-strip" aria-label="与你有关的积累">
      <span className="echo-label">ECHO　/　与你有关</span>
      <ul className="echo-list">
        {items.map((it) => (
          <li key={it.key}>
            <Link to={it.to} title={it.meta}>
              <span className="echo-text">{it.label}</span>
              <span className="echo-meta">{it.meta}</span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  )
}
