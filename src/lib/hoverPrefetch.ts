import { useEffect, useRef } from 'react'

/** 悬停预取的防飞掠延迟：停留超过该时长才发请求，提前移出即取消 */
const HOVER_PREFETCH_DELAY_MS = 120

/**
 * 悬停预取工具：返回一个装饰函数，把「该做什么预取」变成 onMouseEnter/onFocus/onMouseLeave/onBlur props。
 * 进入（或键盘聚焦）120ms 后执行预取，移出/失焦即取消——鼠标飞掠列表不会连发请求。
 * 同一组件实例内共享一个定时器（同时只悬停一处）。
 */
export function useHoverPrefetch() {
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (task: () => void) => {
    const start = () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(task, HOVER_PREFETCH_DELAY_MS)
    }
    const cancel = () => window.clearTimeout(timer.current)
    return { onMouseEnter: start, onFocus: start, onMouseLeave: cancel, onBlur: cancel }
  }
}
