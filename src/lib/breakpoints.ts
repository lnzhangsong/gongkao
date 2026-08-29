import { useSyncExternalStore } from 'react'

/** 全站唯一窄屏断点：TS 侧（弹层定位分支）与 CSS 侧媒体查询共用同一数值 */
export const NARROW_BREAKPOINT = 900

const QUERY = `(max-width: ${NARROW_BREAKPOINT}px)`

/** 窄屏响应式状态：matchMedia 驱动（替代 resize 监听，天然免抖动） */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches
}

function getServerSnapshot() {
  return false
}
