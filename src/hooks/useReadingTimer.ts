import { useEffect, useRef, useState } from 'react'
import { useArticleStore } from '../stores/articleStore'

/**
 * 实测阅读时长（秒）：页面可见时每秒累计；每 3 秒落盘一次，
 * 离开/切后台时再补一次（IDB 异步写入在页面卸载时可能被中断，周期性落盘兜底）。
 * 返回本次会话已累计的秒数（用于头部「阅读时间」实时显示）。
 */
export function useReadingTimer(articleId: string) {
  const addReadingTime = useArticleStore((s) => s.addReadingTime)
  const [sessionSec, setSessionSec] = useState(0)
  const pendingTimeRef = useRef(0)

  useEffect(() => {
    // 计时器不依赖文章数据就绪：只要知道 articleId 即可累计时长
    let ticks = 0
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      pendingTimeRef.current += 1
      ticks += 1
      setSessionSec((s) => s + 1)
      if (ticks >= 3) {
        ticks = 0
        if (pendingTimeRef.current > 0) {
          addReadingTime(articleId, pendingTimeRef.current)
          pendingTimeRef.current = 0
        }
      }
    }
    const timer = window.setInterval(tick, 1000)
    const flushTime = () => {
      if (pendingTimeRef.current > 0) {
        addReadingTime(articleId, pendingTimeRef.current)
        pendingTimeRef.current = 0
      }
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') flushTime()
    }
    window.addEventListener('pagehide', flushTime)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', flushTime)
      document.removeEventListener('visibilitychange', onVis)
      flushTime()
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId])

  return { sessionSec }
}
