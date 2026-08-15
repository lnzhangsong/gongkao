import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    // 文章数据（517 篇年编）随主包加载，体积预期较大
    chunkSizeWarningLimit: 3000,
  },
})
