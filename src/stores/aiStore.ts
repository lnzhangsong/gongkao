import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { idbStorage } from '../lib/idbStorage'

/**
 * AI 服务配置（BYOK，决策 A5）：
 * - 用户在设置页自填 OpenAI 兼容接口（baseUrl / apiKey / model）
 * - apiKey 只存本地 IndexedDB，请求时经 /api/ai 服务端纯转发，服务端不落任何数据
 * - 云同步时 apiKey 用「同步口令」加密后才上行（见 lib/secretBox.ts）；口令只存本机，
 *   未设口令则 key 不同步（云端只留 baseUrl/model）
 */
export interface AiSettings {
  /** OpenAI 兼容根地址，如 https://api.deepseek.com（客户端拼 /chat/completions） */
  baseUrl: string
  apiKey: string
  model: string
}

interface AiState {
  settings: AiSettings
  /** 云同步口令：仅本机保存；用于加解密上云的 apiKey。空字符串 = 不同步 key */
  syncPassphrase: string
  setAiSettings: (patch: Partial<AiSettings>) => void
  setSyncPassphrase: (value: string) => void
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
}

export function isAiConfigured(s: AiSettings): boolean {
  return Boolean(s.apiKey.trim() && s.baseUrl.trim() && s.model.trim())
}

export const useAiStore = create<AiState>()(
  persist(
    (set) => ({
      settings: DEFAULT_AI_SETTINGS,
      syncPassphrase: '',
      setAiSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setSyncPassphrase: (value) => set({ syncPassphrase: value }),
    }),
    {
      name: 'readbook:ai',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ settings: s.settings, syncPassphrase: s.syncPassphrase }),
    },
  ),
)
