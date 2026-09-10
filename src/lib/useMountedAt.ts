import { useState } from 'react'

/**
 * 挂载时刻的时间戳（惰性 state，只在首次渲染取一次）。
 *
 * 用于「近 7 天」「X 天前」这类**相对时间统计**：渲染期不再反复直接调用 `Date.now()`
 * （React 渲染应保持纯性，重复读时钟会让结果不稳定）；基准值随组件挂载 / 路由切换刷新，
 * 对本应用的日/周粒度统计足够。
 */
export function useMountedAt(): number {
  const [mountedAt] = useState(() => Date.now())
  return mountedAt
}
