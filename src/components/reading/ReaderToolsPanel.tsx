import { Bookmark, Minus, Plus } from 'lucide-react'
import { MenuSelect } from '../ui/MenuSelect'
import { FONT_FAMILIES } from '../../stores/readerStore'
import { THEMES } from '../../stores/themeStore'
import type { ReaderSettings } from '../../types'

interface ReaderToolsPanelProps {
  settings: ReaderSettings
  onFontSizeDelta: (delta: number) => void
  onFontFamily: (fontFamily: ReaderSettings['fontFamily']) => void
  /** 当前生效主题名（含阅读页覆盖解析后的值） */
  activeTheme: string
  onCycleTheme: () => void
  favorite: boolean
  onToggleFavorite: () => void
  annotationsVisible: boolean
  onToggleAnnotations: () => void
  onToggleFocus: () => void
  /** 标签字号（申论真题页传入；阅读页不传则隐藏该行） */
  labelFontSize?: number
  onLabelFontSizeDelta?: (delta: number) => void
}

/** 阅读页右侧「阅读辅助」面板（移动端收进 ArticleToolsMenu 汉堡菜单） */
export function ReaderToolsPanel({
  settings,
  onFontSizeDelta,
  onFontFamily,
  activeTheme,
  onCycleTheme,
  favorite,
  onToggleFavorite,
  annotationsVisible,
  onToggleAnnotations,
  onToggleFocus,
  labelFontSize,
  onLabelFontSizeDelta,
}: ReaderToolsPanelProps) {
  return (
    <aside className="article-tools">
      <span className="tools-title">阅读辅助</span>
      <div className="tool">
        <span>阅读设置</span>
        <span className="tool-btns">
          <button onClick={() => onFontSizeDelta(-1)} aria-label="减小字号">
            <Minus size={12} />
          </button>
          <span className="tool-val">{settings.fontSize}</span>
          <button onClick={() => onFontSizeDelta(1)} aria-label="增大字号">
            <Plus size={12} />
          </button>
        </span>
      </div>
      {labelFontSize !== undefined && onLabelFontSizeDelta && (
        <div className="tool">
          <span>标签字号</span>
          <span className="tool-btns">
            <button onClick={() => onLabelFontSizeDelta(-1)} aria-label="减小标签字号">
              <Minus size={12} />
            </button>
            <span className="tool-val">{labelFontSize}</span>
            <button onClick={() => onLabelFontSizeDelta(1)} aria-label="增大标签字号">
              <Plus size={12} />
            </button>
          </span>
        </div>
      )}
      <div className="tool">
        <span>正文字体</span>
        <MenuSelect
          value={settings.fontFamily}
          options={FONT_FAMILIES.map((f) => ({ key: f.key, label: f.label }))}
          onChange={(key) => onFontFamily(key as ReaderSettings['fontFamily'])}
          ariaLabel="正文字体"
        />
      </div>
      <div className="tool">
        <span>阅读主题</span>
        <button onClick={onCycleTheme}>
          {THEMES.find((t) => t.name === activeTheme)?.label ?? '跟随页面'}　↻
        </button>
      </div>
      <div className="tool">
        <span>文章操作</span>
        <button className={favorite ? 'active' : ''} onClick={onToggleFavorite}>
          <Bookmark size={12} style={{ verticalAlign: -2 }} /> {favorite ? '已收藏' : '收藏'}
        </button>
      </div>
      <div className="tool">
        <span>显示标注</span>
        <button className={annotationsVisible ? 'active' : ''} onClick={onToggleAnnotations}>
          {annotationsVisible ? 'ON' : 'OFF'}
        </button>
      </div>
      <div className="tool">
        <span>段落聚焦</span>
        <button className={settings.focusMode ? 'active' : ''} onClick={onToggleFocus}>
          {settings.focusMode ? 'ON' : 'OFF'}
        </button>
      </div>
    </aside>
  )
}
