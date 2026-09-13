import type { ArticleStudy } from '../../stores/shenlunStore'

/** 全篇层面的拆解内容（观点/分论点/骨架）有任意一项非空——只有段意时全篇卡不渲染 */
function hasOverviewData(study: ArticleStudy): boolean {
  return Boolean(
    study.coreThesis.trim() ||
    study.subTheses.length > 0 ||
    (study.skeleton &&
      ((study.skeleton.opening ?? '').trim() ||
        (study.skeleton.bodyLayers ?? []).some((s) => s.trim()) ||
        (study.skeleton.transitions ?? []).some((s) => s.trim()) ||
        (study.skeleton.closing ?? '').trim())),
  )
}

/** 拆解上屏：全篇拆解卡（核心观点 / 分论点 / 结构骨架）；没有全篇层面内容时不渲染，纯段意只显示段意条 */
export function StudyOverviewCard({ study, onCollapse }: { study: ArticleStudy; onCollapse: () => void }) {
  if (!hasOverviewData(study)) return null
  return (
    <aside className="study-overview" aria-label="全篇拆解">
      <div className="study-overview-head">
        <span className="study-overview-title">拆解 · 全篇</span>
        <button className="study-collapse" onClick={onCollapse} aria-label="收起拆解上屏">
          收起
        </button>
      </div>
      {study.coreThesis.trim() && (
        <p className="study-thesis" style={{ marginTop: 8 }}>
          {study.coreThesis}
        </p>
      )}
      {study.subTheses.length > 0 && (
        <ol className="study-subs">
          {study.subTheses.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      )}
      {study.skeleton &&
        ((study.skeleton.opening ?? '').trim() ||
          (study.skeleton.bodyLayers ?? []).some((s) => s.trim()) ||
          (study.skeleton.transitions ?? []).some((s) => s.trim()) ||
          (study.skeleton.closing ?? '').trim()) && (
          <details className="study-skeleton-details">
            <summary>结构骨架</summary>
            <div className="study-skeleton">
              {(study.skeleton.opening ?? '').trim() && (
                <p>
                  <b>开头</b>
                  {study.skeleton.opening}
                </p>
              )}
              {(study.skeleton.bodyLayers ?? [])
                .filter((s) => s.trim())
                .map((l, i) => (
                  <p key={i}>
                    <b>层次{i + 1}</b>
                    {l}
                  </p>
                ))}
              {(study.skeleton.transitions ?? []).filter((s) => s.trim()).length > 0 && (
                <p>
                  <b>过渡</b>
                  {study.skeleton.transitions!.filter((s) => s.trim()).join(' / ')}
                </p>
              )}
              {(study.skeleton.closing ?? '').trim() && (
                <p>
                  <b>收尾</b>
                  {study.skeleton.closing}
                </p>
              )}
            </div>
          </details>
        )}
    </aside>
  )
}
