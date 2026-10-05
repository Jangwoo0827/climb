// 사진 속 벽의 실제 크기 추정: 실내 벽의 볼트 구멍(T-너트) 격자 간격을 재서 "격자 한 칸 = SPACING_M 미터"로 환산
// 볼트 구멍은 벽 위의 작고 둥근 어두운 점이 일정한 간격으로 반복되는 것. 점마다 가장 가까운 점까지의 거리를 모아
// 가장 흔한 거리(최빈값)를 격자 간격으로 봄. 원근(비스듬히 찍은 사진) 때문에 생기는 차이는 중앙값으로 흡수
export const SPACING_M = 0.2 // 볼트 구멍 격자 간격(m). 암장마다 다르면 「내 몸」 탭에서 고칠 수 있게

// gray: 밝기 배열(0~255, 길이 w*h). 반환: { spacingPx, wallWidthM, dots, regular(0~1) } 또는 null
export function estimateScale(gray, w, h, spacingM = SPACING_M) {
  // 1) 주변(9x9 평균)보다 확실히 어두운 픽셀 = 점 후보 (적분 영상으로 평균을 빠르게)
  const I = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x]
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row
    }
  }
  const R = 4
  const mean = (x, y) => {
    const x0 = Math.max(0, x - R)
    const y0 = Math.max(0, y - R)
    const x1 = Math.min(w, x + R + 1)
    const y1 = Math.min(h, y + R + 1)
    return (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0))
  }
  const mask = new Uint8Array(w * h)
  for (let y = R; y < h - R; y++)
    for (let x = R; x < w - R; x++) {
      const m = mean(x, y)
      // 밝은 바탕(벽) 위의 어두운 점만: 주변이 충분히 밝고, 점은 주변보다 35% 이상 어두움
      if (m > 90 && gray[y * w + x] < m * 0.65) mask[y * w + x] = 1
    }
  // 2) 작고 둥근 덩어리만 점으로
  const seen = new Uint8Array(w * h)
  const dots = []
  const st = []
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue
    let n = 0
    let sx = 0
    let sy = 0
    let x0 = w
    let x1 = 0
    let y0 = h
    let y1 = 0
    seen[s] = 1
    st.push(s)
    while (st.length) {
      const p = st.pop()
      const x = p % w
      const y = (p / w) | 0
      n++
      sx += x
      sy += y
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < w * h && mask[q] && !seen[q]) (seen[q] = 1), st.push(q)
      if (n > 200) break
    }
    const bw = x1 - x0 + 1
    const bh = y1 - y0 + 1
    if (n < 2 || n > 120 || Math.max(bw, bh) > 3 * Math.min(bw, bh) || n / (bw * bh) < 0.35) continue
    dots.push({ x: sx / n, y: sy / n })
  }
  if (dots.length < 15) return null
  // 3) 점마다 가장 가까운 점까지 거리(격자로 나눠 빠르게)
  const cell = 40
  const grid = new Map()
  dots.forEach((d, i) => {
    const k = `${Math.floor(d.x / cell)},${Math.floor(d.y / cell)}`
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push(i)
  })
  const nn = []
  dots.forEach((d, i) => {
    let best = Infinity
    const cx = Math.floor(d.x / cell)
    const cy = Math.floor(d.y / cell)
    for (let gx = cx - 3; gx <= cx + 3; gx++)
      for (let gy = cy - 3; gy <= cy + 3; gy++)
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          if (j === i) continue
          const dd = Math.hypot(dots[j].x - d.x, dots[j].y - d.y)
          if (dd < best) best = dd
        }
    if (best >= 5 && best < cell * 3) nn.push(best)
  })
  if (nn.length < 15) return null
  // 4) 격자의 두 축: 점과 점 사이 벡터를 2D 히스토그램(2px 칸)으로 모아 가장 강한 봉우리 v1과,
  //    v1과 30° 이상 다른 방향의 가장 강한 봉우리 v2를 찾음. 한 칸 넓이 |v1×v2|의 제곱근이 격자 간격
  //    (사진이 기울었거나 격자가 마름모·엇갈린 배열이어도 넓이는 그대로라 간격이 안 흔들림)
  const nnMed = nn.slice().sort((a, b) => a - b)[nn.length >> 1]
  const RAD = Math.min(150, Math.ceil(nnMed * 2.5))
  const B = 2
  const N = Math.ceil((2 * RAD) / B)
  const H = new Float32Array(N * N)
  const vecs = []
  dots.forEach((d, i) => {
    const cx = Math.floor(d.x / cell)
    const cy = Math.floor(d.y / cell)
    const r = Math.ceil(RAD / cell)
    for (let gx = cx - r; gx <= cx + r; gx++)
      for (let gy = cy - r; gy <= cy + r; gy++)
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          if (j === i) continue
          const dx = dots[j].x - d.x
          const dy = dots[j].y - d.y
          if (Math.abs(dx) >= RAD || Math.abs(dy) >= RAD) continue
          H[Math.floor((dy + RAD) / B) * N + Math.floor((dx + RAD) / B)]++
          vecs.push(dx, dy)
        }
  })
  const peaks = []
  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++) {
      const v = H[y * N + x]
      if (v < 3) continue
      let top = true
      for (let a = -1; a <= 1 && top; a++) for (let b = -1; b <= 1; b++) if ((a || b) && H[(y + a) * N + x + b] > v) top = false
      const dx = x * B - RAD + B / 2
      const dy = y * B - RAD + B / 2
      if (top && Math.hypot(dx, dy) > 6) peaks.push({ v, dx, dy })
    }
  peaks.sort((a, b) => b.v - a.v)
  // 봉우리 근처(3px) 벡터의 평균으로 정밀하게
  const refine = (p) => {
    let sx = 0
    let sy = 0
    let n = 0
    for (let k = 0; k < vecs.length; k += 2) if (Math.hypot(vecs[k] - p.dx, vecs[k + 1] - p.dy) <= 3) (sx += vecs[k]), (sy += vecs[k + 1]), n++
    return n ? { x: sx / n, y: sy / n, n } : { x: p.dx, y: p.dy, n: p.v }
  }
  const p1 = peaks[0]
  const p2 = peaks.find((p) => {
    const c = Math.abs(p.dx * p1.dy - p.dy * p1.dx) / (Math.hypot(p.dx, p.dy) * Math.hypot(p1.dx, p1.dy))
    return c > Math.sin((30 * Math.PI) / 180) && Math.hypot(p.dx, p.dy) < 2.2 * Math.hypot(p1.dx, p1.dy)
  })
  if (!p1 || !p2) return null
  const v1 = refine(p1)
  const v2 = refine(p2)
  const spacingPx = Math.sqrt(Math.abs(v1.x * v2.y - v1.y * v2.x))
  // 격자다움: 가장 가까운 점 거리가 두 축 길이 중 짧은 쪽 근처(±15%)인 점의 비율
  const short = Math.min(Math.hypot(v1.x, v1.y), Math.hypot(v2.x, v2.y))
  const regular = nn.filter((v) => Math.abs(v - short) <= short * 0.15).length / nn.length
  return { spacingPx, wallWidthM: (w / spacingPx) * spacingM, dots: dots.length, regular, axes: [v1, v2], points: dots }
}

// 믿을 만한 추정인지: 격자 간격이 너무 작지 않고(멀리서 찍어 점이 뭉개진 사진 제외), 점이 충분히 규칙적
export const isReliable = (r) => !!r && r.spacingPx >= 12 && r.regular >= 0.2 && r.dots >= 40

// <img> 요소에서 긴 변 1200px 밝기 영상을 만들어 추정
export function estimateScaleFromImage(img, spacingM = SPACING_M) {
  const W = img.naturalWidth
  const H = img.naturalHeight
  const k = Math.min(1, 1200 / Math.max(W, H))
  const w = Math.round(W * k)
  const h = Math.round(H * k)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(img, 0, 0, w, h)
  const d = g.getImageData(0, 0, w, h).data
  const gray = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  const r = estimateScale(gray, w, h, spacingM)
  return r && { ...r, imgW: w }
}
