import { useEffect, useRef } from 'react'
import { create } from 'zustand'

/**
 * 全站统一的确认 / 提示弹窗（替代原生 confirm/alert）：
 * - confirmDialog(message, { danger })  → Promise<boolean>
 * - alertDialog(message)                → Promise<void>
 * 样式复用原真题页的 .exam-modal（现定义在 base.css，跨页面可用）；
 * 需要在 App 挂一次 <ConfirmHost />。
 */
interface ConfirmOptions {
  message: string
  /** 危险操作（删除等）：确定按钮用警示色 */
  danger?: boolean
}

interface ConfirmState {
  current: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  show: (opts: ConfirmOptions, resolve: (ok: boolean) => void) => void
  clear: (ok: boolean) => void
}

export const useConfirmStore = create<ConfirmState>()((set, get) => ({
  current: null,
  show: (opts, resolve) => {
    /* 已有弹窗未决时直接取消旧的，避免 Promise 悬挂 */
    get().current?.resolve(false)
    set({ current: { ...opts, resolve } })
  },
  clear: (ok) => {
    const cur = get().current
    if (cur) {
      cur.resolve(ok)
      set({ current: null })
    }
  },
}))

export function confirmDialog(message: string, opts?: { danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().show({ message, danger: opts?.danger }, resolve)
  })
}

export function alertDialog(message: string): Promise<void> {
  return new Promise((resolve) => {
    useConfirmStore.getState().show({ message }, () => resolve())
  })
}

/** 挂载在 App 根部的弹窗宿主：键盘可达（Esc 取消 / Enter 原生激活聚焦按钮）、
 *  自动聚焦（危险操作聚焦「取消」防误触）、Tab 在两个按钮间循环 */
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
    <div className="exam-modal-mask" onClick={() => clear(false)}>
      <div
        className="exam-modal"
        role="alertdialog"
        aria-modal="true"
        aria-describedby="confirm-dialog-msg"
        onClick={(e) => e.stopPropagation()}
      >
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
