import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemeName } from '../types'

interface ThemeState {
  /** 用户选择的基础主题 */
  theme: ThemeName
  /** 跟随系统：系统进入深色模式时自动使用夜读绿 */
  autoDark: boolean
  setTheme: (theme: ThemeName) => void
  setAutoDark: (v: boolean) => void
}

export const THEMES: { name: ThemeName; label: string; desc: string }[] = [
  { name: 'paper', label: '暖纸', desc: '温暖亲近，适合长时间精读' },
  { name: 'blue', label: '冷蓝', desc: '冷静清晰，知识工作台气质' },
  { name: 'night', label: '夜读绿', desc: '深色低噪，沉浸专注' },
  { name: 'violet', label: '柔紫', desc: '柔和文艺，强调收藏与摘录' },
  { name: 'graphite', label: '墨夜', desc: '石墨黑底，荧光点睛（2026 新方向）' },
]

/** 解析生效主题：autoDark 开启且系统为深色时，强制使用夜读绿 */
export function resolveTheme(theme: ThemeName, autoDark: boolean, prefersDark: boolean): ThemeName {
  return autoDark && prefersDark ? 'night' : theme
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'paper',
      autoDark: false,
      setTheme: (theme) => set({ theme }),
      setAutoDark: (autoDark) => set({ autoDark }),
    }),
    { name: 'readbook:theme' },
  ),
)
