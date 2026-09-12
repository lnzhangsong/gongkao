import { useEffect, useRef } from 'react'
import { useConfirmStore } from './confirm'

/** 挂载在 App 根部的弹窗宿主：键盘可达（Esc 取消 / Enter 原生激活聚焦按钮）、
 *  自动聚焦（危险操作聚焦「取消」防误触）、Tab 在两个按钮间循环。
 *  命令式 API（confirmDialog / alertDialog）在 ./confirm，本文件只导出组件以保证 HMR 友好。 */
export function ConfirmHost() {
  const current = useConfirmStore((s) => s.current)
  const clear = useConfirmStore((s) => s.clear)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!current) return
    ;(current.danger ? cancelRef : okRef).current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        clear(false)
        return
      }
      if (e.key === 'Tab') {
        const pair = [cancelRef.current, okRef.current]
        const idx = pair.indexOf(document.activeElement as HTMLButtonElement)
        if (idx === -1) return
        e.preventDefault()
        pair[(idx + (e.shiftKey ? pair.length - 1 : 1)) % pair.length]?.focus()
      }
      /* Enter 不拦截：原生激活当前聚焦的按钮（危险时聚焦在「取消」上） */
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [current, clear])

  if (!current) return null
  return (
    <div
      className="exam-modal-mask"
      role="presentation"
      onClick={(e) => {
        /* 只有点在遮罩本身（而非内容区）才关闭：省掉内层 stopPropagation 处理器 */
        if (e.target === e.currentTarget) clear(false)
      }}
    >
      <div className="exam-modal" role="alertdialog" aria-modal="true" aria-describedby="confirm-dialog-msg">
        <p className="exam-modal-msg" id="confirm-dialog-msg">
          {current.message}
        </p>
        <div className="exam-modal-actions">
          <button ref={cancelRef} className="ghost" onClick={() => clear(false)}>
            取消
          </button>
          <button
            ref={okRef}
            className={`ghost${current.danger ? ' exam-btn-danger' : ' exam-btn-primary'}`}
            onClick={() => clear(true)}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
