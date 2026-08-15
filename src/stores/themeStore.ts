import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemeName } from '../types'

interface ThemeState {
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
}

export const THEMES: { name: ThemeName; label: string; desc: string }[] = [
  { name: 'paper', label: '暖纸', desc: '温暖亲近，适合长时间精读' },
  { name: 'blue', label: '冷蓝', desc: '冷静清晰，知识工作台气质' },
  { name: 'night', label: '夜读绿', desc: '深色低噪，沉浸专注' },
  { name: 'violet', label: '柔紫', desc: '柔和文艺，强调收藏与摘录' },
]

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'paper',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'readbook:theme' },
  ),
)
