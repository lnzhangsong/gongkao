import { create } from 'zustand'

/**
 * 全站统一的确认 / 提示弹窗的 store 与命令式 API：
 * - confirmDialog(message, { danger })  → Promise<boolean>
 * - alertDialog(message)                → Promise<void>
 * 与宿组件（ConfirmDialog.tsx）分开：组件文件只导出组件，Fast Refresh 才能正常热更。
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
