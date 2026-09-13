import { useCallback, useState } from 'react'

/** 拆解上屏开关（按文章）持久化到 localStorage；存储异常时静默退化为内存态 */
const STUDY_INLINE_KEY = 'readbook:studyInline'

function readStudyInline(articleId: string): boolean {
  try {
    return localStorage.getItem(`${STUDY_INLINE_KEY}:${articleId}`) === '1'
  } catch {
    return false
  }
}

function writeStudyInline(articleId: string, on: boolean) {
  try {
    if (on) localStorage.setItem(`${STUDY_INLINE_KEY}:${articleId}`, '1')
    else localStorage.removeItem(`${STUDY_INLINE_KEY}:${articleId}`)
  } catch {
    /* 存储不可用（隐私模式等）：仅当前会话生效 */
  }
}

/**
 * 拆解上屏开关：按文章持久化到 localStorage——否则刷新/切回后复位 OFF，
 * 用户视角就是「点了 ON 没生效」。切文章时先把旧篇的开关写回再载入新篇
 * （render 期调整，避免 effect 顺序竞态覆盖存值）。
 */
export function useStudyInline(articleId: string) {
  const [studyInlineFor, setStudyInlineFor] = useState(articleId)
  const [studyInline, setStudyInline] = useState(() => readStudyInline(articleId))
  if (studyInlineFor !== articleId) {
    writeStudyInline(studyInlineFor, studyInline)
    setStudyInlineFor(articleId)
    setStudyInline(readStudyInline(articleId))
  }

  const toggleStudyInline = useCallback(() => {
    const next = !studyInline
    writeStudyInline(articleId, next)
    setStudyInline(next)
    if (next) {
      /* 拆解卡渲染在正文最顶部：用户在页面中部点 ON 时视口内毫无变化，像"没反应"，故滚回顶部 */
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    }
  }, [articleId, studyInline])

  /* 打开申论抽屉时自动开启拆解上屏（若已开则不动） */
  const turnStudyInlineOn = useCallback(() => {
    setStudyInline((v) => {
      if (v) return v
      writeStudyInline(articleId, true)
      return true
    })
  }, [articleId])

  const turnStudyInlineOff = useCallback(() => {
    writeStudyInline(articleId, false)
    setStudyInline(false)
  }, [articleId])

  return { studyInline, toggleStudyInline, turnStudyInlineOn, turnStudyInlineOff }
}
