// 벽 펴기: 비스듬히 찍혔거나 여러 면으로 꺾인 벽을 정면에서 본 평평한 사진으로 만든다.
// 면마다 네 모서리(왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래)를 받아, 원근 변환(호모그래피)으로 직사각형으로 펴고
// 같은 높이로 맞춰 왼쪽부터 이어 붙인다. 천장·바닥처럼 면 밖은 잘려 나감

// 4점 → 4점 호모그래피(3x3, h33 = 1). src/dst: [{x, y}] 4개. 8원 연립방정식을 가우스 소거로 풂
export function homography(src, dst) {
  const A = []
  const b = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  const n = 8
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    ;[A[c], A[piv]] = [A[piv], A[c]]
    ;[b[c], b[piv]] = [b[piv], b[c]]
    if (Math.abs(A[c][c]) < 1e-12) return null
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]
      b[r] -= f * b[c]
    }
  }
  const h = b.map((v, i) => v / A[i][i])
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

const apply = (H, x, y) => {
  const w = H[6] * x + H[7] * y + H[8]
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w }
}
const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// img: <img>/<canvas>, faces: [[{x,y}x4], ...] (0~1 정규화, 왼쪽 위부터 시계 방향). 반환: 펴서 이어 붙인 <canvas>
export function rectifyFaces(img, faces, maxW = 1600) {
  const W = img.naturalWidth ?? img.width
  const H = img.naturalHeight ?? img.height
  const src = document.createElement('canvas')
  src.width = W
  src.height = H
  const sg = src.getContext('2d', { willReadFrequently: true })
  sg.drawImage(img, 0, 0)
  const sd = sg.getImageData(0, 0, W, H).data
  // 면마다 펼친 크기: 위·아래 변 평균 = 너비, 왼·오른 변 평균 = 높이(사진 픽셀). 모든 면을 같은 높이로 맞춤
  const px = faces.map((f) => f.map((p) => ({ x: p.x * W, y: p.y * H })))
  const sizes = px.map((q) => ({ w: (len(q[0], q[1]) + len(q[3], q[2])) / 2, h: (len(q[0], q[3]) + len(q[1], q[2])) / 2 }))
  const outH0 = Math.max(...sizes.map((s) => s.h))
  const widths0 = sizes.map((s) => (s.w * outH0) / s.h)
  const k = Math.min(1, maxW / widths0.reduce((a, b) => a + b, 0))
  const outH = Math.round(outH0 * k)
  const widths = widths0.map((w) => Math.round(w * k))
  const outW = widths.reduce((a, b) => a + b, 0)
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const og = out.getContext('2d')
  const od = og.createImageData(outW, outH)
  let x0 = 0
  px.forEach((q, i) => {
    const w = widths[i]
    // 펼친 직사각형 → 사진 속 면(역방향)으로 바로 대응: 결과 픽셀마다 사진에서 쌍선형 보간으로 색을 가져옴
    const Hinv = homography(
      [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: outH }, { x: 0, y: outH }],
      q,
    )
    if (!Hinv) return
    for (let y = 0; y < outH; y++)
      for (let x = 0; x < w; x++) {
        const p = apply(Hinv, x + 0.5, y + 0.5)
        const sx = Math.min(W - 2, Math.max(0, p.x - 0.5))
        const sy = Math.min(H - 2, Math.max(0, p.y - 0.5))
        const ix = Math.floor(sx)
        const iy = Math.floor(sy)
        const fx = sx - ix
        const fy = sy - iy
        const o = (y * outW + x0 + x) * 4
        for (let c = 0; c < 4; c++) {
          const a = sd[(iy * W + ix) * 4 + c]
          const b2 = sd[(iy * W + ix + 1) * 4 + c]
          const c2 = sd[((iy + 1) * W + ix) * 4 + c]
          const d = sd[((iy + 1) * W + ix + 1) * 4 + c]
          od.data[o + c] = (a * (1 - fx) + b2 * fx) * (1 - fy) + (c2 * (1 - fx) + d * fx) * fy
        }
      }
    x0 += w
  })
  og.putImageData(od, 0, 0)
  return out
}

// 처음 보여줄 면: 사진 가운데 80%. 면을 더하면 앞 면의 오른쪽 변에서 시작해 오른쪽으로
export const defaultFace = () => [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
]
export function nextFace(prev) {
  const w = Math.max(0.1, Math.min(0.3, 1 - Math.max(prev[1].x, prev[2].x)))
  return [prev[1], { x: Math.min(1, prev[1].x + w), y: prev[1].y }, { x: Math.min(1, prev[2].x + w), y: prev[2].y }, prev[2]].map((p) => ({ ...p }))
}
