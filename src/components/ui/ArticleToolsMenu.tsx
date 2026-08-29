import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { ArrowLeft, Bookmark, Library, Minus, Plus, SlidersHorizontal, StickyNote, Settings } from 'lucide-react'
import { MenuSelect } from './MenuSelect'
import { FONT_FAMILIES } from '../../stores/readerStore'
import type { ReaderSettings } from '../../types'

interface ArticleToolsMenuProps {
  fontSize: number
  onFontSize: (px: number) => void
  fontFamily: ReaderSettings['fontFamily']
  onFontFamily: (key: ReaderSettings['fontFamily']) => void
  themeLabel: string
  onCycleTheme: () => void
  favorite: boolean
  onToggleFavorite: () => void
  annotationsVisible: boolean
  onToggleAnnotations: () => void
  focusMode: boolean
  onToggleFocus: () => void
}

/**
 * 移动端阅读辅助菜单：右上角汉堡包按钮，点击弹出阅读工具。
 * 桌面端仍使用右侧栏（article-tools），本组件仅在 ≤900px 显示。
 */
export function ArticleToolsMenu({
  fontSize,
  onFontSize,
  fontFamily,
  onFontFamily,
  themeLabel,
  onCycleTheme,
  favorite,
  onToggleFavorite,
  annotationsVisible,
  onToggleAnnotations,
  focusMode,
  onToggleFocus,
}: ArticleToolsMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // 正文选中文字时会弹出「添加标注工具栏」，与本菜单同为 fixed 定位，
    // 若不收起会在屏幕上重叠——选区变化时自动关闭本菜单
    const onSelectionChange = () => {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [open])

  return (
    <div className="article-tools-menu reading-page-menu" ref={ref}>
      <button
        className="tools-hamburger"
        onClick={() => setOpen((o) => !o)}
        aria-label="阅读辅助"
        aria-expanded={open}
      >
        <SlidersHorizontal size={18} />
      </button>

      {open && (
        <div className="tools-menu-pop">
          <span className="tools-menu-title">阅读辅助</span>

          {/* 页面导航（替代头部跳转菜单） */}
          <div className="tools-menu-nav">
            <button
              className="tools-menu-nav-back"
              onClick={() => {
                /* 外链/书签直达时没有可退的站内历史，回文库兜底 */
                const idx: number | undefined = window.history.state?.idx
                if (idx === undefined || idx <= 0) navigate('/library')
                else navigate(-1)
              }}
            >
              <ArrowLeft size={12} /> 返回
            </button>
            <NavLink to="/library" onClick={() => setOpen(false)}>
              <Library size={12} /> 文库
            </NavLink>
            <NavLink to="/notes" onClick={() => setOpen(false)}>
              <StickyNote size={12} /> 摘录
            </NavLink>
            <NavLink to="/settings" onClick={() => setOpen(false)}>
              <Settings size={12} /> 设置
            </NavLink>
          </div>

          <div className="tools-menu-item">
            <span>阅读设置</span>
            <span className="tool-btns">
              <button onClick={() => onFontSize(fontSize - 1)} aria-label="减小字号">
                <Minus size={12} />
              </button>
              <span className="tools-size-value">{fontSize}px</span>
              <button onClick={() => onFontSize(fontSize + 1)} aria-label="增大字号">
                <Plus size={12} />
              </button>
            </span>
          </div>

          <div className="tools-menu-item">
            <span>正文字体</span>
            <MenuSelect
              value={fontFamily}
              options={FONT_FAMILIES.map((f) => ({ key: f.key, label: f.label }))}
              onChange={(key) => onFontFamily(key as ReaderSettings['fontFamily'])}
              ariaLabel="正文字体"
            />
          </div>

          <div className="tools-menu-item">
            <span>阅读主题</span>
            <button className="tools-menu-action" onClick={onCycleTheme}>
              {themeLabel}　↻
            </button>
          </div>

          <div className="tools-menu-item">
            <span>文章操作</span>
            <button
              className={`tools-menu-action${favorite ? ' active' : ''}`}
              onClick={() => {
                onToggleFavorite()
                setOpen(false)
              }}
            >
              <Bookmark size={12} style={{ verticalAlign: -2 }} /> {favorite ? '已收藏' : '收藏'}
            </button>
          </div>

          <div className="tools-menu-item">
            <span>显示标注</span>
            <button
              className={`tools-menu-action${annotationsVisible ? ' active' : ''}`}
              onClick={() => {
                onToggleAnnotations()
                setOpen(false)
              }}
            >
              {annotationsVisible ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="tools-menu-item">
            <span>段落聚焦</span>
            <button
              className={`tools-menu-action${focusMode ? ' active' : ''}`}
              onClick={() => {
                onToggleFocus()
                setOpen(false)
              }}
            >
              {focusMode ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
