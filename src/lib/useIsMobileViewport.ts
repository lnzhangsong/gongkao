import { useEffect, useState } from 'react'

/** 是否移动端视口（≤640px）：真题抽屉在移动端保持覆盖式底部面板（锁滚动 + 遮罩），桌面端为并排让位布局 */
export function useIsMobileViewport(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(`(max-width: ${breakpoint}px)`).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [breakpoint])

  return isMobile
}
