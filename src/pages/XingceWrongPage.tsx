import { useEffect, useMemo, useState } from 'react'
import { ApiLoading } from '../components/ui/ApiLoading'
import { useXingceStore } from '../stores/xingceStore'
import { fetchXingce, type XingceQuestion } from '../lib/api'
import { showTextStem } from '../lib/xingcePractice'
import { CondLines, DataUrls } from '../components/exam/GroupStemText'
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
      const list = m.get(it.q.section) ?? []
      list.push(it)
      m.set(it.q.section, list)
    }
    return [...m.entries()]
  }, [items])

  if (items === null)
    return (
      <div className="exam-page">
        <ApiLoading label="正在整理错题…" />
      </div>
    )

  return (
    <div className="exam-page">
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

      {bySection.map(([section, list]) => (
        <section key={section}>
          <div className="content-head exam-year-head">
            <h2>{section}</h2>
            <span>{list.length} 题</span>
          </div>
          <div className="fade-in">
            {list.map((it) => (
              <article className="practice-group" key={`${it.paperId}#${it.q.idx}`}>
                <div className="practice-group-stem">
                  <small style={{ fontFamily: 'var(--mono)', opacity: 0.6 }}>{it.paperTitle}</small>
                  {showTextStem(it.q.stem) && (
                    <>
                      {'\n'}
                      {it.q.idx}. <CondLines text={it.q.stem} />
                    </>
                  )}
                </div>
                {it.q.image ? (
                  <DataUrls value={it.q.image} altPrefix={`第${it.q.idx}题`} />
                ) : (
                  it.q.groupImage && <DataUrls value={it.q.groupImage} altPrefix={`第${it.q.idx}题组材料`} />
                )}
                <div className={`practice-verdict${it.picked ? ' is-wrong' : ''}`}>
                  {it.picked ? `你选了 ${it.picked}` : '未作答'} · 正确答案 {it.q.answer}
                </div>
                {it.q.explanation && (
                  <div className="practice-explain">
                    <CondLines text={it.q.explanation} />
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
