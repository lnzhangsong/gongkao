import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { idbStorage } from '../lib/idbStorage'

/**
 * AI 服务配置（BYOK，决策 A5）：
 * - 第一版用户在设置页自填 OpenAI 兼容接口（baseUrl / apiKey / model）
 * - key 只存本地 IndexedDB，请求时经 /api/ai 服务端纯转发，服务端不落任何数据
 */
export interface AiSettings {
  /** OpenAI 兼容根地址，如 https://api.deepseek.com（客户端拼 /chat/completions） */
  baseUrl: string
  apiKey: string
  model: string
}

interface AiState {
  settings: AiSettings
  setAiSettings: (patch: Partial<AiSettings>) => void
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
      setAiSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    }),
    {
      name: 'readbook:ai',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ settings: s.settings }),
    },
  ),
)
