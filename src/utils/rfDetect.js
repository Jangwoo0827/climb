// Roboflow Cloud 워크플로로 사진 속 홀드 위치(상자)를 찾는다. 홀드 위치만: 그립 종류·색은 판별하지 않음
// (종류는 holdModel.js, 루트 색은 detect.js의 색 판정으로 따로 정함)
// API 키는 앱 코드에 넣지 않음:
//  1) 개발 서버(npm run dev): /api/rf-holds 중계가 서버 환경변수 ROBOFLOW_API_KEY 로 호출
//  2) 그 밖(GitHub Pages, 폰 앱): 사용자가 「내 몸」 탭에서 넣은 키(이 기기 localStorage에만 저장)로 직접 호출
const RF_URL = 'https://serverless.roboflow.com/-wodfh/workflows/climbing-hold-detection-g4vwg'
const PARAMS = { confidence: 0.4, iou_threshold: 0.3, class_agnostic_nms: false, max_detections: 1000 }
const KEY_STORE = 'rf.apiKey'
const MAX_SIDE = 1280 // 보내는 사진의 긴 변(전송량·속도)

export const getRfKey = () => {
  try {
    return localStorage.getItem(KEY_STORE) || ''
  } catch {
    return ''
  }
}
export const setRfKey = (k) => {
  try {
    if (k) localStorage.setItem(KEY_STORE, k)
    else localStorage.removeItem(KEY_STORE)
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}

// 결과 안에서 x, y, width, height, confidence 가 있는 검출 항목을 모두 찾음(워크플로 출력 구조에 덜 의존)
function findPredictions(o, out = []) {
  if (Array.isArray(o)) o.forEach((v) => findPredictions(v, out))
  else if (o && typeof o === 'object') {
    if (['x', 'y', 'width', 'height', 'confidence'].every((k) => k in o)) out.push(o)
    else Object.values(o).forEach((v) => findPredictions(v, out))
  }
  return out
}

// img: <img> 요소. 반환: 홀드 [{x, y, size, elong, angle, box, conf}] (0~1 정규화, detect.js 와 같은 형식). 못 쓰면 null
export async function detectHoldsCloud(img) {
  const W = img.naturalWidth
  const H = img.naturalHeight
  const k = Math.min(1, MAX_SIDE / Math.max(W, H))
  const c = document.createElement('canvas')
  c.width = Math.round(W * k)
  c.height = Math.round(H * k)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  const b64 = c.toDataURL('image/jpeg', 0.9).split(',')[1]
  const body = JSON.stringify({ use_cache: true, enable_profiling: false, inputs: { image: { type: 'base64', value: b64 }, ...PARAMS } })
  const key = getRfKey()
  let res = null
  try {
    if (import.meta.env.DEV && !key) res = await fetch('/api/rf-holds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    else if (key) res = await fetch(RF_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body })
  } catch (e) {
    console.warn('Roboflow 검출 실패', e)
    return null
  }
  if (!res?.ok) {
    if (res) console.warn('Roboflow 검출 실패', res.status)
    return null
  }
  const preds = findPredictions((await res.json()).outputs ?? [])
  return preds.map((p) => {
    const bw = p.width / c.width
    const bh = p.height / c.height
    const x = p.x / c.width
    const y = p.y / c.height
    return {
      x,
      y,
      size: bw * bh * 0.785, // 상자 안 타원 넓이로 어림(색 검출의 덩어리 넓이와 비슷한 척도)
      elong: Math.max(bw * W, bh * H) / Math.max(1e-6, Math.min(bw * W, bh * H)),
      angle: bw * W >= bh * H ? 0 : Math.PI / 2,
      box: { x0: x - bw / 2, y0: y - bh / 2, x1: x + bw / 2, y1: y + bh / 2 },
      conf: p.confidence,
      cloud: true,
    }
  })
}
