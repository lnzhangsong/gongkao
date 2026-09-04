import { useCallback, useRef, useState } from 'react'

const KEY = 'readbook:exam-panel-h'
const MIN_H = 180
const MAX_RATIO = 0.85

/**
 * 底部解析面板的拖拽调高（桌面端上下分栏用）：
 * 拖面板顶缘的把手改高度，范围 180px ~ 85vh，选择持久化到 localStorage。
 */
export function usePanelResize() {
  const [height, setHeight] = useState<number>(() => {
    if (typeof window === 'undefined') return 380
    const saved = Number(localStorage.getItem(KEY))
    if (saved >= MIN_H && saved <= window.innerHeight * MAX_RATIO) return saved
    return Math.round(window.innerHeight * 0.52)
  })
  const heightRef = useRef(height)
  heightRef.current = height

  const onHandleDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = heightRef.current
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件无活动指针时会抛，忽略即可 */
    }

    const move = (ev: PointerEvent) => {
      const h = Math.min(Math.max(startH + (startY - ev.clientY), MIN_H), window.innerHeight * MAX_RATIO)
      heightRef.current = Math.round(h)
      setHeight(heightRef.current)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const final = Math.min(Math.max(startH + (startY - ev.clientY), MIN_H), window.innerHeight * MAX_RATIO)
      heightRef.current = Math.round(final)
      setHeight(heightRef.current)
      localStorage.setItem(KEY, String(heightRef.current))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, [])

  return { height, onHandleDown }
}
