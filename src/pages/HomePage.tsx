import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useArticleStore } from '../stores/articleStore'
import { loadDisplayFont } from '../lib/fonts'
import { formatArticleNo } from '../data'
import { useEffect } from 'react'
import { Ticker } from '../components/ui/Ticker'
import type { Article } from '../types'

export function HomePage() {
  /* 首页大标题需要装饰字体（马善政楷书），按需加载 */
  useEffect(() => {
    void loadDisplayFont()
  }, [])
  const articles = useArticleStore((s) => s.articles)
  const progress = useArticleStore((s) => s.progress)
  const navigate = useNavigate()

  /** 进行中的阅读（有进度、未读完、最近读过） */
  const continueList = useMemo(() => {
    return articles
      .map((a) => ({ article: a, p: progress[a.id] }))
      .filter((x) => x.p && x.p.percent > 0 && x.p.percent < 95)
      .sort((a, b) => (b.p!.lastReadAt < a.p!.lastReadAt ? -1 : 1))
  }, [articles, progress])

  /** 当天稳定的日期种子（本地时区，跨天变化）：用于入场/复习的每日轮换 */
  const daySeed = useMemo(() => {
    const d = new Date()
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    return [...key].reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 0)
  }, [])

  /**
   * 入场位：① 有进行中的 → 继续阅读；② 未读池按日期种子轮换（当天稳定、每天换一篇）；
   * ③ 全部读完 → 从已读中按同一种子挑一篇复习
   */
  const entry = useMemo(() => {
    const inProgress = continueList[0]
    if (inProgress) return { article: inProgress.article, mode: 'continue' as const }
    const unread = articles.filter((a) => !progress[a.id]?.completed && !(progress[a.id] && progress[a.id].percent >= 95))
    if (unread.length > 0) return { article: unread[Math.abs(daySeed) % unread.length], mode: 'start' as const }
    const read = articles.filter((a) => progress[a.id]?.completed)
    if (read.length === 0) return null
    return { article: read[Math.abs(daySeed) % read.length], mode: 'review' as const }
  }, [articles, progress, continueList, daySeed])

  /** 最近阅读 */
  const recentList = useMemo(() => {
    return articles
      .map((a) => ({ article: a, p: progress[a.id] }))
      .filter((x) => x.p && x.p.lastReadAt)
      .sort((a, b) => (b.p!.lastReadAt < a.p!.lastReadAt ? -1 : 1))
      .slice(0, 3)
  }, [articles, progress])

  /** 今日推荐 3 篇（避开继续阅读主卡） */
  const picks = useMemo(() => {
    if (!entry) return []
    const used = new Set([entry.article.id, ...continueList.map((c) => c.article.id)])
    return articles.filter((a) => !used.has(a.id)).slice(0, 3)
  }, [articles, entry, continueList])

  /** 本周阅读统计（近 7 天有阅读行为的文章：累计时长 + 篇数） */
  const weekStats = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000
    let sec = 0
    let count = 0
    for (const a of articles) {
      const p = progress[a.id]
      if (!p?.lastReadAt || new Date(p.lastReadAt).getTime() < cutoff) continue
      sec += p.timeSpentSec ?? 0
      count += 1
    }
    return { minutes: Math.round(sec / 60), count }
  }, [articles, progress])

  const open = (a: Article) => navigate(`/reading/${a.id}`)

  /** 入场卡角标编号（真实文章编号） */
  const entryNo = entry ? formatArticleNo(entry.article.id) : '000'
  /* eyebrow 展示当日日期 */
  const today = new Date().toISOString().slice(0, 10)
  const entryFooter = entry?.mode === 'continue' ? 'CONTINUE READING' : entry?.mode === 'review' ? 'REVIEW TODAY' : "TODAY'S ENTRY"

  return (
    <section id="home" className="page-section">
      <main className="hero">
        <div className="hero-copy">
          <div className="eyebrow">A DAILY READING PRACTICE　/　{today}</div>
          <h1>
            读懂时代，
            <br />
            <span>写好答案。</span>
          </h1>
          <div className="hero-foot">
            <p>
              每日精选人民日报深度内容与申论素材。不追热点，只留下值得反复阅读的文字。
            </p>
            <div className="week-stats">
              <span>
                本周阅读 <Ticker value={weekStats.minutes} /> 分钟
              </span>
              <span className="week-stats-sep">/</span>
              <span>
                <Ticker value={weekStats.count} /> 篇
              </span>
            </div>
          </div>
        </div>
        <div className="stage">
          <div className="halo" />
          <button className="entry" onClick={() => entry && open(entry.article)} disabled={!entry} aria-disabled={!entry}>
            <small>READBOOK / NO. {entryNo}</small>
            <strong>
              开始
              <br />
              阅读
            </strong>
            <i>↗</i>
            <footer>{entryFooter}</footer>
          </button>
        </div>
      </main>

      <section className="content">
        <div className="content-head">
          <h2>今日值得阅读</h2>
          <span>CURATED FOR YOU　/　03 ITEMS</span>
        </div>

        {/* 继续阅读主卡（articles 未加载 / 全部异常时 entry 为空，整块不渲染） */}
        {entry &&
          (continueList[0] ? (
            <div className="reading">
              <article
                className="main-card"
                style={{ cursor: 'pointer' }}
                onClick={() => open(continueList[0].article)}
              >
                <span className="tag">
                  {continueList[0].article.source} · {continueList[0].article.topic}
                </span>
                <h3>{continueList[0].article.title}</h3>
                <div className="meta">
                  <span>
                    预计 {continueList[0].article.readTime} MIN　/　已读{' '}
                    <Ticker value={continueList[0].p?.percent ?? 0} />%
                  </span>
                  <span>
                    <button className="open-reading text-btn" onClick={() => open(continueList[0].article)}>
                      继续阅读　↗
                    </button>
                  </span>
                </div>
              </article>
            </div>
          ) : (
            <div className="reading">
              <article className="main-card" style={{ cursor: 'pointer' }} onClick={() => open(entry.article)}>
                <span className="tag">
                  {entry.article.source} · {entry.article.topic}
                </span>
                <h3>{entry.article.title}</h3>
                <div className="meta">
                  <span>预计 {entry.article.readTime} MIN　/　今日推荐</span>
                  <span>
                    <button className="open-reading text-btn" onClick={() => open(entry.article)}>
                      打开文章　↗
                    </button>
                  </span>
                </div>
              </article>
            </div>
          ))}

        {/* 最近阅读 */}
        {recentList.length > 0 && (
          <div className="continue-bar">
            <div>
              <div className="c-label">CONTINUE READING　/　最近阅读</div>
              <h3>{recentList[0].article.title}</h3>
              <div className="continue-meta">
                <span>
                  上次读到 <Ticker value={recentList[0].p?.percent ?? 0} />%
                </span>
                <div className="progress">
                  <i style={{ width: `${recentList[0].p?.percent ?? 0}%` }} />
                </div>
              </div>
            </div>
            <button className="ghost" onClick={() => open(recentList[0].article)}>
              继续阅读　↗
            </button>
          </div>
        )}

        <div className="list">
          {picks.map((a, i) => (
            <button className="item" key={a.id} onClick={() => open(a)}>
              <small>
                {String(i + 1).padStart(2, '0')} / {a.topic}
              </small>
              <h4>{a.title}</h4>
              <span className="index">{String(i + 1).padStart(2, '0')}</span>
            </button>
          ))}
        </div>

        <div className="content-head" style={{ marginTop: 54 }}>
          <h2>全部文章</h2>
          <span>
            <Link to="/library" className="text-btn" style={{ color: 'var(--accent)' }}>
              进入文章库　↗
            </Link>
          </span>
        </div>
      </section>
    </section>
  )
}
