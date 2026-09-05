import { useEffect } from 'react'
import { useLearningEventStore } from '../../stores/learningEventStore'

/** 驻留判定：词框在视口内、且视口静止（无滚动 ≥2s）时开始计时，累计 ≥6s 记一次「见过」。
 *  滚动即暂停——略读的滚动时间不进表，只有停下来读的静止段累计。 */
const DWELL_MS = 6000
/** 判定为「视口静止」所需的无滚动时长 */
const IDLE_MS = 2000

/**
 * 规范词视区驻留追踪（学习者数据模型「见过」的注意力口径）：
 * - 观察正文里所有 .term-box[data-term-id]；
 * - 仅当视口静止（最后一次滚动距今 ≥2s）且词框可见时计时，滚动立即暂停并落账；
 * - 静止段累计 ≥6s 记一条 term-seen 证据（objectId = `${articleId}#${termId}`，
 *   事件层同日去重 = 同词同文一天最多一次）；
 * - 页面隐藏/组件卸载时把进行中的计时落账。
 */
export function TermDwellTracker({ articleId }: { articleId: string }) {
  useEffect(() => {
    const visible = new Map<Element, number>() // 已累计的静止驻留 ms
    const enterAt = new Map<Element, number>() // 本次静止段开始时刻
    const timers = new Map<Element, number>() // 满时长定时器
    const candidates = new Set<Element>() // 本文观察过的全部词框（恢复静止后从这里重启计时）
    const doneTerms = new Set<string>() // 本文已记过的词
    let lastScrollAt = -Infinity

    const log = (termId: string) => {
      if (doneTerms.has(termId)) return
      doneTerms.add(termId)
      useLearningEventStore.getState().log('term-seen', `${articleId}#${termId}`)
    }
    const settle = (el: Element, now: number) => {
      const t0 = enterAt.get(el)
      if (t0 == null) return 0
      enterAt.delete(el)
      const acc = (visible.get(el) ?? 0) + (now - t0)
      visible.set(el, acc)
      return acc
    }
    const pauseOne = (el: Element, now: number) => {
      window.clearTimeout(timers.get(el))
      timers.delete(el)
      const termId = (el as HTMLElement).dataset.termId
      const acc = settle(el, now)
      if (termId && acc >= DWELL_MS) log(termId)
    }
    const pauseAll = (now: number) => {
      for (const el of [...enterAt.keys()]) pauseOne(el, now)
    }
    const startIfEligible = (el: Element, now: number) => {
      if (enterAt.has(el) || timers.has(el)) return
      const termId = (el as HTMLElement).dataset.termId
      if (!termId || doneTerms.has(termId)) return
      const r = el.getBoundingClientRect()
      if (r.top >= window.innerHeight || r.bottom <= 0) return
      enterAt.set(el, now)
      timers.set(
        el,
        window.setTimeout(() => {
          timers.delete(el)
          if (enterAt.has(el)) log(termId)
        }, DWELL_MS),
      )
    }
    const io = new IntersectionObserver(
      (entries) => {
        const now = performance.now()
        for (const en of entries) candidates.add(en.target)
        /* 静止状态下新进入视口的词框直接开表；滚动中进入的只登记，等恢复静止再开表 */
        if (now - lastScrollAt >= IDLE_MS) {
          for (const en of entries) if (en.isIntersecting) startIfEligible(en.target, now)
        } else {
          for (const en of entries) if (!en.isIntersecting) pauseOne(en.target, now)
        }
      },
      { threshold: 0.5 },
    )
    const onScroll = () => {
      lastScrollAt = performance.now()
      pauseAll(performance.now())
    }
    /* 周期巡检：滚动停止 ≥2s 后重启可见词框的计时；顺带收编新渲染的词框 */
    const tick = () => {
      const now = performance.now()
      for (const el of document.querySelectorAll('.term-box[data-term-id]')) candidates.add(el)
      if (now - lastScrollAt >= IDLE_MS && document.visibilityState === 'visible') {
        for (const el of candidates) startIfEligible(el, now)
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') pauseAll(performance.now())
    }
    for (const el of document.querySelectorAll('.term-box[data-term-id]')) candidates.add(el)
    const rescan = window.setInterval(tick, 1000)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(rescan)
      window.removeEventListener('scroll', onScroll, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      for (const t of timers.values()) window.clearTimeout(t)
      pauseAll(performance.now())
      io.disconnect()
    }
  }, [articleId])
  return null
}
