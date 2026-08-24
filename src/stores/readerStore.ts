import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ReaderSettings, ThemeName } from '../types'

/**
 * 阅读字体（按适合长文阅读排序）：
 * - 思源宋体 / 霞鹜文楷 / 思源黑体：Google Fonts 在线加载
 * - 仓耳今楷：需本机安装（仓耳字库下载），未安装时回退楷体
 * - 仿宋：Windows 自带 FangSong / macOS 华文仿宋
 */
export const FONT_FAMILIES: {
  key: ReaderSettings['fontFamily']
  label: string
  css: string
}[] = [
  { key: 'songti', label: '思源宋体', css: "'Noto Serif SC', 'Songti SC', 'SimSun', 'STSong', serif" },
  { key: 'jinkai', label: '仓耳今楷', css: "'仓耳今楷', 'TsangerJinKai', 'Kaiti SC', 'KaiTi', 'STKaiti', serif" },
  { key: 'kaiti', label: '霞鹜文楷', css: "'LXGW WenKai', 'Kaiti SC', 'KaiTi', 'STKaiti', serif" },
  { key: 'fangsong', label: '仿宋', css: "'FangSong', 'STFangsong', '仿宋', serif" },
  { key: 'sans', label: '思源黑体', css: "'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', sans-serif" },
  { key: 'system', label: '系统衬线', css: "Georgia, 'Songti SC', 'SimSun', 'STSong', serif" },
]

interface ReaderState {
  settings: ReaderSettings
  setFontSize: (px: number) => void
  setLineHeight: (lh: number) => void
  setFontFamily: (key: ReaderSettings['fontFamily']) => void
  setReaderTheme: (theme: ThemeName | '') => void
  setReducedMotion: (v: boolean) => void
  setShowAnnotations: (v: boolean) => void
  setFocusMode: (v: boolean) => void
  setMeasure: (v: ReaderSettings['measure']) => void
  setIndent: (v: boolean) => void
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
  focusMode: false,
  measure: 'normal',
  indent: true,
}

export const useReaderStore = create<ReaderState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      setFontSize: (px) =>
        set((s) => ({ settings: { ...s.settings, fontSize: Math.min(28, Math.max(14, px)) } })),
      setLineHeight: (lh) =>
        set((s) => ({
          settings: { ...s.settings, lineHeight: Math.min(2.4, Math.max(1.6, Math.round(lh * 100) / 100)) },
        })),
      setFontFamily: (key) => set((s) => ({ settings: { ...s.settings, fontFamily: key } })),
      setReaderTheme: (theme) => set((s) => ({ settings: { ...s.settings, readerTheme: theme } })),
      setReducedMotion: (v) => set((s) => ({ settings: { ...s.settings, reducedMotion: v } })),
      setShowAnnotations: (v) => set((s) => ({ settings: { ...s.settings, showAnnotations: v } })),
      setFocusMode: (v) => set((s) => ({ settings: { ...s.settings, focusMode: v } })),
      setMeasure: (v) => set((s) => ({ settings: { ...s.settings, measure: v } })),
      setIndent: (v) => set((s) => ({ settings: { ...s.settings, indent: v } })),
      applySettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: 'readbook:reader',
      version: 2,
      // v1：移除「黑体」选项，旧设置映射到思源宋体
      // v2：新增 focusMode / measure / indent，旧数据用默认值补齐（防止字段缺失为 undefined）
      migrate: (persisted) => {
        const p = persisted as { settings?: { fontFamily?: string } }
        if (p.settings?.fontFamily === 'heiti') {
          p.settings.fontFamily = 'songti'
        }
        p.settings = { ...DEFAULT_SETTINGS, ...p.settings }
        return p as never
      },
    },
  ),
)

export function fontFamilyCss(key: ReaderSettings['fontFamily']): string {
  return FONT_FAMILIES.find((f) => f.key === key)?.css ?? FONT_FAMILIES[0].css
}
