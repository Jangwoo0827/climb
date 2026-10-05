// 홀드의 입체 정보: 사진에서 뽑은 윤곽, 종류별 두께, 종류별로 손이 닿는 지점과 손 방향.
// 3D 보기(View3D)와 손 모양(hand.js / depth.js)이 같은 값을 써서 손이 홀드 표면에 맞게 놓이도록 함

// 종류별 홀드 두께(벽에서 튀어나온 정도, m)와 둥근 정도(0~1, 클수록 언덕처럼 둥긂)
const SHAPE = {
  jug: { depth: 0.75, round: 0.35 },
  crimp: { depth: 0.3, round: 0.2 },
  sloper: { depth: 0.55, round: 0.6 },
  pinch: { depth: 0.9, round: 0.3 },
  pocket: { depth: 0.6, round: 0.35 },
  sidepull: { depth: 0.7, round: 0.3 },
  undercling: { depth: 0.7, round: 0.3 },
}
export function holdProfile(type, rx, ry) {
  const s = SHAPE[type] ?? SHAPE.jug
  const r = Math.min(rx, ry)
  return { depth: Math.min(0.14, Math.max(0.015, r * s.depth)), round: s.round }
}

// 사진(sampleImage 결과, 0~1 정규화 좌표)의 홀드 상자에서 윤곽을 뽑음: 상자 바로 바깥 벽 색과 다른 픽셀 덩어리를
// 중심에서 32방향으로 재서 별 모양 다각형으로. 반환: [[x, y], ...] (0~1 정규화) 또는 null
export function holdOutline(img, box, rays = 32) {
  const { w, h, lab } = img
  const x0 = Math.max(0, Math.floor(box.x0 * w))
  const x1 = Math.min(w - 1, Math.ceil(box.x1 * w))
  const y0 = Math.max(0, Math.floor(box.y0 * h))
  const y1 = Math.min(h - 1, Math.ceil(box.y1 * h))
  if (x1 - x0 < 3 || y1 - y0 < 3) return null
  const ring = [[], [], []]
  for (let y = y0 - 3; y <= y1 + 3; y++)
    for (let x = x0 - 3; x <= x1 + 3; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h || (x >= x0 && x <= x1 && y >= y0 && y <= y1)) continue
      const p = (y * w + x) * 3
      ring[0].push(lab[p])
      ring[1].push(lab[p + 1])
      ring[2].push(lab[p + 2])
    }
  if (ring[0].length < 8) return null
  const med = (a) => a.sort((u, v) => u - v)[a.length >> 1]
  const [wL, wa, wb] = ring.map(med)
  const isHold = (x, y) => {
    const p = (y * w + x) * 3
    return Math.hypot(0.6 * (lab[p] - wL), lab[p + 1] - wa, lab[p + 2] - wb) > 10
  }
  // 덩어리 중심
  let sx = 0
  let sy = 0
  let n = 0
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (isHold(x, y)) (sx += x), (sy += y), n++
  if (n < 6 || n < 0.2 * (x1 - x0 + 1) * (y1 - y0 + 1)) return null
  const cx = sx / n
  const cy = sy / n
  const maxR = Math.hypot(x1 - x0, y1 - y0)
  const radius = []
  for (let k = 0; k < rays; k++) {
    const t = (k / rays) * Math.PI * 2
    const dx = Math.cos(t)
    const dy = Math.sin(t)
    let last = 0.5
    let gap = 0
    for (let r = 0.5; r < maxR; r += 0.5) {
      const x = Math.round(cx + dx * r)
      const y = Math.round(cy + dy * r)
      if (x < x0 || x > x1 || y < y0 || y > y1) break
      if (isHold(x, y)) (last = r), (gap = 0)
      else if (++gap > 3) break // 2픽셀 넘게 벽이면 홀드 끝
    }
    radius.push(last + 0.5)
  }
  // 튀는 반지름을 이웃과 평균해 다듬음
  const sm = radius.map((r, k) => (radius[(k + rays - 1) % rays] + 2 * r + radius[(k + 1) % rays]) / 4)
  return sm.map((r, k) => {
    const t = (k / rays) * Math.PI * 2
    return [(cx + Math.cos(t) * r) / w, (cy + Math.sin(t) * r) / h]
  })
}

const v = (x, y, z) => ({ x, y, z })
const norm = (a) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1
  return v(a.x / l, a.y / l, a.z / l)
}

