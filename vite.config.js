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
// 개발 서버 전용 Roboflow 중계: 브라우저는 /api/rf-holds 로 사진만 보내고, API 키(환경변수 ROBOFLOW_API_KEY)는 서버에서만 붙임
// 워크플로 설정은 src/utils/rfDetect.js 와 같게 유지
const RF_URL = 'https://serverless.roboflow.com/-wodfh/workflows/climbing-hold-detection-g4vwg'
const rfProxy = () => ({
  name: 'roboflow-proxy',
  configureServer(server) {
    server.middlewares.use('/api/rf-holds', async (req, res) => {
      const key = process.env.ROBOFLOW_API_KEY
      if (req.method !== 'POST' || !key) {
        res.statusCode = key ? 405 : 503
        return res.end(JSON.stringify({ error: key ? 'POST only' : 'ROBOFLOW_API_KEY not set' }))
      }
      const chunks = []
      for await (const c of req) chunks.push(c)
      try {
        const r = await fetch(RF_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: Buffer.concat(chunks) })
        res.statusCode = r.status
        res.setHeader('Content-Type', 'application/json')
        res.end(await r.text())
      } catch (e) {
        res.statusCode = 502
        res.end(JSON.stringify({ error: String(e) }))
      }
    })
  },
})
const built = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(5, 16)

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/climb/' : '/',
  plugins: [react(), rfProxy()],
  define: {
    __APP_VERSION__: JSON.stringify(`${sha} · ${built}`),
  },
  server: {
    port: 5175,
  },
})
