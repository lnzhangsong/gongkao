import { useEffect, useMemo, useState } from 'react'
import { ApiLoading } from '../components/ui/ApiLoading'
import { useXingceStore } from '../stores/xingceStore'
import { fetchXingce, type XingceQuestion } from '../lib/api'
import { optionCols, showTextStem } from '../lib/xingcePractice'
import { CondLines, DataUrls } from '../components/exam/GroupStemText'
import { xingceGroupImage, xingceQuestionImage } from '../data/xingceImages'
import { MenuSelect } from '../components/ui/MenuSelect'
import { useReaderStore, fontFamilyCss } from '../stores/readerStore'
import { loadFontFamily } from '../lib/fonts'
import '../styles/exam-preview.css'
import '../styles/practice.css'

/**
 * 练习 · 错题本（/practice/wrong；docs/行测做题模块设计方案.md X3 简版）
 * 列出所有答错过的题（取最近一次作答仍错的），按专项折叠；
 * 重做 = 清掉该题作答记录并回跳试卷页对应位置（一期简做：回卷首页重刷该组）。
 * 到期排期（FSRS 简化 R(t)）依赖 docs/学习与复习算法.md 的到期队列，X3 后半接入。
 */

interface WrongItem {
  paperId: string
  paperTitle: string
  q: XingceQuestion
  picked: string
}

