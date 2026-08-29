import { useCallback, useEffect, type RefObject } from 'react'

/** 聚焦阅读带：视口中央约一半（与 ReadingPage 原实现一致） */
const FOCUS_BAND_TOP = 0.35
const FOCUS_BAND_BOTTOM = 0.65

/**
 * 段落聚焦：阅读带内的段落保持可读，带外内容淡化，滚动时随进随出。
 * 带宽为视口中央约一半；页面顶部/底部时自动放宽贴边，
 * 避免首段/末段永远进不了带。直接切换 <p> 的 dim 类（不经 React 状态）；
 * 短文整页可见时不淡化任何段落。
 * 供 ReadingPage 与申论真题页共用（容器须挂 ref 且段落为其直接子节点）。
 */
export function useFocusMode(bodyRef: RefObject<HTMLElement | null>, enabled: boolean, ready = true) {
  const updateFocus = useCallback(() => {
    const body = bodyRef.current
    if (!body) return
    const paragraphs = body.querySelectorAll<HTMLParagraphElement>(':scope > p')
    if (paragraphs.length === 0) return

    if (!enabled) {
      paragraphs.forEach((p) => p.classList.remove('dim'))
      return
    }

    /* 页面不可滚动（正文一屏放得下）：全部保持可读 */
    const doc = document.documentElement
    if (doc.scrollHeight <= window.innerHeight + 4) {
      paragraphs.forEach((p) => p.classList.remove('dim'))
      return
    }

    const maxScroll = doc.scrollHeight - window.innerHeight
    /* 贴边放宽：页首带上缘抬到 0，页尾带下缘压到视口底 */
    const atTop = window.scrollY <= 4
    const atBottom = window.scrollY >= maxScroll - 4
    const bandTop = atTop ? 0 : window.innerHeight * FOCUS_BAND_TOP
    const bandBottom = atBottom ? window.innerHeight : window.innerHeight * FOCUS_BAND_BOTTOM

    paragraphs.forEach((p) => {
      const rect = p.getBoundingClientRect()
      const inBand = rect.top <= bandBottom && rect.bottom >= bandTop
      p.classList.toggle('dim', !inBand)
    })
  }, [bodyRef, enabled])

  // 滚动时随进随出（rAF 节流）
  useEffect(() => {
    const onScroll = () => requestAnimationFrame(updateFocus)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [updateFocus])

  // 聚焦开关 / 容器就绪：立即重算一次，再延迟一帧补算（覆盖字体 swap 引起的排版位移）
  useEffect(() => {
    if (enabled && !ready) return
    const raf = requestAnimationFrame(updateFocus)
    const late = window.setTimeout(updateFocus, 400)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(late)
    }
  }, [enabled, ready, updateFocus])
}
