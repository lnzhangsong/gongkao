import { memo } from 'react'
import { useReaderStore } from '../../stores/readerStore'
import { splitTermSegments, useGuifanTerms } from './termMatch'

/**
 * 阅读页规范词标注：把正文里出现的规范词用方框圈出来（title 提示所属主题）。
 * 匹配与词库缓存在 ./termHighlight，本文件只导出渲染组件以保证 HMR 友好。
 */

/** 段落文本 → 规范词方框标注的 React 节点（词库未就绪或开关关闭时原样返回）。
 *  memo：正文渲染频繁重渲（弹层/进度等 state），同一段文本的逐字扫描结果不该重算 */
export const TermText = memo(function TermText({ text }: { text: string }) {
  const terms = useGuifanTerms()
  const termBox = useReaderStore((s) => s.settings.termBox)
  if (!terms || !termBox) return <>{text}</>
  return (
    <>
      {splitTermSegments(text, terms).map((seg, i) =>
        seg.hit ? (
          <span key={i} className="term-box" data-term-id={seg.hit.id} title={`规范词 · ${seg.hit.theme}`}>
            {seg.text}
          </span>
        ) : (
          <Fragmentish key={i} text={seg.text} />
        ),
      )}
    </>
  )
})

function Fragmentish({ text }: { text: string }) {
  return <>{text}</>
}
