import { BookOpenCheck, Bookmark, Minus, Plus } from 'lucide-react'
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
  onToggleTermBox: () => void
  /** 申论拆解 / 范文精读：学习状态与素材计数用于展示，点击打开面板（真题预览页不接入） */
  shenlunStatus?: string
  shenlunMaterialCount?: number
  onOpenShenlun?: () => void
  /** 拆解上屏：把拆解成果（全篇卡 + 每段大意 + 心得）内嵌显示在正文（有拆解数据才出现该行） */
  studyInline?: boolean
  hasStudyData?: boolean
  onToggleStudyInline?: () => void
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
  onToggleTermBox,
  shenlunStatus,
  shenlunMaterialCount,
  onOpenShenlun,
  studyInline,
  hasStudyData,
  onToggleStudyInline,
  labelFontSize,
  onLabelFontSizeDelta,
}: ReaderToolsPanelProps) {
  return (
    <aside className="article-tools">
      <span className="tools-title">阅读辅助</span>
      <div className="tool">
        <span>阅读设置</span>
        <span className="tool-btns">
          <button onClick={() => onFontSizeDelta(-1)} aria-label="减小字号" disabled={settings.fontSize <= 14}>
            <Minus size={12} />
          </button>
          <span className="tool-val">{settings.fontSize}</span>
          <button onClick={() => onFontSizeDelta(1)} aria-label="增大字号" disabled={settings.fontSize >= 28}>
            <Plus size={12} />
          </button>
        </span>
      </div>
      {labelFontSize !== undefined && onLabelFontSizeDelta && (
        <div className="tool">
          <span>标签字号</span>
          <span className="tool-btns">
            <button onClick={() => onLabelFontSizeDelta(-1)} aria-label="减小标签字号" disabled={labelFontSize <= 11}>
              <Minus size={12} />
            </button>
            <span className="tool-val">{labelFontSize}</span>
            <button onClick={() => onLabelFontSizeDelta(1)} aria-label="增大标签字号" disabled={labelFontSize >= 18}>
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
        <span>申论拆解</span>
        <button onClick={onOpenShenlun}>
          <BookOpenCheck size={12} style={{ verticalAlign: -2 }} />
          {shenlunStatus ?? '打开'}
          {shenlunMaterialCount ? ` · ${shenlunMaterialCount}` : ''}
        </button>
      </div>
      {hasStudyData && onToggleStudyInline && (
        <div className="tool">
          <span>拆解上屏</span>
          <button className={studyInline ? 'active' : ''} onClick={onToggleStudyInline}>
            {studyInline ? 'ON' : 'OFF'}
          </button>
        </div>
      )}
      <div className="tool">
        <span>显示标注</span>
        <button className={annotationsVisible ? 'active' : ''} onClick={onToggleAnnotations}>
          {annotationsVisible ? 'ON' : 'OFF'}
        </button>
      </div>
      <div className="tool">
        <span>规范词框</span>
        <button className={settings.termBox ? 'active' : ''} onClick={onToggleTermBox}>
          {settings.termBox ? 'ON' : 'OFF'}
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
