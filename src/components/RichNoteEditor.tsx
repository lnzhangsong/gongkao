import { useEffect, useRef } from 'react'
import { Bold, Italic, Underline as UnderlineIcon, Highlighter, List, ListOrdered, ImagePlus } from 'lucide-react'
import { compressImageFile, sanitizeNoteHtml } from '../lib/richNote'

interface RichNoteEditorProps {
  /** 初始 HTML（受控初始值，内部维护编辑状态，保存时取值） */
  initialHtml: string
  onChange?: (html: string) => void
  placeholder?: string
  autoFocus?: boolean
}

/**
 * 轻量富文本笔记编辑器：contentEditable + execCommand（B/I/U/高亮/列表/插图），
 * 图片支持选文件或直接粘贴，自动压缩为长边 ≤1280 的 JPEG dataURL。
 * 保存时由外部读取 ref 内净化后的 HTML。
 */
export function RichNoteEditor({ initialHtml, onChange, placeholder, autoFocus }: RichNoteEditorProps) {
  const ref = useRef<HTMLDivElement>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== initialHtml) {
      ref.current.innerHTML = initialHtml
    }
    if (autoFocus) {
      // 光标移到末尾
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(ref.current!)
      range.collapse(false)
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emit = () => {
    if (!ref.current) return
    onChange?.(sanitizeNoteHtml(ref.current.innerHTML))
  }

  const exec = (cmd: string, value?: string) => {
    ref.current?.focus()
    document.execCommand(cmd, false, value)
    emit()
  }

  const insertImage = async (file: File) => {
    try {
      const dataUrl = await compressImageFile(file)
      exec('insertHTML', `<img src="${dataUrl}" alt="笔记插图" />`)
    } catch {
      /* 非图片或读取失败：忽略 */
    }
  }

  return (
    <div className="rich-note">
      <div className="rich-note-toolbar">
        <button type="button" title="加粗" onMouseDown={(e) => { e.preventDefault(); exec('bold') }}>
          <Bold size={13} />
        </button>
        <button type="button" title="斜体" onMouseDown={(e) => { e.preventDefault(); exec('italic') }}>
          <Italic size={13} />
        </button>
        <button type="button" title="下划线" onMouseDown={(e) => { e.preventDefault(); exec('underline') }}>
          <UnderlineIcon size={13} />
        </button>
        <button
          type="button"
          title="高亮"
          onMouseDown={(e) => {
            e.preventDefault()
            exec('hiliteColor', 'var(--highlight-bg, #e9dc66)')
          }}
        >
          <Highlighter size={13} />
        </button>
        <button type="button" title="无序列表" onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList') }}>
          <List size={13} />
        </button>
        <button type="button" title="有序列表" onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList') }}>
          <ListOrdered size={13} />
        </button>
        <button type="button" title="插入图片（也可直接粘贴）" onMouseDown={(e) => { e.preventDefault(); imgInputRef.current?.click() }}>
          <ImagePlus size={13} />
        </button>
        <input
          ref={imgInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void insertImage(f)
            e.target.value = ''
          }}
        />
      </div>
      <div
        ref={ref}
        className="rich-note-input"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          const img = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
          if (img) {
            e.preventDefault()
            const f = img.getAsFile()
            if (f) void insertImage(f)
          }
        }}
      />
    </div>
  )
}
