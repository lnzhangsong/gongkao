import { create } from 'zustand'
import type { ReaderSettings } from '../types'

type FontKey = ReaderSettings['fontFamily']

/* ---------- 进度条状态 ---------- */
interface FontLoadState {
  loading: boolean
  progress: number // 0~1
  label: string
  /** 最近一次加载失败（CDN 不可达等）：FontLoadBar 展示一次性提示后自动清除 */
  failed: boolean
}

export const useFontLoad = create<FontLoadState>(() => ({ loading: false, progress: 0, label: '', failed: false }))

/** 弱网兜底：document.fonts.load 最长等待，避免骨架屏卡在「等字形」 */
const FONTS_LOAD_TIMEOUT_MS = 2500

function withTimeout<T>(p: Promise<T>, ms = FONTS_LOAD_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('font load timeout')), ms)),
  ])
}

/* ---------- 每种字体需要的资源 ----------
 * css：jsDelivr @fontsource 样式表（含 unicode-range 子集，浏览器只取用到的字形）
 * family：字体家族名，用于 document.fonts 确认真正就绪
 * 自托管字体（仓耳今楷/霞鹜文楷）的 @font-face 已在 tokens.css，按需注入的是实际 woff2 的触发
 */
const CDN = 'https://cdn.jsdelivr.net/npm/@fontsource'

interface FontSource {
  css: string[]
  family?: string
}

const SOURCES: Record<FontKey, FontSource> = {
  songti: {
    css: [
      'noto-serif-sc@5.3.0/400.css',
      'noto-serif-sc@5.3.0/500.css',
      'noto-serif-sc@5.3.0/600.css',
      'noto-serif-sc@5.3.0/700.css',
    ],
    family: 'Noto Serif SC',
  },
  jinkai: { css: [], family: '仓耳今楷' },
  kaiti: { css: [], family: 'LXGW WenKai' },
  fangsong: { css: [] }, // 系统字体，无需下载
  sans: {
    css: [
      'noto-sans-sc@5.3.0/400.css',
      'noto-sans-sc@5.3.0/500.css',
      'noto-sans-sc@5.3.0/700.css',
      'noto-sans-sc@5.3.0/800.css',
    ],
    family: 'Noto Sans SC',
  },
  system: { css: [] }, // 系统字体，无需下载
}

const LABELS: Record<FontKey, string> = {
  songti: '思源宋体',
  jinkai: '仓耳今楷',
  kaiti: '霞鹜文楷',
  fangsong: '仿宋',
  sans: '思源黑体',
  system: '系统衬线',
}

const loadedKeys = new Set<FontKey>()
const injected = new Set<string>()
const inflight = new Map<FontKey, Promise<void>>()
let reqId = 0

/** 注入一个 @fontsource CSS；已注入过则直接返回（幂等） */
function injectCSS(href: string): Promise<void> {
  return new Promise((resolve) => {
    if (injected.has(href)) {
      resolve()
      return
    }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.onload = () => {
      injected.add(href)
      resolve()
    }
    // 加载失败不阻塞：回退到系统字体栈
    link.onerror = () => {
      injected.add(href)
      resolve()
    }
    document.head.appendChild(link)
  })
}

const SAMPLE = '读书明理开卷有益持之以恒温故知新'

/** 加载失败一次性提示（CDN 挂掉时用户只会看到「字体不对」，至少给个解释） */
function markFontFailed() {
  useFontLoad.setState({ failed: true })
  setTimeout(() => useFontLoad.setState({ failed: false }), 3000)
}

async function doLoad(key: FontKey): Promise<void> {
  const src = SOURCES[key]
  /* 未知字体 key（损坏/残缺的本地设置）：直接视为已加载，回退系统字体栈 */
  if (!src) {
    loadedKeys.add(key)
    return
  }
  const steps = src.css.length + (src.family ? 1 : 0)
  if (steps === 0) {
    loadedKeys.add(key)
    return
  }
  const id = ++reqId
  useFontLoad.setState({ loading: true, progress: 0.02, label: LABELS[key] })
  let done = 0
  const bump = () => {
    done++
    if (id === reqId) useFontLoad.setState({ progress: Math.min(0.94, (done / steps) * 0.94) })
  }
  try {
    for (const c of src.css) {
      await injectCSS(`${CDN}/${c}`)
      bump()
    }
    if (src.family) {
      try {
        // 触发实际字形下载并等待就绪（CSS 注入 ≠ 字体可用），弱网 2.5s 超时兜底
        await withTimeout(document.fonts.load(`16px "${src.family}"`, SAMPLE))
        if (!document.fonts.check(`16px "${src.family}"`, SAMPLE)) {
          markFontFailed()
        }
      } catch {
        /* 忽略：回退系统字体 */
      }
      bump()
    }
    loadedKeys.add(key)
  } finally {
    if (id === reqId) {
      useFontLoad.setState({ progress: 1 })
      setTimeout(() => {
        if (id === reqId) useFontLoad.setState({ loading: false, progress: 0 })
      }, 400)
    }
  }
}

/**
 * 装饰性标题字体（马善政楷书）：首页/文库大标题用。
 * 自托管子集（public/fonts/ma-shan-zheng.woff2，仅标题用字），@font-face 在 tokens.css；
 * 这里只需触发实际字形下载（@font-face 引用即懒加载）。
 */
const DISPLAY_SOURCE = { family: 'Ma Shan Zheng', label: '马善政楷书' }

let displayLoaded = false
let displayInflight: Promise<void> | null = null

export function loadDisplayFont(): Promise<void> {
  if (displayLoaded) return Promise.resolve()
  if (displayInflight) return displayInflight
  const id = ++reqId
  useFontLoad.setState({ loading: true, progress: 0.1, label: DISPLAY_SOURCE.label })
  displayInflight = (async () => {
    try {
      // 触发 woff2 实际下载（@font-face 已在 tokens.css），弱网超时兜底
      try {
        await withTimeout(document.fonts.load('16px "' + DISPLAY_SOURCE.family + '"', '读懂时代写好答案'))
      } catch {
        markFontFailed()
      }
      displayLoaded = true
    } finally {
      if (id === reqId) {
        useFontLoad.setState({ progress: 1 })
        setTimeout(() => {
          if (id === reqId) useFontLoad.setState({ loading: false, progress: 0 })
        }, 400)
      }
    }
  })()
  return displayInflight
}

/** 按需加载阅读字体：已加载/系统字体立即完成，同一字体并发调用共享同一任务 */
export function loadFontFamily(key: FontKey): Promise<void> {
  if (loadedKeys.has(key)) return Promise.resolve()
  const prev = inflight.get(key)
  if (prev) return prev
  const p = doLoad(key)
  inflight.set(key, p)
  void p.finally(() => inflight.delete(key))
  return p
}
