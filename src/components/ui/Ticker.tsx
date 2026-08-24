import { useEffect, useRef, useState } from 'react'
import { useReaderStore } from '../../stores/readerStore'

interface TickerProps {
  value: number
  /** 动画时长 ms */
  duration?: number
}

/**
 * 数字滚动：值变化时从旧值缓动到新值（number ticker）。
 * 「减少动效」开启时直接跳到目标值。
 */
export function Ticker({ value, duration = 600 }: TickerProps) {
  const reducedMotion = useReaderStore((s) => s.settings.reducedMotion)
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef(0)

  useEffect(() => {
    if (reducedMotion || fromRef.current === value) {
      fromRef.current = value
      setDisplay(value)
      return
    }
    const from = fromRef.current
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) /* easeOutCubic */
      setDisplay(Math.round(from + (value - from) * eased))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        fromRef.current = value
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration, reducedMotion])

  return <>{display}</>
}
