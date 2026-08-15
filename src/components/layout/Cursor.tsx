import { useEffect, useRef } from 'react'

/** 自定义光标：跟随指针的差异混合圆点，悬停交互元素时放大 */
export function Cursor() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fine = window.matchMedia('(pointer: fine)').matches
    if (!fine) return
    document.body.classList.add('cursor-on')

    const move = (e: PointerEvent) => {
      el.style.left = `${e.clientX}px`
      el.style.top = `${e.clientY}px`
      el.style.opacity = '1'
    }
    const leave = () => {
      el.style.opacity = '0'
    }
    const over = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      const interactive = t.closest('a, button, select, input, textarea, [data-cursor]')
      el.classList.toggle('hover', Boolean(interactive))
    }

    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerleave', leave)
    document.addEventListener('mouseover', over, { passive: true })
    return () => {
      document.body.classList.remove('cursor-on')
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', leave)
      document.removeEventListener('mouseover', over)
    }
  }, [])

  return <div className="cursor" ref={ref} aria-hidden="true" />
}
