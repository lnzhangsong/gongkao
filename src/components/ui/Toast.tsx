import { create } from 'zustand'

/**
 * 轻量 toast：底部居中的单条提示，可带「撤销」类动作按钮。
 * 自动消失；新 toast 替换旧的（单条队列足够，本应用无并发展示需求）。
 */
interface ToastState {
  current: { message: string; actionLabel?: string; onAction?: () => void; key: number } | null
  show: (message: string, opts?: { actionLabel?: string; onAction?: () => void }) => void
  clear: () => void
}

export const useToastStore = create<ToastState>()((set) => ({
  current: null,
  show: (message, opts) =>
    set({ current: { message, actionLabel: opts?.actionLabel, onAction: opts?.onAction, key: Date.now() } }),
  clear: () => set({ current: null }),
}))

export function toast(message: string, opts?: { actionLabel?: string; onAction?: () => void }) {
  useToastStore.getState().show(message, opts)
}

export function ToastHost() {
  const current = useToastStore((s) => s.current)
  const clear = useToastStore((s) => s.clear)
  if (!current) return null
  window.setTimeout(() => {
    const cur = useToastStore.getState().current
    if (cur?.key === current.key) clear()
  }, 5000)
  return (
    <div className="app-toast fade-in" role="status" key={current.key}>
      <span>{current.message}</span>
      {current.actionLabel && (
        <button
          onClick={() => {
            current.onAction?.()
            clear()
          }}
        >
          {current.actionLabel}
        </button>
      )}
    </div>
  )
}
