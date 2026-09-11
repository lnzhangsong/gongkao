import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ApiLoading } from '../components/ui/ApiLoading'
import { fetchXingce, type XingceDetail, type XingceQuestion } from '../lib/api'
import { useXingceStore, xgKey } from '../stores/xingceStore'
import { useReaderStore, fontFamilyCss } from '../stores/readerStore'
import { loadFontFamily } from '../lib/fonts'
import { useMountedAt } from '../lib/useMountedAt'
import { formatDuration, groupScore, optionCols, showTextStem } from '../lib/xingcePractice'
import { levelMark } from '../lib/examText'
import { CondLines, GroupStemText, DataUrls } from '../components/exam/GroupStemText'
import { xingceGroupImage, xingceQuestionImage } from '../data/xingceImages'
import { MenuSelect } from '../components/ui/MenuSelect'
import '../styles/exam-preview.css'
import '../styles/practice.css'

/** 事件处理中读取当前时间（非渲染期），抽到模块作用域避免渲染路径直接调用时钟 */
const nowMs = (): number => Date.now()

/**
 * 练习 · 行测答题卡（/practice/:paperId；docs/行测做题模块设计方案.md X2）
 * 练习模式：按题组/单题分屏，每组提交即判分、即时看解析；作答落 xingceStore（本地 IndexedDB）。
 * 判分是确定性的（答案客观唯一），不经 AI、不经后端。
 */

