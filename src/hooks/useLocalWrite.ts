import { useEffect, useState } from 'react'
import { localWriteKnown, probeLocalWrite } from '../lib/capabilities'

/**
 * 本地 API 是否可写（详见 lib/capabilities.ts）。
 * 探测完成前返回 false（管理入口先隐藏、探测完再出现），避免「显示了但点了必失败」。
 * 用 hook 而非各页自写 state：写入口的 gate 散在 ReadingPage / ExamPreviewPage /
 * TermsPage 三处，上一版各判各的漏了两处——收口到这里。
 *
 * 模块层失败可重试还不够：本 effect 只跑一次，探测「未知」（网络失败）时必须在这里
 * 有限重试，否则 dev:all 竞态下已挂载的页面要切走再切回来才恢复。判据：探测后
 * localWriteKnown() 仍为 null 即网络失败；明确的 404（只读）不重试。
 */
export function useLocalWrite(): boolean {
  const [enabled, setEnabled] = useState(() => localWriteKnown() ?? false)
  useEffect(() => {
    if (localWriteKnown() !== null) return
    let mounted = true
    let retries = 0
    const timers: ReturnType<typeof setTimeout>[] = []
    const probe = () => {
      void probeLocalWrite().then((ok) => {
        if (!mounted) return
        if (localWriteKnown() !== null) {
          setEnabled(ok) // 明确答复（可写，或 404 只读）
          return
        }
        if (retries < 2) {
          retries += 1
          timers.push(setTimeout(probe, retries === 1 ? 1000 : 3000))
        }
        // 重试用尽仍未知：保持隐藏，等组件下次挂载（切页回来）再探
      })
    }
    probe()
    return () => {
      mounted = false
      timers.forEach(clearTimeout)
    }
  }, [])
  return enabled
}