// 종류별로 손가락이 닿는 지점(anchor)과 손 방향. hold: { mx, my, rx, ry, depth } (미터, 벽 = z 0)
// f = 손가락이 뻗는 방향, n = 손등이 향하는 방향. 손목은 anchor에서 손 길이만큼 f 반대쪽, 손바닥이 표면에 닿게 n쪽으로 띄움
export function gripFrame(type, hold, bodyX, heightM = 1.7) {
  const { mx, my, rx, ry, base = 0 } = hold
  const d = hold.depth + base // 볼륨 위 홀드면 볼륨 표면 높이만큼 더 나와 있음
  const k = heightM / 1.7
  let anchor
  let f
  let n
  switch (type) {
    case 'crimp':
    case 'jug':
      // 윗모서리에 손가락을 걸고 아래로 당김: 손가락은 위로 뻗었다가 모서리 너머 벽 쪽으로 굽음
      anchor = v(mx, my + ry * 0.55, d * 0.85)
      f = norm(v(0, 1, -0.3))
      n = norm(v(0, 0.3, 1))
      break
    case 'sloper':
    case 'volume':
      // 윗면을 손바닥으로 덮음
      anchor = v(mx, my + ry * 0.25, d)
      f = norm(v(0, 0.75, -0.65))
      n = norm(v(0, 0.65, 0.75))
      break
    case 'pocket':
      // 가운데 구멍에 손가락을 넣음
      anchor = v(mx, my, d * 0.7)
      f = norm(v(0, 0.45, -0.9))
      n = norm(v(0, 0.9, 0.45))
      break
    case 'undercling':
      // 아랫모서리에 손바닥을 위로 해서 걸고 위로 당김: 손가락은 벽 쪽(홀드 밑)으로, 손등은 아래
      anchor = v(mx, my - ry * 0.6, d * 0.6)
      f = norm(v(0, 0.25, -1))
      n = norm(v(0, -1, 0.25))
      break
    case 'sidepull': {
      // 몸 반대쪽 옆모서리에 손가락을 걸고 몸 쪽으로 당김
      const s = mx >= bodyX ? 1 : -1
      anchor = v(mx + s * rx * 0.55, my, d * 0.85)
      f = norm(v(s, 0, -0.3))
      n = norm(v(0.3 * s, 0, 1))
      break
    }
    case 'pinch':
      // 손을 세워 엄지와 네 손가락으로 양옆을 집음: 손가락은 위로, 손등은 몸 바깥쪽 옆
      anchor = v(mx, my + ry * 0.3, d * 0.6)
      f = norm(v(0, 1, -0.2))
      n = norm(v(mx >= bodyX ? 1 : -1, 0, 0.35))
      break
    default:
      anchor = v(mx, my + ry * 0.5, d * 0.85)
      f = norm(v(0, 1, -0.3))
      n = norm(v(0, 0.3, 1))
  }
  // 손목: anchor에서 손바닥(9cm)+손가락 첫마디쯤 f 반대쪽, 손바닥 두께만큼 손등 쪽으로
  const back = 0.1 * k
  const wrist = v(anchor.x - f.x * back + n.x * 0.015, anchor.y - f.y * back + n.y * 0.015, Math.max(0.02, anchor.z - f.z * back + n.z * 0.015))
  return { anchor, f, n, wrist }
}

// ---------- 볼륨(벽에서 솟은 다각뿔) ----------
// 볼륨 윤곽(미터 좌표 [[x,y],...])을 볼록 껍질 → 적은 꼭짓점 다각형으로 다듬음(실제 볼륨은 면이 몇 개뿐)
export function volumeBase(outline) {
  const pts = [...outline].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo = []
  for (const q of pts) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop()
    lo.push(q)
  }
  const up = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = pts[i]
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop()
    up.push(q)
  }
  let hull = [...lo.slice(0, -1), ...up.slice(0, -1)]
  // 짧은 변을 합쳐 꼭짓점을 줄임(둘레의 6% 미만인 변의 끝점 제거, 최소 3개)
  const per = hull.reduce((a, p, i) => a + Math.hypot(p[0] - hull[(i + 1) % hull.length][0], p[1] - hull[(i + 1) % hull.length][1]), 0)
  let changed = true
  while (changed && hull.length > 3) {
    changed = false
    for (let i = 0; i < hull.length && hull.length > 3; i++) {
      const a = hull[i]
      const b = hull[(i + 1) % hull.length]
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < per * 0.06) {
        hull.splice((i + 1) % hull.length, 1)
        changed = true
      }
    }
  }
  const cx = hull.reduce((a, p) => a + p[0], 0) / hull.length
  const cy = hull.reduce((a, p) => a + p[1], 0) / hull.length
  return { base: hull, apex: [cx, cy] }
}

// 볼륨 높이(벽에서 꼭대기까지, m): 폭의 약 40%, 5~30cm
export const volumeHeight = (rx, ry) => Math.min(0.3, Math.max(0.05, 0.4 * Math.min(rx, ry)))

// 점이 다각형 안에 있나
export function insidePoly(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// 볼륨 표면 높이: 꼭대기(apex)에서 가장자리로 갈수록 0까지 낮아짐(점에서 꼭대기 방향 반직선이 가장자리와 만나는 비율로)
export function volumeSurfaceZ(vol, x, y) {
  const [ax, ay] = vol.apex
  const dx = x - ax
  const dy = y - ay
  const d = Math.hypot(dx, dy)
  if (d < 1e-6) return vol.height
  let edge = Infinity
  const B = vol.base
  for (let i = 0; i < B.length; i++) {
    const [x1, y1] = B[i]
    const [x2, y2] = B[(i + 1) % B.length]
    // 반직선 a + t·(dx,dy)/d 와 선분 교차
    const ex = x2 - x1
    const ey = y2 - y1
    const den = (dx / d) * ey - (dy / d) * ex
    if (Math.abs(den) < 1e-9) continue
    const t = ((x1 - ax) * ey - (y1 - ay) * ex) / den
    const u = ((x1 - ax) * (dy / d) - (y1 - ay) * (dx / d)) / den
    if (t > 0 && u >= 0 && u <= 1) edge = Math.min(edge, t)
  }
  if (!isFinite(edge) || d >= edge) return 0
  return vol.height * (1 - d / edge)
}
