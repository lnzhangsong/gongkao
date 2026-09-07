import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiLoading } from '../components/ui/ApiLoading'
import { fetchXingceList, type XingcePaperMeta } from '../lib/api'
import { levelClass, levelMark } from '../lib/examText'
import { useXingceStore } from '../stores/xingceStore'
import '../styles/exam-preview.css'

/**
 * 练习 · 行测列表（/practice；docs/行测做题模块设计方案.md X2）
 * 版式复用申论真题列表（exam-page / subpage-header / exam-card），数据源 xg_papers。
 * 该组件同时处理详情路由：:paperId 存在时整页交给答题卡（见 XingcePracticePage 的路由拆分）。
 */

/** 年份 → 行测卷量徽标（与申论列表 content-head 同语言） */
export function XingceListPage() {
  const nav = useNavigate()
  const [papers, setPapers] = useState<XingcePaperMeta[] | null>(null)
  const [error, setError] = useState('')
  const answers = useXingceStore((s) => s.answers)

  useEffect(() => {
    let alive = true
    fetchXingceList()
      .then((d) => alive && setPapers(d.papers))
      .catch((e) => alive && setError(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [])

  const grouped = useMemo(() => {
    if (!papers) return []
    const m = new Map<number, XingcePaperMeta[]>()
    for (const p of papers) {
      const list = m.get(p.year) ?? []
      list.push(p)
      m.set(p.year, list)
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0])
  }, [papers])

  return (
    <div className="exam-page">
      <header className="subpage-header exam-hero">
        <div>
          <div className="eyebrow">GUOKAO XINGCE　/　练习</div>
          <h1>
            把行测，
            <br />
            <span>刷成手感。</span>
          </h1>
        </div>
        <div className="exam-hero-side">
          <p className="subpage-copy">历年国考行测真题，客观题点选作答、即时判分，错题自动进入复习队列。</p>
        </div>
      </header>

      {error && (
        <div className="empty-state">
          <strong>列表加载失败</strong>
          {error}
        </div>
      )}
      {papers === null && !error && <ApiLoading label="正在加载试卷列表…" />}
      {papers !== null && papers.length === 0 && !error && (
        <div className="empty-state">
          <strong>还没有行测卷</strong>
          把真题 JSON 放进 data/xingce/ 并运行 node scripts/import-xingce.mjs
        </div>
      )}
      {papers !== null && papers.length > 0 && !error && (
        <div className="fade-in">
          {grouped.map(([year, list]) => (
            <section key={year}>
              <div className="content-head exam-year-head">
                <h2>{year}</h2>
                <span>{list.length} 卷</span>
              </div>
              <div className="exam-grid">
                {list.map((p) => {
                  /* 该卷已作答数（本地记录），做成卡片的完成度徽标 */
                  const done = Object.values(answers).filter((a) => a.paperId === p.id).length
                  return (
                    <button
                      key={p.id}
                      className={`exam-card${levelClass(p.level)}`}
                      title={p.title}
                      onClick={() => nav(`/practice/${encodeURIComponent(p.id)}`)}
                    >
                      <small>{done > 0 ? `已答 ${done}/${p.questionCount}` : `${p.questionCount} 题`}</small>
                      <h4>{p.title}</h4>
                      <span className="exam-card-meta">{p.durationMin ? `${p.durationMin} 分钟` : '国考行测'}</span>
                      <span className="exam-card-mark" aria-hidden>
                        {levelMark(p.level)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
