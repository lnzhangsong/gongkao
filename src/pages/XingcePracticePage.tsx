import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ApiLoading } from '../components/ui/ApiLoading'
import { fetchXingce, type XingceDetail, type XingceQuestion } from '../lib/api'
import { useXingceStore, xgKey } from '../stores/xingceStore'
import { useReaderStore, fontFamilyCss } from '../stores/readerStore'
import { loadFontFamily } from '../lib/fonts'
import { levelMark } from '../lib/examText'
import { GroupStemText, DataUrls } from '../components/exam/GroupStemText'
import { MenuSelect } from '../components/ui/MenuSelect'
import '../styles/exam-preview.css'
import '../styles/practice.css'

/**
 * 练习 · 行测答题卡（/practice/:paperId；docs/行测做题模块设计方案.md X2）
 * 练习模式：按题组/单题分屏，每组提交即判分、即时看解析；作答落 xingceStore（本地 IndexedDB）。
 * 判分是确定性的（答案客观唯一），不经 AI、不经后端。
 */

/** 卷内题目按题组切分展示单元：单题自成一组，资料分析一篇材料 5 题共用一个分屏 */
interface Group {
  groupId: number | null
  groupStem: string | null
  groupImage: string | null
  questions: XingceQuestion[]
}

/** 单题分屏大小可选值：同一专项的零散单题按此数量合并成一屏（头部可调） */
const GROUP_SIZE_OPTIONS = [5, 10, 15, 20]

function groupQuestions(qs: XingceQuestion[], perScreen: number): Group[] {
  const groups: Group[] = []
  for (const q of qs) {
    const last = groups[groups.length - 1]
    // 题组（资料分析一篇材料 5 题）：独立一屏
    if (q.groupId != null && last && last.groupId === q.groupId) {
      last.questions.push(q)
      continue
    }
    // 零散单题：同专项合并一屏，满 perScreen 题换屏
    if (
      q.groupId == null &&
      last &&
      last.groupId == null &&
      last.questions[0].section === q.section &&
      last.questions.length < perScreen
    ) {
      last.questions.push(q)
      continue
    }
    groups.push({ groupId: q.groupId, groupStem: q.groupStem, groupImage: q.groupImage, questions: [q] })
  }
  return groups
}

/** 选项布局：短选项（数字/百分比/词语）横排多列，长文本单列 */
function optionCols(qs: XingceQuestion[]): 1 | 2 | 4 {
  const all = qs.flatMap((q) => q.options)
  const maxLen = Math.max(0, ...all.map((o) => o.text.length))
  if (maxLen <= 6) return 4
  if (maxLen <= 18) return 2
  return 1
}

