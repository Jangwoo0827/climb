import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 화면에 보여줄 버전: 커밋 해시(앞 7자리) + 빌드 시각(한국 시간)
const sha = (process.env.GITHUB_SHA || (() => {
  try {
    return execSync('git rev-parse HEAD').toString().trim()
  } catch {
    return 'dev'
  }
})()).slice(0, 7)
const built = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(5, 16)

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/climb/' : '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(`${sha} · ${built}`),
  },
  server: {
    port: 5175,
  },
})
