import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { HomePage } from './pages/HomePage'
/* 路由代码分割：非首屏页面按需加载（首页保持静态，保证首屏不被 chunk 拖慢） */
const LibraryPage = lazy(() => import('./pages/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const ReadingPage = lazy(() => import('./pages/ReadingPage').then((m) => ({ default: m.ReadingPage })))
const NotesPage = lazy(() => import('./pages/NotesPage').then((m) => ({ default: m.NotesPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })))
const AdminEditPage = lazy(() => import('./pages/AdminEditPage').then((m) => ({ default: m.AdminEditPage })))
const ExamPreviewPage = lazy(() => import('./pages/ExamPreviewPage'))
import { useThemeStore, resolveTheme } from './stores/themeStore'
import { useArticleStore } from './stores/articleStore'
import { useReaderStore } from './stores/readerStore'
import { usePrefersDark } from './lib/prefersDark'
import { LoadingScreen } from './components/LoadingScreen'

const LOADING_MIN_MS = 1400
/** 收尾阶段：进度冲到 100% 后的停留时长 */
const LOADING_FINISH_MS = 450

/** 路由切换时回到页顶：SPA 不会自动重置滚动位置，浏览器会把上次的滚动带进新页面。
 *  阅读页不受影响——它在文章数据就绪后自行恢复上次阅读位置（晚于本组件执行） */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function App() {
  const theme = useThemeStore((s) => s.theme)
  const autoDark = useThemeStore((s) => s.autoDark)
  const prefersDark = usePrefersDark()
  /* 生效主题：autoDark 开启且系统深色时 → 夜读绿 */
  const effectiveTheme = resolveTheme(theme, autoDark, prefersDark)
  const reducedMotion = useReaderStore((s) => s.settings.reducedMotion)
  const apiReady = useArticleStore((s) => s._apiReady)
  const [minElapsed, setMinElapsed] = useState(false)
  /** loading 阶段：loading → finishing（冲 100%）→ done（移除） */
  const [phase, setPhase] = useState<'loading' | 'finishing' | 'done'>('loading')
  const mountAtRef = useRef(0)

  /* 主题应用到 html 根节点（含自动夜读解析） */
  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme
  }, [effectiveTheme])

  /* 减少动效 */
  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', reducedMotion)
  }, [reducedMotion])

  /* 滚动位置统一由 ScrollToTop 管理，禁用浏览器原生恢复（前进/后退不再跳回旧位置） */
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  }, [])

  /* 启动时从 API 加载文章列表（meta，不含正文） */
  useEffect(() => {
    mountAtRef.current = Date.now()
    void useArticleStore.getState().hydrate()
    // 首屏动画最短展示时长：即使 API 秒回，也让 loading 完整呈现
    const t = window.setTimeout(() => setMinElapsed(true), LOADING_MIN_MS)
    return () => window.clearTimeout(t)
  }, [])

  /* 阶段流转：数据就绪且最短时长已到 → 进入收尾（进度冲 100%）→ 停留后移除 */
  useEffect(() => {
    if (phase === 'loading' && apiReady && minElapsed) {
      setPhase('finishing')
    }
  }, [phase, apiReady, minElapsed])

  /* 收尾：进入 finishing 后停留 LOADING_FINISH_MS 再移除 */
  useEffect(() => {
    if (phase !== 'finishing') return
    const t = window.setTimeout(() => setPhase('done'), LOADING_FINISH_MS)
    return () => window.clearTimeout(t)
  }, [phase])

  // 首次访问：显示全屏 loading（数据就绪 + 最短时长 + 收尾完成后才切走）
  if (phase !== 'done') {
    return <LoadingScreen finishing={phase === 'finishing'} hint="正在加载文章库…" />
  }

  return (
    <BrowserRouter>
      {/* 浏览器原生的 popstate 滚动恢复与 SPA 异步渲染不合拍，统一由 ScrollToTop 接管 */}
      <ScrollToTop />
      {/* chunk 加载间隙不渲染任何内容（页面级骨架已由各页面/启动 loading 覆盖） */}
      <Suspense fallback={null}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/reading/:articleId" element={<ReadingPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/new" element={<AdminEditPage />} />
            {/* 申论真题预览（临时路由，未入导航） */}
            <Route path="/exams" element={<ExamPreviewPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
