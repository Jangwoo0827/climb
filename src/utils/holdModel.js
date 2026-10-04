// 홀드 종류 분류 모델(public/models/holds)을 브라우저에서 돌린다.
// 사진에서 찾은 홀드를 하나씩 정사각형으로 잘라 224x224로 맞춘 뒤 분류한다(학습 데이터를 만든 방식과 같게).
// 두 형식을 지원: metadata.format === 'onnx' 이면 PyTorch에서 내보낸 ONNX(onnxruntime-web, ImageNet 정규화),
// 아니면 Teachable Machine(TF.js, -1~1 정규화). Teachable Machine baseline은 models/holds_tm 에 보존.
import * as tf from '@tensorflow/tfjs'

const BASE = `${import.meta.env.BASE_URL}models/holds/`
let loading = null

// 모델과 클래스 이름을 한 번만 불러옴. 모델 파일이 없으면 null
export function loadHoldModel() {
  if (!loading) {
    loading = (async () => {
      try {
        const meta = await (await fetch(`${BASE}metadata.json`)).json()
        if (meta.format === 'onnx') {
          const ort = await import('onnxruntime-web/wasm')
          // wasm 런타임 파일은 Vite가 앱에 같이 넣음(오프라인·Capacitor에서도 동작)
          const [{ default: wasm }, { default: mjs }] = await Promise.all([
            import('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url'),
            import('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url'),
          ])
          ort.env.wasm.wasmPaths = { wasm, mjs }
          ort.env.wasm.numThreads = 1
          const session = await ort.InferenceSession.create(`${BASE}model.onnx`)
          return { ort, session, labels: meta.labels, size: meta.imageSize ?? 224, crop: meta.crop ?? 'tight', mean: meta.mean, std: meta.std }
        }
        const model = await tf.loadLayersModel(`${BASE}model.json`)
        // crop: 학습 사진을 자른 방식. 'tight' = 홀드 상자만 잘라 회색 바탕, 그 외(예전 모델) = 상자를 정사각형으로 넓혀 30% 여유
        return { model, labels: meta.labels, size: meta.imageSize ?? 224, crop: meta.crop ?? 'loose' }
      } catch (e) {
        console.warn('홀드 분류 모델을 불러오지 못함', e)
        return null
      }
    })()
  }
  return loading
}

// 캔버스(크기 size x size)를 모델 입력으로: Teachable Machine과 같게 픽셀을 -1~1로
function toInput(canvases, size) {
  return tf.tidy(() =>
    tf.stack(canvases.map((c) => tf.browser.fromPixels(c).toFloat().div(127.5).sub(1))).reshape([canvases.length, size, size, 3]),
  )
}

// 이미 잘라 둔 이미지(정사각형)들을 분류. 반환: [{ label, prob }]
export async function classifyImages(images) {
  const m = await loadHoldModel()
  if (!m || !images.length) return []
  const canvases = images.map((im) => {
    const c = document.createElement('canvas')
    c.width = c.height = m.size
    const w = im.naturalWidth ?? im.width
    const h = im.naturalHeight ?? im.height
    const side = Math.min(w, h)
    c.getContext('2d').drawImage(im, (w - side) / 2, (h - side) / 2, side, side, 0, 0, m.size, m.size)
    return c
  })
  return predict(m, canvases)
}

// 한 장씩 판별함: Teachable Machine 모델은 여러 장을 한 번에 넣으면 사진끼리 섞인 결과가 나옴
// 홀드 하나 분류할 때마다 화면(애니메이션·터치)에 차례를 넘겨, 홀드가 많아도 앱이 멈추지 않게 함
const yieldToUi = () => new Promise((r) => setTimeout(r, 0))

async function predict(m, canvases) {
  if (m.session) return predictOnnx(m, canvases)
  const out = []
  for (const c of canvases) {
    await yieldToUi()
    const x = toInput([c], m.size)
    const y = m.model.predict(x)
    const p = await y.data()
    x.dispose()
    y.dispose()
    let k = 0
    for (let j = 1; j < p.length; j++) if (p[j] > p[k]) k = j
    out.push({ label: m.labels[k], prob: p[k], probs: Object.fromEntries(m.labels.map((l, j) => [l, p[j]])) })
  }
  return out
}

