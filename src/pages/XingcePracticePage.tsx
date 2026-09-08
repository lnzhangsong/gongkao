import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiLoading } from '../components/ui/ApiLoading'
import { fetchXingce, type XingceDetail, type XingceQuestion } from '../lib/api'
import { useXingceStore, xgKey } from '../stores/xingceStore'
import { levelMark } from '../lib/examText'
import { GroupStemText, DataUrls } from '../components/exam/GroupStemText'
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

/** 单题分屏大小：同一专项的零散单题按此数量合并成一屏，避免一题一屏太碎 */
const SINGLES_PER_SCREEN = 10

function groupQuestions(qs: XingceQuestion[]): Group[] {
  const groups: Group[] = []
  for (const q of qs) {
    const last = groups[groups.length - 1]
    // 题组（资料分析一篇材料 5 题）：独立一屏
    if (q.groupId != null && last && last.groupId === q.groupId) {
      last.questions.push(q)
      continue
    }
    // 零散单题：同专项合并一屏，满 SINGLES_PER_SCREEN 题换屏
    if (
      q.groupId == null &&
      last &&
      last.groupId == null &&
      last.questions[0].section === q.section &&
      last.questions.length < SINGLES_PER_SCREEN
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
  const nav = useNavigate()
  const [paper, setPaper] = useState<XingceDetail | null>(null)
  const [error, setError] = useState('')
  const [pos, setPos] = useState(0) // 当前分屏下标
  const [picked, setPicked] = useState<Record<number, string>>({}) // 本组暂存选择
  const [judged, setJudged] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [stemOpen, setStemOpen] = useState(true) // 资料分析材料折叠
  const scrollTarget = useRef<number | null>(null)
  const enteredAt = useRef(Date.now())
  const record = useXingceStore((s) => s.record)
  const answers = useXingceStore((s) => s.answers)

  useEffect(() => {
    let alive = true
    fetchXingce(paperId)
      .then((d) => alive && setPaper(d))
      .catch((e) => alive && setError(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [paperId])

  const groups = useMemo(() => (paper ? groupQuestions(paper.questions) : []), [paper])
  const group = groups[pos]

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
    setJudged(false)
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

  const submit = () => {
    if (!group) return
    const seconds = Math.round((Date.now() - enteredAt.current) / 1000 / group.questions.length)
    for (const q of group.questions) {
      if (q.answer == null) continue
      const p = picked[q.idx] ?? ''
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
    setJudged(true)
  }

  const doneCount = paper.questions.filter((q) => answers[xgKey(paper.id, q.idx)]).length
  const rightCount = paper.questions.filter((q) => answers[xgKey(paper.id, q.idx)]?.correct).length
  const wrongCount = doneCount - rightCount
  const pct = Math.round((doneCount / paper.questions.length) * 100)
  const cols = group ? optionCols(group.questions) : 1
  const isMaterialGroup = group?.groupId != null && (!!group.groupStem || !!group.groupImage)

  return (
    <div className="exam-page practice-page">
      <header className="practice-head">
        <button className="practice-back" onClick={() => nav('/practice')}>
          ← 练习
        </button>
        <div className="practice-title">
          <span className="eyebrow">
            XINGCE / {paper.year} · {paper.level}
          </span>
          <h1>{paper.title}</h1>
        </div>
        <div className="practice-progress">
          <button className="practice-sheet-toggle" onClick={() => setSheetOpen((o) => !o)}>
            答题卡
          </button>
          <span className="practice-mark" aria-hidden>
            {levelMark(paper.level)}
          </span>
        </div>
      </header>

      {/* 进度条 + 统计：薄薄一条，不占纵向空间 */}
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
        <button className="practice-sheet-toggle is-mini" onClick={() => setSheetOpen((o) => !o)}>
          {sheetOpen ? '收起答题卡 ▴' : '展开答题卡 ▾'}
        </button>
      </div>

      {/* 答题卡：浮层面板，不把题目顶下去 */}
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
          <div className="practice-sheet-grid">
            {paper.questions.map((q) => {
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
                  title={`${q.section} · 第${q.idx}题`}
                >
                  {q.idx}
                </button>
              )
            })}
          </div>
        </div>
      )}

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
                  <DataUrls value={group.groupImage} altPrefix={`第${group.questions[0].idx}题组材料`} />
                  <GroupStemText text={group.groupStem} />
                </div>
              )}
            </div>
          )}

          {group.questions.map((q) => {
            const saved = answers[xgKey(paper.id, q.idx)]
            const pick = judged ? (saved?.picked ?? '') : (picked[q.idx] ?? '')
            const imgOpt = !!q.image && q.options.every((o) => !o.text)
            return (
              <section className="practice-q" key={q.idx} id={`q-${q.idx}`}>
                {!/^第\d+题（见配图）$/.test(q.stem) && (
                  <p className="practice-stem">
                    <strong>{q.idx}.</strong> {q.stem}
                  </p>
                )}
                {q.image && <DataUrls value={q.image} altPrefix={`第${q.idx}题`} />}
                <div
                  className={`practice-options cols-${cols}${imgOpt ? ' is-imgopts' : ''}`}
                  role="radiogroup"
                  aria-label={`第${q.idx}题选项`}
                >
                  {q.options.map((o) => {
                    const cls = [
                      'practice-opt',
                      pick === o.key ? ' picked' : '',
                      judged && o.key === q.answer ? ' right' : '',
                      judged && pick === o.key && o.key !== q.answer ? ' wrong' : '',
                    ].join('')
                    return (
                      <button
                        key={o.key}
                        className={cls}
                        role="radio"
                        aria-checked={pick === o.key}
                        disabled={judged}
                        onClick={() => setPicked((s) => ({ ...s, [q.idx]: o.key }))}
                      >
                        <span className="practice-opt-key">{o.key}</span>
                        {o.text}
                      </button>
                    )
                  })}
                </div>
                {judged && q.answer == null && <div className="practice-verdict">该题暂无答案，未计分</div>}
                {judged && q.answer != null && (
                  <div className={`practice-verdict${pick === q.answer ? '' : ' is-wrong'}`}>
                    {pick === q.answer
                      ? '✓ 回答正确'
                      : pick
                        ? `✗ 回答错误，正确答案 ${q.answer}`
                        : `未作答，正确答案 ${q.answer}`}
                  </div>
                )}
                {judged && q.explanation && <div className="practice-explain">{q.explanation}</div>}
                {judged && !q.explanation && (
                  <div className="practice-explain is-empty">暂无解析——AI 解析辅助在 X4 接入</div>
                )}
              </section>
            )
          })}

          <div className="practice-nav">
            <button disabled={pos === 0} onClick={() => go(pos - 1)} className="practice-nav-btn">
              ← 上一组
            </button>
            {!judged ? (
              <button
                className="practice-nav-btn is-primary"
                onClick={submit}
                disabled={group.questions.some((q) => !picked[q.idx])}
              >
                提交本组
              </button>
            ) : (
              <span className="practice-hint">本组已判分 · 重进本页可清空重刷</span>
            )}
            <button disabled={pos >= groups.length - 1} onClick={() => go(pos + 1)} className="practice-nav-btn">
              下一组 →
            </button>
          </div>
        </article>
      )}
    </div>
  )
}
