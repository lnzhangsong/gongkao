import { useMemo, useState } from 'react'
import { createExam, fetchExam, type ExamPaperMeta } from '../../lib/api'
import { alertDialog } from '../ui/confirm'
import { ApiLoading } from '../ui/ApiLoading'
import { useHoverPrefetch } from '../../lib/hoverPrefetch'
import { levelClass, levelMark } from '../../lib/examText'

interface ExamListViewProps {
  papers: ExamPaperMeta[] | null
  listError: boolean
  /** 增删改只有本地 api-server 提供（生产只读），按能力探测显隐 */
  canManage: boolean
  /** 点试卷卡打开详情（保存列表滚动位置、路由跳转） */
  onOpen: (id: string) => void
  /** 新建成功后回调（进入详情并直接进入编辑态） */
  onCreated: (id: string) => void
  /** 列表拉取失败重试 */
  onReload: () => void
}

/** 申论真题列表页：hero + 按年份分组的试卷网格 + （本地可写时）新建表单 */
export function ExamListView({ papers, listError, canManage, onOpen, onCreated, onReload }: ExamListViewProps) {
  const [creating, setCreating] = useState(false)
  const [creatingBusy, setCreatingBusy] = useState(false)
  const [newForm, setNewForm] = useState({ year: String(new Date().getFullYear() + 1), level: '地市级', title: '' })
  /* 年份输入的临时字符串：清空重输时数字不再跳变，失焦时校验回写 */
  const [yearDraft, setYearDraft] = useState(newForm.year)

  const submitCreate = async () => {
    if (creatingBusy) return
    const year = parseInt(newForm.year, 10)
    const title = newForm.title.trim() || `${year}年国家公务员考试《申论》题（${newForm.level}）`
    setCreatingBusy(true)
    try {
      const { id } = await createExam({ year, level: newForm.level, title })
      setCreating(false)
      onCreated(id)
    } catch (e) {
      void alertDialog(e instanceof Error ? e.message : String(e))
    } finally {
      setCreatingBusy(false)
    }
  }

  /** 悬停预取详情：试卷正文较大，点进去时多半已在会话缓存（120ms 防飞掠） */
  const warmExam = (id: string) => void fetchExam(id).catch(() => {})
  const hoverWarm = useHoverPrefetch()

  const grouped = useMemo(() => {
    const g = new Map<number, ExamPaperMeta[]>()
    for (const p of papers ?? []) {
      if (!g.has(p.year)) g.set(p.year, [])
      g.get(p.year)!.push(p)
    }
    return [...g.entries()].sort((a, b) => b[0] - a[0])
  }, [papers])

  return (
    <div className="exam-page">
      <header className="subpage-header exam-hero">
        <div>
          <div className="eyebrow">GUOKAO SHENLUN　/　2000–2026</div>
          <h1>
            把真题，
            <br />
            <span>读成素材。</span>
          </h1>
        </div>
        <div className="exam-hero-side">
          <p className="subpage-copy">历年国考申论真题与参考答案，按年份、层级整理，和人民日报时评对照着读。</p>
          {creating ? (
            <div className="exam-new-form">
              <input
                className="exam-new-input"
                type="number"
                value={yearDraft}
                onChange={(e) => setYearDraft(e.target.value)}
                onBlur={() => {
                  const n = parseInt(yearDraft, 10)
                  if (n >= 2000 && n <= 2100) setNewForm((f) => ({ ...f, year: String(n) }))
                  else setYearDraft(newForm.year)
                }}
                aria-label="年份"
              />
              <select
                className="exam-new-select"
                value={newForm.level}
                onChange={(e) => setNewForm((f) => ({ ...f, level: e.target.value }))}
                aria-label="层级"
              >
                {['副省级', '地市级', '行政执法', '未分级'].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              <input
                className="exam-new-input exam-new-title"
                placeholder="试卷标题"
                value={newForm.title}
                onChange={(e) => setNewForm((f) => ({ ...f, title: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitCreate()
                }}
              />
              <button className="ghost" disabled={creatingBusy} onClick={submitCreate}>
                {creatingBusy ? '创建中…' : '创建'}
              </button>
              <button className="text-btn muted" onClick={() => setCreating(false)}>
                取消
              </button>
            </div>
          ) : canManage ? (
            <button className="ghost" onClick={() => setCreating(true)}>
              ＋ 新增试卷
            </button>
          ) : null}
        </div>
      </header>
      {listError && (
        <div className="empty-state">
          <strong>试卷列表暂时无法加载</strong>
          本地 API 服务可能没有启动，服务恢复后可重试。
          <div style={{ marginTop: 12 }}>
            <button className="ghost" onClick={onReload}>
              重试
            </button>
          </div>
        </div>
      )}
      {papers === null && !listError && <ApiLoading label="正在加载试卷列表…" />}
      {papers !== null && papers.length === 0 && !listError && (
        <div className="empty-state">
          <strong>还没有试卷</strong>
          点右上角「新增试卷」创建第一份真题
        </div>
      )}
      {papers !== null && papers.length > 0 && !listError && (
        <div className="fade-in">
          {grouped.map(([year, list]) => (
            <section key={year}>
              <div className="content-head exam-year-head">
                <h2>{year}</h2>
                <span>{list.length} 卷</span>
              </div>
              <div className="exam-grid">
                {list.map((p) => (
                  <button
                    key={p.id}
                    className={`exam-card${levelClass(p.level)}`}
                    title={`${p.level} · ${p.title}`}
                    onClick={() => onOpen(p.id)}
                    {...hoverWarm(() => warmExam(p.id))}
                  >
                    <small>{p.hasAnswer ? '有答案' : '无答案'}</small>
                    <h4>{p.title}</h4>
                    <span className="exam-card-meta">
                      {p.materialCount} 材料 · {p.questionCount} 题
                    </span>
                    <span className="exam-card-mark" aria-hidden>
                      {levelMark(p.level)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