export function XingcePracticePage() {
  const { paperId = '' } = useParams()
  const [paper, setPaper] = useState<XingceDetail | null>(null)
  const [error, setError] = useState('')
  const [pos, setPos] = useState(0) // 当前分屏下标
  const [picked, setPicked] = useState<Record<number, string>>({}) // 未判分题的暂存选择
  const [sheetOpen, setSheetOpen] = useState(false)
  const [stemOpen, setStemOpen] = useState(true) // 资料分析材料折叠
  const scrollTarget = useRef<number | null>(null)
  const enteredAt = useRef(Date.now())
  const record = useXingceStore((s) => s.record)
  const removeMany = useXingceStore((s) => s.removeMany)
  const answers = useXingceStore((s) => s.answers)
  const readerFontSize = useReaderStore((s) => s.settings.fontSize)
  const readerFontFamily = useReaderStore((s) => s.settings.fontFamily)
  const singlesPerScreen = useReaderStore((s) => s.settings.singlesPerScreen)
  const setSinglesPerScreen = useReaderStore((s) => s.setSinglesPerScreen)

  // 全局字体切换时加载对应 webfont（弱网兜底在 loadFontFamily 内部）
  useEffect(() => {
    void loadFontFamily(readerFontFamily)
  }, [readerFontFamily])

  useEffect(() => {
    let alive = true
    fetchXingce(paperId)
      .then((d) => alive && setPaper(d))
      .catch((e) => alive && setError(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [paperId])

  const groups = useMemo(
    () => (paper ? groupQuestions(paper.questions, singlesPerScreen) : []),
    [paper, singlesPerScreen],
  )
  const group = groups[pos]

  /* 调整每组题数：重新分屏后停在包含当前组第一题的分屏 */
  const changeGroupSize = (n: number) => {
    setSinglesPerScreen(n)
    if (!group || !paper) return
    const curIdx = group.questions[0].idx
    const next = groupQuestions(paper.questions, n)
    const gi = next.findIndex((g) => g.questions.some((q) => q.idx === curIdx))
    go(gi === -1 ? 0 : gi)
  }

  useEffect(() => {
    if (scrollTarget.current == null) return
    const el = document.getElementById(`q-${scrollTarget.current}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    scrollTarget.current = null
  }, [pos, paper])

  if (error)
    return (
      <div className="exam-page">
        <div className="empty-state">
          <strong>试卷加载失败</strong>
          {error}
        </div>
      </div>
    )
  if (!paper) {
    return (
      <div className="exam-page">
        <ApiLoading label="正在加载试卷…" />
      </div>
    )
  }

  const go = (next: number, scrollQ?: number) => {
    setPos(next)
    setPicked({})
    enteredAt.current = Date.now()
    scrollTarget.current = scrollQ ?? null
  }

  /* 答题卡跳题：定位到目标题所在分屏，并滚动到该题 */
  const jumpTo = (qIdx: number) => {
    const gi = groups.findIndex((g) => g.questions.some((q) => q.idx === qIdx))
    if (gi === -1) return
    setSheetOpen(false)
    go(gi, qIdx)
  }

  /* 提交：只判「已作答且未判分」的题；没做的保持可作答，之后可再次提交 */
  const submit = () => {
    if (!group) return
    const seconds = Math.round((Date.now() - enteredAt.current) / 1000 / group.questions.length)
    for (const q of group.questions) {
      if (q.answer == null) continue
      const key = xgKey(paper.id, q.idx)
      if (answers[key]) continue // 已判分的题不动
      const p = picked[q.idx] ?? ''
      if (!p) continue // 未作答的不判
      record({
        paperId: paper.id,
        qIdx: q.idx,
        picked: p,
        correct: p === q.answer,
        seconds,
        origin: 'practice',
        updatedAt: new Date().toISOString(),
      })
    }
  }

  /* 点「重刷本组」：清空本组全部作答记录，从头做 */
  const redoGroup = () => {
    if (!group) return
    removeMany(
      paper.id,
      group.questions.map((q) => q.idx),
    )
    setPicked({})
    enteredAt.current = Date.now()
  }

  /* 本组可判分题是否全部已判分（全部判分后按钮变「重刷本组」） */
  const answerable = group ? group.questions.filter((q) => q.answer != null) : []
  const allJudged = group != null && answerable.length > 0 && answerable.every((q) => answers[xgKey(paper.id, q.idx)])
  const hasNewPick = group
    ? group.questions.some((q) => q.answer != null && !answers[xgKey(paper.id, q.idx)] && picked[q.idx])
    : false

  const doneCount = paper.questions.filter((q) => answers[xgKey(paper.id, q.idx)]).length
  const rightCount = paper.questions.filter((q) => answers[xgKey(paper.id, q.idx)]?.correct).length
  const wrongCount = doneCount - rightCount
  const pct = Math.round((doneCount / paper.questions.length) * 100)
  const isMaterialGroup = group?.groupId != null && (!!group.groupStem || !!group.groupImage)

  return (
    <div
      className="exam-page practice-page"
      style={
        {
          '--reader-font-size': `${readerFontSize}px`,
          '--reader-font-family': fontFamilyCss(readerFontFamily),
        } as React.CSSProperties
      }
    >
      {/* 吸顶头：标题行 + 进度条 + 统计行整体固定（76px = 站内导航条高度，吸在其下） */}
      <header className="practice-head">
        <div className="practice-head-row">
          <div className="practice-title">
            <span className="eyebrow">
              XINGCE / {paper.year} · {paper.level}
            </span>
            <h1>{paper.title}</h1>
          </div>
          <div className="practice-actions">
            <button className="practice-nav-btn" disabled={pos === 0} onClick={() => go(pos - 1)}>
              ← 上一组
            </button>
            {!allJudged ? (
              <button
                className="practice-nav-btn is-primary"
                onClick={submit}
                disabled={!hasNewPick}
                title="只判已作答的题，没做的之后还能再做"
              >
                提交本组
              </button>
            ) : (
              <button className="practice-nav-btn" onClick={redoGroup}>
                重刷本组
              </button>
            )}
            <button className="practice-nav-btn" disabled={pos >= groups.length - 1} onClick={() => go(pos + 1)}>
              下一组 →
            </button>
            <label className="practice-groupsize" title="每组题目数">
              每组
              <MenuSelect
                value={String(singlesPerScreen)}
                options={GROUP_SIZE_OPTIONS.map((n) => ({ key: String(n), label: `${n} 题` }))}
                onChange={(k) => changeGroupSize(Number(k))}
                ariaLabel="每组题目数"
                compact
              />
            </label>
            <button
              className={`practice-sheet-toggle${sheetOpen ? ' is-open' : ''}`}
              onClick={() => setSheetOpen((o) => !o)}
            >
              答题卡
            </button>
            <span className="practice-mark" aria-hidden>
              {levelMark(paper.level)}
            </span>
          </div>
        </div>

        {/* 进度行：进度条占主、答题进度靠右 */}
        <div className="practice-progress-row">
          <div
            className="practice-progressbar"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="practice-progressbar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="practice-stats">
            <span>
              已答 <strong>{doneCount}</strong>/{paper.questions.length}
            </span>
            <span className="is-right">对 {rightCount}</span>
            <span className="is-wrong">错 {wrongCount}</span>
          </div>
        </div>

        {/* 答题卡浮层挂在吸顶 header 内：header 钉住时面板跟着钉住，滚动不消失 */}
        {sheetOpen && (
          <div className="practice-sheet">
            <div className="practice-sheet-legend">
              <span>
                <i className="dot" /> 未答
              </span>
              <span>
                <i className="dot is-right" /> 答对
              </span>
              <span>
                <i className="dot is-wrong" /> 答错
              </span>
              <span className="practice-sheet-hint">点题号直接跳题</span>
            </div>
            <div className="practice-sheet-body">
              {(() => {
                // 连续同 section 的题合成一个题型块（如「判断推理 · 76-115 · 已答 3/40」）
                const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
                const secs: { name: string; questions: XingceQuestion[] }[] = []
                for (const q of paper.questions) {
                  const last = secs[secs.length - 1]
                  if (last && last.name === q.section) last.questions.push(q)
                  else secs.push({ name: q.section, questions: [q] })
                }
                return secs.map((sec, i) => {
                  const done = sec.questions.filter((q) => answers[xgKey(paper.id, q.idx)]).length
                  return (
                    <div className="practice-sheet-sec" key={sec.name + i}>
                      <div className="practice-sheet-sec-head">
                        <strong>
                          {CN[i]}、{sec.name}
                        </strong>
                        <span>
                          {sec.questions[0].idx}–{sec.questions[sec.questions.length - 1].idx} 题 · 已答 {done}/
                          {sec.questions.length}
                        </span>
                      </div>
                      <div className="practice-sheet-grid">
                        {sec.questions.map((q) => {
                          const a = answers[xgKey(paper.id, q.idx)]
                          const inGroup = group?.questions.some((x) => x.idx === q.idx)
                          return (
                            <button
                              key={q.idx}
                              className={[
                                'practice-sheet-cell',
                                inGroup ? ' is-current' : '',
                                a ? (a.correct ? ' is-right' : ' is-wrong') : '',
                              ].join(' ')}
                              onClick={() => jumpTo(q.idx)}
                              title={`${q.section}${q.subtype ? ` · ${q.subtype}` : ''} · 第${q.idx}题`}
                            >
                              {q.idx}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        )}
      </header>

      {group && (
        <article className="practice-group fade-in" key={pos}>
          <div className="content-head">
            <h2>
              {group.questions[0].section}
              {group.questions[0].subtype ? ` · ${group.questions[0].subtype}` : ''}
            </h2>
            <span>
              {group.questions[0].idx}
              {group.questions.length > 1 ? `–${group.questions[group.questions.length - 1].idx}` : ''} 题
            </span>
          </div>

          {isMaterialGroup && (
            <div className={`practice-group-stem${stemOpen ? '' : ' is-closed'}`}>
              <button className="practice-stem-toggle" onClick={() => setStemOpen((o) => !o)}>
                {stemOpen ? '收起材料 ▴' : '展开材料 ▾'}（材料较长时建议收起，答题更专注）
              </button>
              {stemOpen && (
                <div className="practice-stem-body">
                  {group.groupImage ? (
                    // 材料截图里已含完整文字，只渲染图，避免重复
                    <DataUrls value={group.groupImage} altPrefix={`第${group.questions[0].idx}题组材料`} />
                  ) : (
                    <GroupStemText text={group.groupStem} />
                  )}
                </div>
              )}
            </div>
          )}

          {group.questions.map((q) => {
            const saved = answers[xgKey(paper.id, q.idx)]
            const qJudged = !!saved // 有存档即已判分：锁定选项并展示判定；没存档的题保持可作答
            const pick = qJudged ? saved.picked : (picked[q.idx] ?? '')
            const imgQ = !!q.image // 整题截图：题干/选项都在图里，文本一律不重复渲染
            return (
              <section className="practice-q" key={q.idx} id={`q-${q.idx}`}>
                {!imgQ && (
                  <p className="practice-stem">
                    <strong>{q.idx}.</strong> {q.stem}
                  </p>
                )}
                {imgQ && <DataUrls value={q.image} altPrefix={`第${q.idx}题`} />}
                <div
                  className={`practice-options cols-${optionCols([q])}${imgQ ? ' is-imgopts' : ''}`}
                  role="radiogroup"
                  aria-label={`第${q.idx}题选项`}
                >
                  {q.options.map((o) => {
                    const cls = [
                      'practice-opt',
                      pick === o.key ? ' picked' : '',
                      qJudged && o.key === q.answer ? ' right' : '',
                      qJudged && pick === o.key && o.key !== q.answer ? ' wrong' : '',
                    ].join('')
                    return (
                      <button
                        key={o.key}
                        className={cls}
                        role="radio"
                        aria-checked={pick === o.key}
                        disabled={qJudged}
                        onClick={() => setPicked((s) => ({ ...s, [q.idx]: o.key }))}
                      >
                        <span className="practice-opt-key">{o.key}</span>
                        {imgQ ? '' : o.text}
                      </button>
                    )
                  })}
                </div>
                {qJudged && (
                  <div className={`practice-verdict${pick === q.answer ? '' : ' is-wrong'}`}>
                    {pick === q.answer ? '✓ 回答正确' : `✗ 回答错误，正确答案 ${q.answer}`}
                  </div>
                )}
                {qJudged && q.explanation && <div className="practice-explain">{q.explanation}</div>}
                {qJudged && !q.explanation && (
                  <div className="practice-explain is-empty">暂无解析——AI 解析辅助在 X4 接入</div>
                )}
                {!qJudged && picked[q.idx] && q.answer == null && (
                  <div className="practice-verdict">该题暂无答案，提交时不计分</div>
                )}
              </section>
            )
          })}
        </article>
      )}
    </div>
  )
}