// ONNX(PyTorch) 모델: 픽셀을 0~1로 바꾼 뒤 ImageNet 평균·표준편차로 정규화, NCHW 순서
async function predictOnnx(m, canvases) {
  const S = m.size
  const out = []
  for (const c of canvases) {
    await yieldToUi()
    const d = c.getContext('2d').getImageData(0, 0, S, S).data
    const x = new Float32Array(3 * S * S)
    for (let i = 0; i < S * S; i++) for (let ch = 0; ch < 3; ch++) x[ch * S * S + i] = (d[i * 4 + ch] / 255 - m.mean[ch]) / m.std[ch]
    const res = await m.session.run({ [m.session.inputNames[0]]: new m.ort.Tensor('float32', x, [1, 3, S, S]) })
    const logits = res[m.session.outputNames[0]].data
    const mx = Math.max(...logits)
    const e = Array.from(logits, (v) => Math.exp(v - mx))
    const z = e.reduce((a, b) => a + b, 0)
    const p = e.map((v) => v / z)
    let k = 0
    for (let j = 1; j < p.length; j++) if (p[j] > p[k]) k = j
    out.push({ label: m.labels[k], prob: p[k], probs: Object.fromEntries(m.labels.map((l, j) => [l, p[j]])) })
  }
  return out
}

// 사진(img 요소)에서 홀드들을 잘라 분류. holds: {x, y, size}(0~1 정규화, size는 사진 대비 면적 비율)
// 반환: holds와 같은 순서의 [{ label, prob }] (모델이 없으면 빈 배열)
export async function classifyHolds(img, holds) {
  const m = await loadHoldModel()
  if (!m || !holds.length) return []
  const W = img.naturalWidth
  const H = img.naturalHeight
  const canvases = holds.map((h) => {
    // 학습 데이터와 같게: 홀드 상자(여유 5%)만 잘라 비율을 유지한 채 회색 바탕 가운데에 놓음(옆 홀드가 섞이지 않게)
    if (m.crop !== 'tight') {
      // 예전 방식(넓게 자름)으로 학습한 모델: 정사각형으로 넓혀 자름
      const side = Math.max(24, Math.sqrt(h.size * W * H) * 1.3 * 1.3)
      const c = document.createElement('canvas')
      c.width = c.height = m.size
      const g = c.getContext('2d')
      g.fillStyle = '#808080'
      g.fillRect(0, 0, m.size, m.size)
      g.drawImage(img, h.x * W - side / 2, h.y * H - side / 2, side, side, 0, 0, m.size, m.size)
      return c
    }
    let bw
    let bh
    let cx = h.x * W
    let cy = h.y * H
    if (h.box) {
      bw = (h.box.x1 - h.box.x0) * W
      bh = (h.box.y1 - h.box.y0) * H
      cx = ((h.box.x0 + h.box.x1) / 2) * W
      cy = ((h.box.y0 + h.box.y1) / 2) * H
    } else {
      bw = bh = Math.sqrt(h.size * W * H) * 1.15 // 상자가 없으면(직접 추가한 홀드 등) 면적으로 어림
    }
    bw = Math.max(12, bw * 1.1)
    bh = Math.max(12, bh * 1.1)
    const k = m.size / Math.max(bw, bh)
    const c = document.createElement('canvas')
    c.width = c.height = m.size
    const g = c.getContext('2d')
    g.fillStyle = '#808080'
    g.fillRect(0, 0, m.size, m.size)
    g.drawImage(img, cx - bw / 2, cy - bh / 2, bw, bh, (m.size - bw * k) / 2, (m.size - bh * k) / 2, bw * k, bh * k)
    return c
  })
  return predict(m, canvases)
}

// 디버깅·검증용
export { tf }
