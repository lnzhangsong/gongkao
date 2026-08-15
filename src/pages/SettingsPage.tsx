import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Download, Minus, Plus, Trash2, Upload } from 'lucide-react'
import { useThemeStore, THEMES } from '../stores/themeStore'
import { useReaderStore, FONT_FAMILIES } from '../stores/readerStore'
import { useAnnotationStore } from '../stores/annotationStore'
import { useArticleStore } from '../stores/articleStore'
import { Toggle } from '../components/ui/Toggle'
import { downloadJSON } from '../lib/export'
import { parseImportData } from '../lib/import'

const SECTIONS = [
  { id: 'reading', label: '阅读偏好' },
  { id: 'display', label: '显示与主题' },
  { id: 'data', label: '数据与隐私' },
  { id: 'about', label: '关于读本' },
]

export function SettingsPage() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  const settings = useReaderStore((s) => s.settings)
  const setFontSize = useReaderStore((s) => s.setFontSize)
  const setLineHeight = useReaderStore((s) => s.setLineHeight)
  const setFontFamily = useReaderStore((s) => s.setFontFamily)
  const setReaderTheme = useReaderStore((s) => s.setReaderTheme)
  const setReducedMotion = useReaderStore((s) => s.setReducedMotion)
  const resetSettings = useReaderStore((s) => s.resetSettings)

  const setAnnotationsVisible = useAnnotationStore((s) => s.setVisible)
  const annotationsVisible = useAnnotationStore((s) => s.visible)
  const annotationCount = useAnnotationStore((s) => s.annotations.length)
  const clearAnnotations = useAnnotationStore((s) => s.clearAll)
  const importAnnotations = useAnnotationStore((s) => s.importAnnotations)

  const articles = useArticleStore((s) => s.articles)
  const progress = useArticleStore((s) => s.progress)
  const clearArticleData = useArticleStore((s) => s.clearAll)
  const importProgress = useArticleStore((s) => s.importProgress)

  const applySettings = useReaderStore((s) => s.applySettings)
  const upsertArticles = useArticleStore((s) => s.upsertArticles)

  const navigate = useNavigate()

  const [active, setActive] = useState('reading')
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  /* 导航高亮跟随滚动 */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id)
        }
      },
      { rootMargin: '-30% 0px -60% 0px' },
    )
    SECTIONS.forEach((s) => {
      const el = sectionRefs.current[s.id]
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  const scrollTo = (id: string) => {
    setActive(id)
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const exportAll = () => {
    downloadJSON(
      `readbook-data-${new Date().toISOString().slice(0, 10)}.json`,
      {
        exportedAt: new Date().toISOString(),
        theme,
        readerSettings: settings,
        articles: articles.map((a) => ({
          ...a,
          progress: progress[a.id] ?? null,
        })),
        annotations: useAnnotationStore.getState().annotations,
      },
    )
  }

  /** 导入数据（支持设置页整包导出 + 摘录页导出两种格式） */
  const importFileRef = useRef<HTMLInputElement>(null)
  const onImportFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseImportData(String(reader.result ?? ''))
      if ('error' in parsed) {
        window.alert(`导入失败：${parsed.error}`)
        return
      }
      const nAnn = parsed.annotations.length
      const nProg = Object.keys(parsed.progress ?? {}).length
      const ok = window.confirm(
        `将导入：${parsed.theme ? '主题 1 项，' : ''}${parsed.readerSettings ? '阅读设置 1 项，' : ''}${nProg} 篇文章进度，${nAnn} 条摘录。` +
          '\n阅读进度按文章合并覆盖，摘录按 id 去重合并。确定导入？',
      )
      if (!ok) return
      if (parsed.theme) setTheme(parsed.theme)
      if (parsed.readerSettings) applySettings(parsed.readerSettings)
      if (parsed.articles) upsertArticles(parsed.articles)
      if (parsed.progress) importProgress(parsed.progress)
      if (nAnn > 0) importAnnotations(parsed.annotations)
      window.alert(
        `导入完成：${parsed.articles?.length ?? 0} 篇文章、${nProg} 篇进度、${nAnn} 条摘录已合并到本地数据。`,
      )
    }
    reader.readAsText(file)
    // 允许重复选择同一文件
    if (importFileRef.current) importFileRef.current.value = ''
  }

  const clearAllData = () => {
    const ok = window.confirm(
      '确定要清空本地数据吗？将删除所有阅读进度、收藏、高亮、划线与笔记，且无法恢复。',
    )
    if (!ok) return
    clearArticleData()
    clearAnnotations()
    resetSettings()
    localStorage.removeItem('readbook:articles')
    localStorage.removeItem('readbook:annotations')
    localStorage.removeItem('readbook:reader')
    localStorage.removeItem('readbook:theme')
    window.location.reload()
  }

  const stats = {
    articles: articles.length,
    read: articles.filter((a) => progress[a.id]?.completed).length,
    favorites: articles.filter((a) => progress[a.id]?.favorite).length,
    notes: annotationCount,
  }

  return (
    <section className="settings-page page-section">
      <header className="settings-header">
        <div>
          <div className="eyebrow">PERSONAL PREFERENCES　/　SETTINGS</div>
          <h1>
            调整你的
            <br />
            <span>阅读方式。</span>
          </h1>
        </div>
        <p>让页面、字体和阅读节奏更接近你的习惯。设置会自动保存在当前设备。</p>
      </header>

      <main className="settings">
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={active === s.id ? 'active' : ''}
              onClick={() => scrollTo(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <section>
          <div className="settings-section" id="reading" ref={(el) => { sectionRefs.current.reading = el }}>
            <h2>阅读偏好</h2>
            <div className="setting-row">
              <div>
                <div className="setting-title">默认字体</div>
                <div className="setting-desc">文章正文使用的字体</div>
              </div>
              <div className="setting-control">
                <select
                  className="select"
                  value={settings.fontFamily}
                  onChange={(e) => setFontFamily(e.target.value as typeof settings.fontFamily)}
                >
                  {FONT_FAMILIES.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="setting-row">
              <div>
                <div className="setting-title">正文大小</div>
                <div className="setting-desc">适合长时间阅读的字号</div>
              </div>
              <div className="setting-control">
                <span className="font-size-ctl">
                  <button onClick={() => setFontSize(settings.fontSize - 1)} aria-label="减小字号">
                    <Minus size={12} />
                  </button>
                  <span className="value">{settings.fontSize}px</span>
                  <button onClick={() => setFontSize(settings.fontSize + 1)} aria-label="增大字号">
                    <Plus size={12} />
                  </button>
                </span>
              </div>
            </div>

            <div className="setting-row">
              <div>
                <div className="setting-title">行高</div>
                <div className="setting-desc">调节正文的行间距</div>
              </div>
              <div className="setting-control">
                <span className="line-height-ctl">
                  <button onClick={() => setLineHeight(settings.lineHeight - 0.1)}>−</button>
                  <span>{settings.lineHeight.toFixed(2)}</span>
                  <button onClick={() => setLineHeight(settings.lineHeight + 0.1)}>+</button>
                </span>
              </div>
            </div>

            <div className="setting-row">
              <div>
                <div className="setting-title">显示划线</div>
                <div className="setting-desc">在文章中显示保存的高亮与划线内容</div>
              </div>
              <div className="setting-control">
                <Toggle
                  on={annotationsVisible}
                  onChange={setAnnotationsVisible}
                  label="显示划线"
                />
              </div>
            </div>

            <div className="setting-row" style={{ borderBottom: 0 }}>
              <div>
                <div className="setting-title">恢复默认</div>
                <div className="setting-desc">将字号、行高、字体恢复为初始值</div>
              </div>
              <div className="setting-control">
                <button className="ghost" onClick={resetSettings}>
                  恢复默认
                </button>
              </div>
            </div>
          </div>

          <div className="settings-section" id="display" ref={(el) => { sectionRefs.current.display = el }}>
            <h2>显示与主题</h2>
            <div className="setting-row">
              <div>
                <div className="setting-title">页面主题</div>
                <div className="setting-desc">选择你喜欢的阅读氛围</div>
              </div>
              <div className="setting-control">
                <div className="theme-options">
                  {THEMES.map((t) => (
                    <button
                      key={t.name}
                      className={`theme-dot ${t.name}${theme === t.name ? ' active' : ''}`}
                      onClick={() => setTheme(t.name)}
                      title={`${t.label} · ${t.desc}`}
                      aria-label={`主题：${t.label}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="setting-row">
              <div>
                <div className="setting-title">阅读页主题</div>
                <div className="setting-desc">阅读正文时单独使用的主题（可覆盖页面主题）</div>
              </div>
              <div className="setting-control">
                <select
                  className="select"
                  value={settings.readerTheme}
                  onChange={(e) => setReaderTheme(e.target.value as typeof settings.readerTheme)}
                >
                  <option value="">跟随页面</option>
                  {THEMES.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="setting-row" style={{ borderBottom: 0 }}>
              <div>
                <div className="setting-title">减少动效</div>
                <div className="setting-desc">关闭页面中的过渡和动效</div>
              </div>
              <div className="setting-control">
                <Toggle on={settings.reducedMotion} onChange={setReducedMotion} label="减少动效" />
              </div>
            </div>
          </div>

          <div className="settings-section" id="data" ref={(el) => { sectionRefs.current.data = el }}>
            <h2>数据与隐私</h2>
            <div className="setting-row">
              <div>
                <div className="setting-title">导出我的数据</div>
                <div className="setting-desc">下载阅读进度、收藏、摘录与笔记（JSON）</div>
              </div>
              <div className="setting-control">
                <button className="ghost" onClick={exportAll}>
                  <Download size={12} /> 导出
                </button>
              </div>
            </div>

            <div className="setting-row">
              <div>
                <div className="setting-title">管理文章</div>
                <div className="setting-desc">录入、编辑或删除本地文章（保存在当前设备）</div>
              </div>
              <div className="setting-control">
                <button className="ghost" onClick={() => navigate('/admin')}>
                  <BookOpen size={12} /> 管理文章
                </button>
              </div>
            </div>

            <div className="setting-row">
              <div>
                <div className="setting-title">导入数据</div>
                <div className="setting-desc">恢复本应用导出的 JSON，或合并另一设备上的文章与摘录</div>
              </div>
              <div className="setting-control">
                <button className="ghost" onClick={() => importFileRef.current?.click()}>
                  <Upload size={12} /> 导入
                </button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                  onChange={(e) => onImportFile(e.target.files?.[0])}
                />
              </div>
            </div>

            <div className="setting-row danger" style={{ borderBottom: 0 }}>
              <div>
                <div className="setting-title">清空本地数据</div>
                <div className="setting-desc">删除本机全部阅读记录与摘录，不可恢复</div>
              </div>
              <div className="setting-control">
                <button className="ghost" onClick={clearAllData}>
                  <Trash2 size={12} /> 清空
                </button>
              </div>
            </div>
          </div>

          <div className="settings-section" id="about" ref={(el) => { sectionRefs.current.about = el }}>
            <h2>关于读本</h2>
            <div className="about-line" style={{ paddingBottom: 16 }}>
              <strong>读本 READBOOK</strong> v0.1.0
              <br />
              每日人民日报深度内容与申论素材的精读工作台。数据保存在当前设备浏览器中，导出后可在任意设备导入。
            </div>
            <div className="setting-row" style={{ borderBottom: 0 }}>
              <div>
                <div className="setting-title">本地数据统计</div>
                <div className="setting-desc">
                  文章 {stats.articles} 篇 · 已读完 {stats.read} 篇 · 收藏 {stats.favorites} 篇 · 摘录{' '}
                  {stats.notes} 条
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </section>
  )
}
