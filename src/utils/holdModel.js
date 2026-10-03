// Teachable Machine으로 학습한 홀드 종류 분류 모델(public/models/holds)을 브라우저에서 돌린다.
// 사진에서 찾은 홀드를 하나씩 정사각형으로 잘라 224x224로 맞춘 뒤 분류한다(학습 데이터를 만든 방식과 같게).
import * as tf from '@tensorflow/tfjs'

const BASE = `${import.meta.env.BASE_URL}models/holds/`
let loading = null

// 모델과 클래스 이름을 한 번만 불러옴. 모델 파일이 없으면 null
export function loadHoldModel() {
  if (!loading) {
    loading = (async () => {
      try {
        const meta = await (await fetch(`${BASE}metadata.json`)).json()
        const model = await tf.loadLayersModel(`${BASE}model.json`)
        return { model, labels: meta.labels, size: meta.imageSize ?? 224 }
      } catch {
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
async function predict(m, canvases) {
  const out = []
  for (const c of canvases) {
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

// 사진(img 요소)에서 홀드들을 잘라 분류. holds: {x, y, size}(0~1 정규화, size는 사진 대비 면적 비율)
// 반환: holds와 같은 순서의 [{ label, prob }] (모델이 없으면 빈 배열)
export async function classifyHolds(img, holds) {
  const m = await loadHoldModel()
  if (!m || !holds.length) return []
  const W = img.naturalWidth
  const H = img.naturalHeight
  const canvases = holds.map((h) => {
    // 홀드 면적으로 크기를 어림하고 15%씩 여유를 둔 정사각형(학습 데이터와 같은 방식)
    const side = Math.max(24, Math.sqrt(h.size * W * H) * 1.3 * 1.3)
    const c = document.createElement('canvas')
    c.width = c.height = m.size
    const g = c.getContext('2d')
    g.fillStyle = '#808080'
    g.fillRect(0, 0, m.size, m.size)
    g.drawImage(img, h.x * W - side / 2, h.y * H - side / 2, side, side, 0, 0, m.size, m.size)
    return c
  })
  return predict(m, canvases)
}

// 디버깅·검증용
export { tf }
