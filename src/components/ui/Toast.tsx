import { useToastStore } from './toastStore'

/**
 * 轻量 toast 宿组件：底部居中的单条提示，可带「撤销」类动作按钮。
 * 命令式 API（toast / useToastStore）在 ./toast，本文件只导出组件以保证 HMR 友好。
 */
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
