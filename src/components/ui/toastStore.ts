import { create } from 'zustand'

/**
 * 轻量 toast 的 store 与命令式 API。
 * 与宿组件（Toast.tsx）分开：组件文件只导出组件，Fast Refresh 才能正常热更。
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

/** 弹一条 toast；自动消失，新的替换旧的 */
export function toast(message: string, opts?: { actionLabel?: string; onAction?: () => void }) {
  useToastStore.getState().show(message, opts)
}
