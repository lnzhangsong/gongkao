import { useCallback } from 'react'
import { useReaderStore } from '../stores/readerStore'
import { useThemeStore, resolveTheme, THEMES } from '../stores/themeStore'
import { usePrefersDark } from '../lib/prefersDark'

/**
 * 阅读类页面共用的主题轮换：返回 [生效主题, 轮换函数]。
 * 阅读页切换主题 = 全局切换（清除阅读页单独覆盖，整体生效）。
 */
export function useCycleTheme(): [string, () => void] {
  const settings = useReaderStore((s) => s.settings)
  const setReaderTheme = useReaderStore((s) => s.setReaderTheme)
  const theme = useThemeStore((s) => s.theme)
  const autoDark = useThemeStore((s) => s.autoDark)
  const setTheme = useThemeStore((s) => s.setTheme)
  const prefersDark = usePrefersDark()

  const activeTheme = settings.readerTheme || resolveTheme(theme, autoDark, prefersDark)
  const cycle = useCallback(() => {
    const idx = THEMES.findIndex((t) => t.name === activeTheme)
    setTheme(THEMES[(idx + 1) % THEMES.length].name)
    setReaderTheme('')
  }, [activeTheme, setTheme, setReaderTheme])
  return [activeTheme, cycle]
}