export function XingceWrongPage() {
  const answers = useXingceStore((s) => s.answers)
  const [items, setItems] = useState<WrongItem[] | null>(null)
  /* 题型筛选：null = 全部 */
  const [sectionFilter, setSectionFilter] = useState<string | null>(null)
  /* 字体/字号跟随设置页的阅读设置（与练习页同一套 CSS 变量） */
  const readerFontSize = useReaderStore((s) => s.settings.fontSize)
  const readerFontFamily = useReaderStore((s) => s.settings.fontFamily)
  /* 每页题数（持久化在阅读设置，5~20） */
  const pageSize = useReaderStore((s) => s.settings.wrongPageSize ?? 10)
  const setPageSize = useReaderStore((s) => s.setWrongPageSize)

  useEffect(() => {
    void loadFontFamily(readerFontFamily)
  }, [readerFontFamily])

  useEffect(() => {
    let alive = true
    const run = async () => {
      /* 只拉有错题的卷，逐卷取详情（卷量少，直取即可） */
      const wrongIds = [
        ...new Set(
          Object.values(answers)
            .filter((a) => !a.correct)
            .map((a) => a.paperId),
        ),
      ]
      const list: WrongItem[] = []
      for (const pid of wrongIds) {
        try {
          const detail = await fetchXingce(pid)
          const qMap = new Map(detail.questions.map((q) => [q.idx, q]))
          for (const a of Object.values(answers)) {
            if (a.paperId !== pid || a.correct) continue
            const q = qMap.get(a.qIdx)
            if (q) list.push({ paperId: pid, paperTitle: detail.title, q, picked: a.picked })
          }
        } catch {
          /* 卷已不存在（题库更新/下架）：清掉该卷残留作答，避免错题本永远卡着一条无法重做的题 */
          useXingceStore.getState().clearPaper(pid)
        }
      }
      if (alive) setItems(list)
    }
    void run()
    return () => {
      alive = false
    }
  }, [answers])

  const bySection = useMemo(() => {
    const m = new Map<string, WrongItem[]>()
    for (const it of items ?? []) {
      if (sectionFilter && it.q.section !== sectionFilter) continue
      const list = m.get(it.q.section) ?? []
      list.push(it)
      m.set(it.q.section, list)
    }
    return [...m.entries()]
  }, [items, sectionFilter])

  /* 题型汇总（不受筛选影响，给下拉选项带总数） */
  const sectionSummary = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items ?? []) m.set(it.q.section, (m.get(it.q.section) ?? 0) + 1)
    return [...m.entries()]
  }, [items])

  /* 分页：错题多时整页平铺拉太长，按每页题数切页（跨专项顺次切，页内仍按专项分组） */
  const [page, setPage] = useState(0)
  const ordered = useMemo(() => bySection.flatMap(([, list]) => list), [bySection])
  const totalPages = Math.max(1, Math.ceil(ordered.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const pageItems = ordered.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const pageSections = useMemo(() => {
    const m = new Map<string, WrongItem[]>()
    for (const it of pageItems) {
      const list = m.get(it.q.section) ?? []
      list.push(it)
      m.set(it.q.section, list)
    }
    return [...m.entries()]
  }, [pageItems])

  const goPage = (next: number) => {
    setPage(Math.min(Math.max(0, next), totalPages - 1))
    const hero = document.querySelector('.exam-hero')
    const top = hero ? hero.getBoundingClientRect().bottom + window.scrollY : 0
    window.scrollTo({ top: top + 8, behavior: 'smooth' })
  }

  if (items === null)
    return (
      <div className="exam-page">
        <ApiLoading label="正在整理错题…" />
      </div>
    )

  return (
    <div
      className="exam-page"
      style={
        {
          '--reader-font-size': `${readerFontSize}px`,
          '--reader-font-family': fontFamilyCss(readerFontFamily),
        } as React.CSSProperties
      }
    >
      <header className="subpage-header exam-hero">
        <div>
          <div className="eyebrow">XINGCE / 错题本</div>
          <h1>
            错过的，
            <br />
            <span>再赢回来。</span>
          </h1>
        </div>
        <div className="exam-hero-side">
          <p className="subpage-copy">最近一次仍做错的题。重做答对后自动移出本页；到期排期随后接入复习算法。</p>
        </div>
      </header>

      {items.length === 0 && (
        <div className="empty-state">
          <strong>暂无错题</strong>
          去刷一套卷，错题会自动出现在这里
        </div>
      )}

      {/* 筛选 + 分页吸顶行：左题型下拉、右分页；只有一页时仅显示下拉 */}
      {(totalPages > 1 || sectionSummary.length > 0) && (
        <nav className="practice-pager" aria-label="错题筛选与分页">
          <MenuSelect
            value={sectionFilter ?? '__all__'}
            options={[
              { key: '__all__', label: `全部题型（${items?.length ?? 0}）` },
              ...sectionSummary.map(([name, count]) => ({ key: name, label: `${name}（${count}）` })),
            ]}
            onChange={(k) => {
              setSectionFilter(k === '__all__' ? null : k)
              setPage(0)
            }}
            ariaLabel="按题型筛选"
            compact
          />
          {items !== null && items.length > 0 && (
            <span className="practice-pager-group">
              <span className="practice-pager-size" title="每页题目数">
                每页
                <MenuSelect
                  value={String(pageSize)}
                  options={[5, 10, 15, 20].map((n) => ({ key: String(n), label: `${n} 题` }))}
                  onChange={(k) => {
                    setPageSize(Number(k))
                    setPage(0)
                  }}
                  ariaLabel="每页题目数"
                  compact
                />
              </span>
              {totalPages > 1 && (
                <>
                  <button className="practice-nav-btn" disabled={safePage === 0} onClick={() => goPage(safePage - 1)}>
                    ← 上一页
                  </button>
                  <span className="practice-pager-status">
                    第 {safePage + 1} / {totalPages} 页 · 共 {ordered.length} 题
                  </span>
                  <button
                    className="practice-nav-btn"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => goPage(safePage + 1)}
                  >
                    下一页 →
                  </button>
                </>
              )}
            </span>
          )}
        </nav>
      )}

      {items !== null && items.length > 0 && ordered.length === 0 && (
        <div className="empty-state">
          <strong>该题型暂无错题</strong>
          换个题型或选择全部题型看看
        </div>
      )}

      {pageSections.map(([section, list]) => (
        <section key={section}>
          <div className="content-head exam-year-head">
            <h2>{section}</h2>
            <span>本页 {list.length} 题</span>
          </div>
          <div className="fade-in">
            {list.map((it) => {
              const qImg = xingceQuestionImage(it.paperId, it.q.idx)
              const gImg = xingceGroupImage(it.paperId, it.q.groupId)
              /* 复盘态选项：红框=当时选错的、绿框=正确答案，不可点 */
              const imgQ = !!qImg && it.q.options.every((o) => !o.text)
              return (
                <article className="practice-wrong-card" key={`${it.paperId}#${it.q.idx}`}>
                  <p className="practice-wrong-source">
                    <small style={{ fontFamily: 'var(--mono)', opacity: 0.6 }}>{it.paperTitle}</small>
                  </p>
                  {showTextStem(it.q.stem) && (
                    <p className="practice-stem">
                      <strong>{it.q.idx}.</strong> <CondLines text={it.q.stem} />
                    </p>
                  )}
                  {qImg ? (
                    <DataUrls value={qImg} altPrefix={`第${it.q.idx}题`} />
                  ) : (
                    gImg && <DataUrls value={gImg} altPrefix={`第${it.q.idx}题组材料`} />
                  )}
                  <div className={`practice-options cols-${optionCols([it.q])}${imgQ ? ' is-imgopts' : ''}`}>
                    {it.q.options.map((o) => (
                      <button
                        key={o.key}
                        className={[
                          'practice-opt',
                          o.key === it.q.answer ? ' right' : '',
                          it.picked === o.key && o.key !== it.q.answer ? ' wrong' : '',
                        ].join(' ')}
                        disabled
                      >
                        <span className="practice-opt-key">{o.key}</span>
                        {imgQ ? '' : o.text}
                      </button>
                    ))}
                  </div>
                  {/* 判定结果由选项样式表达：红框=当时选错、绿框=正确答案 */}
                  {it.q.explanation && (
                    <div className="practice-explain">
                      <CondLines text={it.q.explanation} />
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
