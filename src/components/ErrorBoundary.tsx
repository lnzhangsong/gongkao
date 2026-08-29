import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/**
 * 全局错误兜底：任何未捕获的渲染错误不再白屏整站，
 * 显示错误摘要 + 重载/回首页入口。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('渲染错误：', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-boundary">
        <div className="empty-state">
          <strong>页面出错了</strong>
          {this.state.error.message || '发生了未预期的错误'}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
            <button className="ghost" onClick={() => window.location.reload()}>
              重试
            </button>
            <button className="ghost" onClick={() => (window.location.href = '/')}>
              回首页
            </button>
          </div>
        </div>
      </div>
    )
  }
}
