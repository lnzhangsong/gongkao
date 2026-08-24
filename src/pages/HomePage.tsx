import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useArticleStore } from '../stores/articleStore'
import { loadDisplayFont } from '../lib/fonts'
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

  const featured = useMemo(() => articles.find((a) => a.featured) ?? articles[0], [articles])

  /** 进行中的阅读（有进度、未读完、最近读过） */
  const continueList = useMemo(() => {
    return articles
      .map((a) => ({ article: a, p: progress[a.id] }))
      .filter((x) => x.p && x.p.percent > 0 && x.p.percent < 95)
      .sort((a, b) => (b.p!.lastReadAt < a.p!.lastReadAt ? -1 : 1))
  }, [articles, progress])

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
    if (!featured) return []
    const used = new Set([featured.id, ...continueList.map((c) => c.article.id)])
    return articles.filter((a) => !used.has(a.id)).slice(0, 3)
  }, [articles, featured, continueList])

  const open = (a: Article) => navigate(`/reading/${a.id}`)

  return (
    <section id="home" className="page-section">
      <main className="hero">
        <div className="hero-copy">
          <div className="eyebrow">A DAILY READING PRACTICE　/　NO. 024</div>
          <h1>
            读懂时代，
            <br />
            <span>写好答案。</span>
          </h1>
          <div className="hero-foot">
            <p>
              每日精选人民日报深度内容与申论素材。不追热点，只留下值得反复阅读的文字。
            </p>

          </div>
        </div>
        <div className="stage">
          <div className="halo" />
          <button className="entry" onClick={() => open(featured)}>
            <small>READBOOK / {featured.id.slice(1)}</small>
            <strong>
              开始
              <br />
              阅读
            </strong>
            <i>↗</i>
            <footer>TODAY'S ENTRY</footer>
          </button>
        </div>
      </main>

      <section className="content">
        <div className="content-head">
          <h2>今日值得阅读</h2>
          <span>CURATED FOR YOU　/　03 ITEMS</span>
        </div>

        {/* 继续阅读主卡 */}
        {continueList[0] ? (
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
                  预计 {continueList[0].article.readTime} MIN　/　已读 <Ticker value={continueList[0].p?.percent ?? 0} />%
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
            <article className="main-card" style={{ cursor: 'pointer' }} onClick={() => open(featured)}>
              <span className="tag">
                {featured.source} · {featured.topic}
              </span>
              <h3>{featured.title}</h3>
              <div className="meta">
                <span>
                  预计 {featured.readTime} MIN　/　今日推荐
                </span>
                <span>
                  <button className="open-reading text-btn" onClick={() => open(featured)}>
                    打开文章　↗
                  </button>
                </span>
              </div>
            </article>
          </div>
        )}

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
