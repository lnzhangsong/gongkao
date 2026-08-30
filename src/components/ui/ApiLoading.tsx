/** 接口请求中的轻量加载态：细圈 spinner + 一行说明（列表/详情等待接口时使用） */
export function ApiLoading({ label = '正在加载…' }: { label?: string }) {
  return (
    <div className="api-loading" role="status">
      <span className="api-loading-ring" aria-hidden />
      <span>{label}</span>
    </div>
  )
}
