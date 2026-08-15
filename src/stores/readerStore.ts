import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ReaderSettings, ThemeName } from '../types'

export const FONT_FAMILIES: {
  key: ReaderSettings['fontFamily']
  label: string
  css: string
}[] = [
  { key: 'songti', label: '思源宋体', css: "'Noto Serif SC', 'Songti SC', 'SimSun', 'STSong', serif" },
  { key: 'system', label: '系统衬线', css: "Georgia, 'Songti SC', 'SimSun', 'STSong', serif" },
  { key: 'kaiti', label: '霞鹜文楷', css: "'LXGW WenKai', 'Kaiti SC', 'KaiTi', 'STKaiti', serif" },
]

interface ReaderState {
  settings: ReaderSettings
  setFontSize: (px: number) => void
  setLineHeight: (lh: number) => void
  setFontFamily: (key: ReaderSettings['fontFamily']) => void
  setReaderTheme: (theme: ThemeName | '') => void
  setReducedMotion: (v: boolean) => void
  setShowAnnotations: (v: boolean) => void
  /** 应用导入的阅读器设置（缺省字段保持默认） */
  applySettings: (patch: Partial<ReaderSettings>) => void
  resetSettings: () => void
}

const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 17,
  lineHeight: 2.15,
  fontFamily: 'songti',
  readerTheme: '',
  reducedMotion: false,
  showAnnotations: true,
}

export const useReaderStore = create<ReaderState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      setFontSize: (px) =>
        set((s) => ({ settings: { ...s.settings, fontSize: Math.min(22, Math.max(14, px)) } })),
      setLineHeight: (lh) =>
        set((s) => ({
          settings: { ...s.settings, lineHeight: Math.min(2.4, Math.max(1.6, Math.round(lh * 100) / 100)) },
        })),
      setFontFamily: (key) => set((s) => ({ settings: { ...s.settings, fontFamily: key } })),
      setReaderTheme: (theme) => set((s) => ({ settings: { ...s.settings, readerTheme: theme } })),
      setReducedMotion: (v) => set((s) => ({ settings: { ...s.settings, reducedMotion: v } })),
      setShowAnnotations: (v) => set((s) => ({ settings: { ...s.settings, showAnnotations: v } })),
      applySettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    { name: 'readbook:reader' },
  ),
)

export function fontFamilyCss(key: ReaderSettings['fontFamily']): string {
  return FONT_FAMILIES.find((f) => f.key === key)?.css ?? FONT_FAMILIES[0].css
}
