import { useEffect, useState } from 'react'

interface LoadingScreenProps {
  /** 提示文案 */
  hint?: string
  /** 收尾阶段：进度平滑冲到 100% */
  finishing?: boolean
}

/**
 * 全屏 loading：首次访问加载数据时显示。
 * 参考 design/reading-entry-07.html 波形动画 + 背景进度层，配色固定为「暖纸」主题。
 */
export function LoadingScreen({ hint = '正在为你打开阅读空间…', finishing = false }: LoadingScreenProps) {
  const [pct, setPct] = useState(0)

  // 进度：正常阶段递增模拟（封顶 88）；收尾阶段冲到 100
  useEffect(() => {
    if (finishing) {
      setPct(100)
      return
    }
    let cur = 0
    const timer = window.setInterval(() => {
      cur = Math.min(88, cur + Math.random() * 8 + 3)
      setPct(Math.round(cur))
    }, 160)
    return () => window.clearInterval(timer)
  }, [finishing])

  return (
    <div className="loading-screen" role="status" aria-label="加载中">
      <div className="loading-stage">
        {/* 背景进度层：accent 色从左到右填充（跟随进度） */}
        <div className="loading-bg-progress" style={{ transform: `scaleX(${pct / 100})` }} />

        {/* 波形线条（07 动画） */}
        <div className="loading-wave" />
        <div className="loading-wave w2" />

        <div className="loading-copy">
          <small>READBOOK / 024</small>
          <strong>让文字流动。</strong>
          <span className="loading-hint">{hint}</span>
        </div>

        <div className="loading-progress">
          <span>OPENING SPACE</span>
          <span className="loading-pct">{pct}%</span>
        </div>
        <div className="loading-progress-track">
          <i style={{ width: `${pct}%` }} />
        </div>

        <div className="loading-foot">READ SLOWLY　/　THINK DEEPLY　/　WRITE CLEARLY</div>
      </div>
    </div>
  )
}
