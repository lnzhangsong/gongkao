import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'
import { ReadingPage } from './pages/ReadingPage'
import { NotesPage } from './pages/NotesPage'
import { SettingsPage } from './pages/SettingsPage'
import { AdminPage } from './pages/AdminPage'
import { AdminEditPage } from './pages/AdminEditPage'
import { useThemeStore } from './stores/themeStore'
import { useArticleStore } from './stores/articleStore'
import { useReaderStore } from './stores/readerStore'

function App() {
  const theme = useThemeStore((s) => s.theme)
  const reducedMotion = useReaderStore((s) => s.settings.reducedMotion)

  /* 主题应用到 html 根节点 */
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  /* 减少动效 */
  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', reducedMotion)
  }, [reducedMotion])

  /* 启动时从 API 加载文章列表（meta，不含正文） */
  useEffect(() => {
    void useArticleStore.getState().hydrate()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/reading/:articleId" element={<ReadingPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/new" element={<AdminEditPage />} />
          <Route path="/admin/edit/:id" element={<AdminEditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