/** 卷内题目按题组切分展示单元：单题自成一组，资料分析一篇材料 5 题共用一个分屏 */ interface Group {
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

/** 选项布局与整组小结见 lib/xingcePractice.ts（纯函数，带单测） */

/**
 * 键盘作答（刷题提速）：A–E 直选、←/→ 翻屏、Enter 提交本组、Esc 关答题卡。
 *
 * 做成「只挂监听、不渲染内容」的子组件：主组件在数据未就绪时有提前 return，
 * hooks 不能写在提前 return 之后。
 */
function PracticeKeyNav({
  enabled,
  pos,
  lastPos,
  sheetOpen,
  onGo,
  onSubmit,
  onPick,
  onCloseSheet,
}: {
  enabled: boolean
  pos: number
  lastPos: number
  sheetOpen: boolean
  onGo: (next: number) => void
  onSubmit: () => void
  onPick: (letter: string) => void
  onCloseSheet: () => void
}) {
  /* 处理函数每次渲染都会变，放进 ref；DOM 监听只挂一次 */
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    handlerRef.current = (e) => {
      if (!enabled) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      /* 正在输入（含 contenteditable）时不拦截任何键 */
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return
      }
      if (sheetOpen) {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCloseSheet()
        }
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (pos > 0) onGo(pos - 1)
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (pos < lastPos) onGo(pos + 1)
        return
      }
      /* Enter 一律作「提交本组」：鼠标点过选项/答题卡后焦点就落在按钮上，
         若让给原生激活，主流程反而失效（判分后按钮还是 disabled）。
         链接除外（它只能用 Enter 激活）；按钮仍可用空格原生激活，无键盘可达性损失 */
      if (e.key === 'Enter') {
        if (t?.tagName === 'A') return
        e.preventDefault()
        onSubmit()
        return
      }
      const letter = e.key.toUpperCase()
      if (/^[A-E]$/.test(letter)) {
        e.preventDefault()
        onPick(letter)
      }
    }
    /* 无依赖数组：每次渲染都刷新到最新闭包，监听本身不重挂 */
  })
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => handlerRef.current(e)
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
  return null
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
  /* 进入当前题组的时刻：初值取挂载时刻，go() 时用 nowMs() 重置 */
  const mountAt = useMountedAt()
  const enteredAt = useRef(mountAt)
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
    if (el) {
      /* 吸顶页头（top:76px + 自身高度）会盖住滚到视口顶部的题：
         不能直接用 scrollIntoView({block:'start'})，要按页头实际高度留偏移。
         余量给足——跳转后「本组小结」出现会让页头再长高一点 */
      const head = document.querySelector('.practice-head')
      const offset = (head?.getBoundingClientRect().height ?? 0) + 76 + 24
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' })
    }
    scrollTarget.current = null
  }, [pos, paper])

  /* 答题卡打开 / 换屏时把「当前屏」的题号格滚进可视区（题组内 10 题时不在首屏） */
  useEffect(() => {
    if (!sheetOpen) return
    document.querySelector('.practice-sheet-cell.is-current')?.scrollIntoView({ block: 'nearest' })
  }, [sheetOpen, pos])

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
    enteredAt.current = nowMs()
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
    const pending = group.questions.filter((q) => q.answer != null && !answers[xgKey(paper.id, q.idx)] && picked[q.idx])
    if (pending.length === 0) return
    /* 用时按整组均分到本次判分的题上。注意不能「先除再四舍五入」——那会丢秒，
       而「本组小结」显示的正是这些 seconds 之和；用先取整再补余数保证总和准确 */
    const elapsed = Math.max(1, Math.round((Date.now() - enteredAt.current) / 1000))
    const per = Math.floor(elapsed / pending.length)
    const remainder = elapsed - per * pending.length
    pending.forEach((q, i) => {
      record({
        paperId: paper.id,
        qIdx: q.idx,
        picked: picked[q.idx],
        correct: picked[q.idx] === q.answer,
        seconds: per + (i < remainder ? 1 : 0),
        origin: 'practice',
        updatedAt: new Date().toISOString(),
      })
    })
  }

  /* 点「重刷本组」：清空本组全部作答记录，从头做 */
  const redoGroup = () => {
    if (!group) return
    removeMany(
      paper.id,
      group.questions.map((q) => q.idx),
    )
    setPicked({})
    enteredAt.current = nowMs()
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
  const isMaterialGroup =
    group?.groupId != null && (!!group.groupStem || !!xingceGroupImage(paper.id, group.questions[0].groupId))

  /* 本组判分小结（对 N / 共 M、用时）：用时取每题记录的 seconds 之和，渲染期不读时钟 */
  const score = group ? groupScore(group.questions, (idx) => answers[xgKey(paper.id, idx)]) : null

  /** 键盘直选：落到本组第一道「未判分且尚未选」的题，于是连按 A、B、C 即可顺序作答 */
  const pickByLetter = (letter: string) => {
    if (!group) return
    const pickable = group.questions.filter((q) => q.answer != null && !answers[xgKey(paper.id, q.idx)])
    if (pickable.length === 0) return
    const target = pickable.find((q) => !picked[q.idx]) ?? pickable[0]
    if (!target.options.some((o) => o.key === letter)) return
    setPicked((s) => ({ ...s, [target.idx]: letter }))
  }

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
          {/* 键盘提示：小屏隐藏（无实体键盘） */}
          <span className="practice-keyhint">A–E 选 · ←→ 翻屏 · Enter 提交</span>
        </div>

        {/* 本组判分小结：全部判分后常驻吸顶区，滚到题组末尾也能看到 */}
        {allJudged && score && (
          <div className="practice-summary" role="status">
            <span>
              本组 <strong>{score.right}</strong> / {score.total} 题
            </span>
            <span className="practice-summary-time">用时 {formatDuration(score.seconds)}</span>
          </div>
        )}

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

      {/* 键盘作答监听（不渲染内容） */}
      <PracticeKeyNav
        enabled={!!group}
        pos={pos}
        lastPos={groups.length - 1}
        sheetOpen={sheetOpen}
        onGo={go}
        onSubmit={submit}
        onPick={pickByLetter}
        onCloseSheet={() => setSheetOpen(false)}
      />

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
                  {xingceGroupImage(paper.id, group.questions[0].groupId) ? (
                    // 材料截图里已含完整文字，只渲染图，避免重复
                    <DataUrls
                      value={xingceGroupImage(paper.id, group.questions[0].groupId)!}
                      altPrefix={`第${group.questions[0].idx}题组材料`}
                    />
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
            // 纯图选项题：选项只是字母钮；补图题（图 + 文本选项）选项照常渲染文字
            const qImg = xingceQuestionImage(paper.id, q.idx)
            const imgQ = !!qImg && q.options.every((o) => !o.text)
            return (
              <section className="practice-q" key={q.idx} id={`q-${q.idx}`}>
                {showTextStem(q.stem) && (
                  <p className="practice-stem">
                    <strong>{q.idx}.</strong> <CondLines text={q.stem} />
                  </p>
                )}
                {qImg && <DataUrls value={qImg} altPrefix={`第${q.idx}题`} />}
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
                {/* 判定结果只靠选项的红/绿框表达；解析紧跟其后 */}
                {qJudged && q.explanation && (
                  <div className="practice-explain">
                    <CondLines text={q.explanation} />
                  </div>
                )}
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
