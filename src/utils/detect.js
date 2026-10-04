// 색 기반 홀드 검출.
// 사용자가 누른 홀드의 색을 Lab 색 공간에서 구하고(누른 홀드를 영역 확장해 평균 색과 편차를 얻음),
// 비슷한 색의 덩어리 중에서 벽 배경·구조물·띠처럼 홀드가 아닌 것을 모양과 주변 대비로 걸러 홀드로 인식한다.

const MAX_W = 480

// sRGB(0~255) -> CIE Lab (D65)
function rgbToLab(r, g, b) {
  const lin = (c) => {
    c /= 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

// 이미지(또는 캔버스)를 작은 크기로 줄여 Lab 값까지 계산해 둔다.
export function sampleImage(source, srcW, srcH) {
  const scale = Math.min(1, MAX_W / srcW)
  const w = Math.round(srcW * scale)
  const h = Math.round(srcH * scale)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, w, h)
  return fromRGBA(ctx.getImageData(0, 0, w, h).data, w, h)
}

// RGBA 픽셀 배열로 Lab 이미지를 만든다(테스트 스크립트에서도 씀)
export function fromRGBA(data, w, h) {
  const lab = new Float32Array(w * h * 3)
  for (let p = 0; p < w * h; p++) {
    const [L, a, b] = rgbToLab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2])
    lab[p * 3] = L
    lab[p * 3 + 1] = a
    lab[p * 3 + 2] = b
  }
  return { w, h, data, lab }
}

// 시드 영역 확장용 색 차이. 밝기(L) 차이는 조명·그림자 영향이 커서 chromatic 색에서는 가중치를 낮춤
function dE(img, p, t) {
  const l = img.lab
  const i = p * 3
  return Math.hypot(t.wl * (l[i] - t.L), l[i + 1] - t.a, l[i + 2] - t.b)
}

const RAD = 180 / Math.PI
const hueDiff = (h1, h2) => {
  const d = Math.abs(h1 - h2) % 360
  return d > 180 ? 360 - d : d
}

// 홀드는 음영 때문에 밝기가 달라져도 색조(hue)는 유지되므로, 색이 있는 홀드는 Lab 색조각으로 매칭하고 밝기는 넓게 허용한다.
// 회색/흰색/검정 홀드는 밝기로 매칭한다.
function matches(img, p, t, scale) {
  const i = p * 3
  const L = img.lab[i]
  const a = img.lab[i + 1]
  const b = img.lab[i + 2]
  const c = Math.hypot(a, b)
  if (t.kind === 'gray') return Math.abs(L - t.L) <= t.Ltol * scale && c <= 22
  return c >= 0.4 * t.chroma && Math.abs(L - t.L) <= t.Ltol * Math.min(scale, 1.3) && hueDiff(Math.atan2(b, a) * RAD, t.hue) <= t.hueTol * scale
}

// 벽 배경색: 이미지에서 가장 넓게 차지하는 색 덩어리(전체의 6% 이상)들의 평균 Lab
function backgroundColors(img) {
  const bins = new Map()
  for (let p = 0; p < img.w * img.h; p++) {
    const i = p * 3
    const key = `${Math.round(img.lab[i] / 10)},${Math.round(img.lab[i + 1] / 8)},${Math.round(img.lab[i + 2] / 8)}`
    const e = bins.get(key) ?? { n: 0, L: 0, a: 0, b: 0 }
    e.n++
    e.L += img.lab[i]
    e.a += img.lab[i + 1]
    e.b += img.lab[i + 2]
    bins.set(key, e)
  }
  const total = img.w * img.h
  return [...bins.values()]
    .filter((e) => e.n > total * 0.06)
    .sort((x, y) => y.n - x.n)
    .slice(0, 4)
    .map((e) => ({ L: e.L / e.n, a: e.a / e.n, b: e.b / e.n }))
}

// 누른 위치의 홀드 색을 구한다. 반환: {kind, L, a, b, chroma, hue, Ltol, hueTol} (kind: 'color' | 'gray')
export function pickTarget(img, nx, ny) {
  const x = Math.min(img.w - 1, Math.max(0, Math.round(nx * img.w)))
  const y = Math.min(img.h - 1, Math.max(0, Math.round(ny * img.h)))
  const seedIdx = y * img.w + x

  // 시작 색: 5x5 창의 중앙값 (반사광 점이나 잡음에 덜 흔들림)
  const chan = [[], [], []]
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const xx = Math.min(img.w - 1, Math.max(0, x + dx))
      const yy = Math.min(img.h - 1, Math.max(0, y + dy))
      const p = yy * img.w + xx
      for (let c = 0; c < 3; c++) chan[c].push(img.lab[p * 3 + c])
    }
  const med = chan.map((arr) => arr.sort((u, v) => u - v)[12])
  const seed = { L: med[0], a: med[1], b: med[2] }
  seed.chroma = Math.hypot(seed.a, seed.b)
  seed.wl = seed.chroma < 14 ? 1 : 0.5 // 흰색/검정/회색은 밝기가 핵심

  // 영역 확장: 시작 색과 비슷한 이어진 픽셀을 모아 그 홀드의 평균 색과 색 편차를 구함
  const seen = new Uint8Array(img.w * img.h)
  const stack = [seedIdx]
  seen[seedIdx] = 1
  const region = []
  while (stack.length && region.length < 6000) {
    const p = stack.pop()
    if (dE(img, p, seed) > 12) continue
    region.push(p)
    const px = p % img.w
    const py = (p / img.w) | 0
    if (px > 0 && !seen[p - 1]) (seen[p - 1] = 1), stack.push(p - 1)
    if (px < img.w - 1 && !seen[p + 1]) (seen[p + 1] = 1), stack.push(p + 1)
    if (py > 0 && !seen[p - img.w]) (seen[p - img.w] = 1), stack.push(p - img.w)
    if (py < img.h - 1 && !seen[p + img.w]) (seen[p + img.w] = 1), stack.push(p + img.w)
  }

  let { L, a, b } = seed
  let sdL = 6
  let sdHue = 4
  if (region.length >= 12) {
    let sL = 0
    let sa = 0
    let sb = 0
    for (const p of region) {
      sL += img.lab[p * 3]
      sa += img.lab[p * 3 + 1]
      sb += img.lab[p * 3 + 2]
    }
    L = sL / region.length
    a = sa / region.length
    b = sb / region.length
    sdL = Math.sqrt(region.reduce((u, p) => u + (img.lab[p * 3] - L) ** 2, 0) / region.length)
    const h0 = Math.atan2(b, a) * RAD
    sdHue = Math.sqrt(region.reduce((u, p) => u + hueDiff(Math.atan2(img.lab[p * 3 + 2], img.lab[p * 3 + 1]) * RAD, h0) ** 2, 0) / region.length)
  }
  const chroma = Math.hypot(a, b)
  const hue = Math.atan2(b, a) * RAD
  const target =
    chroma < 14
      ? { kind: 'gray', L, a, b, chroma, hue, Ltol: Math.min(14, Math.max(8, 2 * sdL + 8)), hueTol: 0 }
      : { kind: 'color', L, a, b, chroma, hue, Ltol: Math.min(42, Math.max(22, 3 * sdL + 22)), hueTol: Math.min(30, Math.max(14, 2.5 * sdHue + 12)) }

  // 벽 배경색과 색조가 비슷하면 허용 범위를 좁혀 벽까지 잡히지 않게 함
  if (target.kind === 'color') {
    for (const bg of backgroundColors(img)) {
      if (Math.hypot(bg.a, bg.b) < 12) continue
      const dh = hueDiff(Math.atan2(bg.b, bg.a) * RAD, hue)
      if (dh < 50) target.hueTol = Math.min(target.hueTol, Math.max(8, dh * 0.5))
    }
  }
  return target
}

// 마스크를 3x3으로 깎았다가(침식) 다시 부풀려서(팽창) 얇은 잡음과 가는 줄을 없앰
function open3(mask, w, h) {
  const er = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      if (
        mask[p] && mask[p - 1] && mask[p + 1] && mask[p - w] && mask[p + w] &&
        mask[p - w - 1] && mask[p - w + 1] && mask[p + w - 1] && mask[p + w + 1]
      )
        er[p] = 1
    }
  const out = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      if (
        er[p] || er[p - 1] || er[p + 1] || er[p - w] || er[p + w] ||
        er[p - w - 1] || er[p - w + 1] || er[p + w - 1] || er[p + w + 1]
      )
        out[p] = mask[p] // 원래 마스크 안에서만 부풀림
    }
  return out
}

function findBlobs(img, target, scale) {
  const { w, h } = img
  const mask = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p++) if (matches(img, p, target, scale)) mask[p] = 1
  return blobsFromMask(img, mask)
}

// 마스크를 덩어리로 묶어 크기·위치·평균 색 등을 구한다
function blobsFromMask(img, mask) {
  const { w, h } = img
  const m = open3(mask, w, h)

  const label = new Int32Array(w * h)
  const blobs = []
  const stack = []
  for (let start = 0; start < w * h; start++) {
    if (!m[start] || label[start]) continue
    const id = blobs.length + 1
    let area = 0
    let sx = 0
    let sy = 0
    let sxx = 0
    let syy = 0
    let sxy = 0
    let x0 = w
    let x1 = 0
    let y0 = h
    let y1 = 0
    let gs = 0 // 경계의 밝기 기울기 합(또렷함). 그림자는 경계가 서서히 변해 값이 작음
    let gn = 0
    let tx = 0 // 가장자리 점: 맨 위(x), 맨 아래(x), 맨 왼쪽(y), 맨 오른쪽(y). 볼륨의 접점으로 씀
    let bx = 0
    let ly = 0
    let ry = 0
    let sL = 0
    let sa = 0
    let sb = 0
    stack.push(start)
    label[start] = id
    while (stack.length) {
      const p = stack.pop()
      const x = p % w
      const y = (p / w) | 0
      area++
      sx += x
      sy += y
      sxx += x * x
      syy += y * y
      sxy += x * y
      if (x < x0) (x0 = x), (ly = y)
      if (x > x1) (x1 = x), (ry = y)
      if (y < y0) (y0 = y), (tx = x)
      if (y > y1) (y1 = y), (bx = x)
      sL += img.lab[p * 3]
      sa += img.lab[p * 3 + 1]
      sb += img.lab[p * 3 + 2]
      if (x >= 2 && y >= 2 && x < w - 2 && y < h - 2 && (!m[p - 1] || !m[p + 1] || !m[p - w] || !m[p + w])) {
        const gx = img.lab[(p + 2) * 3] - img.lab[(p - 2) * 3]
        const gy = img.lab[(p + 2 * w) * 3] - img.lab[(p - 2 * w) * 3]
        gs += Math.hypot(gx, gy) / 4
        gn++
      }
      if (x > 0 && m[p - 1] && !label[p - 1]) (label[p - 1] = id), stack.push(p - 1)
      if (x < w - 1 && m[p + 1] && !label[p + 1]) (label[p + 1] = id), stack.push(p + 1)
      if (y > 0 && m[p - w] && !label[p - w]) (label[p - w] = id), stack.push(p - w)
      if (y < h - 1 && m[p + w] && !label[p + w]) (label[p + w] = id), stack.push(p + w)
    }
    blobs.push({ id, area, sx, sy, sxx, syy, sxy, x0, x1, y0, y1, tx, bx, ly, ry, edge: gn ? gs / gn : 10, L: sL / area, a: sa / area, b: sb / area })
  }
  return { blobs, label }
}

// 홀드(또는 볼륨)인지 판단: 크기, 모양(채움 비율, 길쭉함), 주변과의 색 대비. 볼륨은 큰 덩어리라 상한을 넉넉히 둠
function isHold(img, label, b, target, dbg) {
  const { w, h } = img
  const minArea = Math.max(14, w * h * 0.0005)
  const maxArea = w * h * 0.12
  if (b.area < minArea || b.area > maxArea) return false
  const bw = b.x1 - b.x0 + 1
  const bh = b.y1 - b.y0 + 1
  if (b.area / (bw * bh) < 0.3) return false // 속이 비고 가는 것(줄, 띠, 구조물)
  if (Math.max(bw, bh) / Math.min(bw, bh) > 6) return false // 너무 가늘고 긴 것

  // 덩어리 전체의 평균 색이 누른 홀드와 맞아야 함. 픽셀 단위로는 색조가 비슷해도 훨씬 어둡거나 탁한 덩어리(구조물, 그림자)는 탈락
  if (Math.abs(b.L - target.L) > 0.6 * target.Ltol) return false
  if (target.kind === 'color') {
    if (Math.hypot(b.a, b.b) < 0.55 * target.chroma) return false
    if (hueDiff(Math.atan2(b.b, b.a) * RAD, target.hue) > 0.8 * target.hueTol) return false
  }

  // 주변 대비: 덩어리 둘레에서 다른 색인 곳이 60% 이상이어야 함. 벽 조각은 주변도 같은 벽이라 탈락
  const cx = b.sx / b.area
  const cy = b.sy / b.area
  let valid = 0
  let differ = 0
  const ringL = []
  const ringA = []
  const ringB = []
  for (let k = 0; k < 24; k++) {
    const th = (k / 24) * Math.PI * 2
    const x = Math.round(cx + (bw / 2 + 3) * Math.cos(th))
    const y = Math.round(cy + (bh / 2 + 3) * Math.sin(th))
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const p = y * w + x
    if (label[p] === b.id) continue
    valid++
    ringL.push(img.lab[p * 3])
    ringA.push(img.lab[p * 3 + 1])
    ringB.push(img.lab[p * 3 + 2])
    const d = Math.hypot(0.5 * (img.lab[p * 3] - b.L), img.lab[p * 3 + 1] - b.a, img.lab[p * 3 + 2] - b.b)
    if (d > 12) differ++
  }
  if (valid < 6 || differ / valid < 0.6) return false

  // 그림자 제외: 주변 벽보다 어두울 뿐 벽과 같은 색조(벽 색을 그대로 어둡게 한 색)이고 경계가 서서히 변하면 그림자
  // 벽 색은 중앙값으로 구함(주변에 다른 색 홀드가 섞여도 흔들리지 않음)
  const med = (arr) => arr.sort((u, v) => u - v)[arr.length >> 1]
  const wallL = med(ringL)
  const wallA = med(ringA)
  const wallB = med(ringB)
  const wallChroma = Math.hypot(wallA, wallB)
  const blobChroma = Math.hypot(b.a, b.b)
  const darker = b.L < wallL - 6 && b.L > wallL * 0.3
  const sameTint =
    wallChroma >= 8
      ? hueDiff(Math.atan2(b.b, b.a) * RAD, Math.atan2(wallB, wallA) * RAD) <= 20 && blobChroma >= 0.5 * wallChroma && blobChroma <= 1.3 * wallChroma
      : blobChroma <= 10
  if (dbg) Object.assign(dbg, { wallL, wallChroma, blobChroma, darker, sameTint, edge: b.edge })
  if (darker && sameTint && b.edge < 4.6) return false
  return true
}

// 반환: 홀드 배열 {x,y,size,elong,angle} (x,y는 0~1 정규화, size는 화면 대비 면적 비율)
export function detectHolds(img, target) {
  const { w, h } = img
  let found = []
  let lab = null
  let scale = 1
  // 너무 많이 잡히면 허용 범위를 좁히고, 하나도 없으면 넓혀 다시 시도
  for (let attempt = 0; attempt < 4; attempt++) {
    const { blobs, label } = findBlobs(img, target, scale)
    lab = label
    found = blobs.filter((b) => isHold(img, label, b, target))
    if (found.length > 60 && scale > 0.4) scale *= 0.8
    else if (found.length === 0 && scale < 1.7) scale *= 1.3
    else break
  }
  // 볼륨: 보통 홀드(중앙값)보다 크고, 윤곽이 곧은 모서리의 다각형인 덩어리. 크기만 크고 둥근 것은 큰 홀드(매크로)
  const normal = found.filter((b) => b.area <= w * h * 0.02).map((b) => b.area).sort((u, v) => u - v)
  const med = normal.length ? normal[normal.length >> 1] : 0
  const volumeMin = Math.max(w * h * 0.004, med * 2.5)
  return found.map((b) => toHold(b, w, h, b.area >= volumeMin && isPolygonVolume(polygonShape(lab, b, w))))
}

// 덩어리 → 홀드 정보 {x,y,size,elong,angle,box,volume,extent}
function toHold(b, w, h, volume) {
  // 덩어리의 길쭉함(elong)과 방향(angle, 라디안)을 공분산으로 구함. 홀드 종류 추정에 씀
  const mx = b.sx / b.area
  const my = b.sy / b.area
  const cxx = b.sxx / b.area - mx * mx
  const cyy = b.syy / b.area - my * my
  const cxy = b.sxy / b.area - mx * my
  const tr = cxx + cyy
  const root = Math.sqrt(Math.max(0, (tr * tr) / 4 - (cxx * cyy - cxy * cxy)))
  const l1 = tr / 2 + root
  const l2 = Math.max(1e-6, tr / 2 - root)
  // 중심 쪽으로 12% 들여 잡은 가장자리 접점(위/아래/왼쪽/오른쪽)
  const inset = (px, py) => ({ x: (mx + (px - mx) * 0.88) / w, y: (my + (py - my) * 0.88) / h })
  return {
    x: mx / w,
    box: { x0: b.x0 / w, y0: b.y0 / h, x1: (b.x1 + 1) / w, y1: (b.y1 + 1) / h }, // 홀드를 감싸는 상자(AI 판별용으로 자를 때 씀)
    y: my / h,
    size: b.area / (w * h),
    elong: b.area < 30 ? 1 : Math.sqrt(l1 / l2),
    angle: 0.5 * Math.atan2(2 * cxy, cxx - cyy),
    volume,
    extent: volume ? { top: inset(b.tx, b.y0), bottom: inset(b.bx, b.y1), left: inset(b.x0, b.ly), right: inset(b.x1, b.ry) } : undefined,
  }
}

// 테스트/디버깅용: 내부 함수를 노출함
// 발 자유용: 색과 상관없이 벽 배경이 아닌 덩어리를 모두 홀드로 찾는다(발 자리로만 씀)
export function detectAllHolds(img) {
  const { w, h } = img
  const bgs = backgroundColors(img)
  if (!bgs.length) return []
  const mask = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p++) {
    const i = p * 3
    let near = false
    for (const bg of bgs) {
      // 벽 배경색과 비슷하면(그림자처럼 어두워진 벽 포함) 홀드가 아님
      const dc = Math.hypot(img.lab[i + 1] - bg.a, img.lab[i + 2] - bg.b)
      const dl = img.lab[i] - bg.L
      if (dc < 12 && dl < 12 && dl > -45) {
        near = true
        break
      }
    }
    if (!near) mask[p] = 1
  }
  const { blobs } = blobsFromMask(img, mask)
  const minArea = Math.max(14, w * h * 0.0004)
  const maxArea = w * h * 0.03
  return blobs
    .filter((b) => {
      if (b.area < minArea || b.area > maxArea) return false
      const bw = b.x1 - b.x0 + 1
      const bh = b.y1 - b.y0 + 1
      return b.area / (bw * bh) >= 0.3 && Math.max(bw, bh) / Math.min(bw, bh) <= 6
    })
    .map((b) => ({ x: b.sx / b.area / w, y: b.sy / b.area / h, size: b.area / (w * h) }))
}

// 덩어리 윤곽이 곧은 모서리의 다각형인지(볼륨) 둥근지(큰 홀드). 반환: {verts, solidity, fit}
// - 경계 픽셀의 볼록 껍질을 더글러스-포이커로 단순화했을 때 꼭짓점 수: 삼각형·사각뿔 볼륨은 3~6, 둥근 홀드는 8 이상
// - fit: 경계 픽셀이 단순화한 다각형 변에서 평균 얼마나 떨어졌는지(덩어리 크기 대비). 곧은 모서리면 작음
// - solidity: 덩어리 넓이 / 볼록 껍질 넓이. 볼륨은 꽉 찬 볼록 도형
function polygonShape(label, b, w) {
  const pts = []
  for (let y = b.y0; y <= b.y1; y++)
    for (let x = b.x0; x <= b.x1; x++) {
      const p = y * w + x
      if (label[p] !== b.id) continue
      if (x === b.x0 || x === b.x1 || y === b.y0 || y === b.y1 || label[p - 1] !== b.id || label[p + 1] !== b.id || label[p - w] !== b.id || label[p + w] !== b.id) pts.push([x, y])
    }
  if (pts.length < 8) return { verts: 99, solidity: 0, fit: 1 }
  const sorted = [...pts].sort((a, c) => a[0] - c[0] || a[1] - c[1])
  const cross = (o, a, c) => (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0])
  const lower = []
  for (const q of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const q = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  let hullArea = 0
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const c = hull[(i + 1) % hull.length]
    hullArea += a[0] * c[1] - c[0] * a[1]
  }
  hullArea = Math.abs(hullArea) / 2 || 1
  const segD = (q, a, c) => {
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const L = vx * vx + vy * vy || 1e-9
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / L))
    return Math.hypot(q[0] - a[0] - vx * t, q[1] - a[1] - vy * t)
  }
  // 닫힌 껍질을 가장 먼 두 점에서 나눠 각각 더글러스-포이커
  const eps = 0.06 * Math.sqrt(hullArea)
  const dp = (arr) => {
    if (arr.length <= 2) return arr
    let far = 0
    let fi = 0
    for (let i = 1; i < arr.length - 1; i++) {
      const d = segD(arr[i], arr[0], arr[arr.length - 1])
      if (d > far) (far = d), (fi = i)
    }
    if (far <= eps) return [arr[0], arr[arr.length - 1]]
    return [...dp(arr.slice(0, fi + 1)).slice(0, -1), ...dp(arr.slice(fi))]
  }
  let i0 = 0
  let j0 = 0
  let best = -1
  for (let i = 0; i < hull.length; i++)
    for (let j = i + 1; j < hull.length; j++) {
      const d = Math.hypot(hull[i][0] - hull[j][0], hull[i][1] - hull[j][1])
      if (d > best) (best = d), (i0 = i), (j0 = j)
    }
  const a1 = dp(hull.slice(i0, j0 + 1))
  const a2 = dp([...hull.slice(j0), ...hull.slice(0, i0 + 1)])
  const poly = [...a1.slice(0, -1), ...a2.slice(0, -1)]
  let fs = 0
  for (const q of pts) {
    let m = Infinity
    for (let k = 0; k < poly.length; k++) m = Math.min(m, segD(q, poly[k], poly[(k + 1) % poly.length]))
    fs += m
  }
  return { verts: poly.length, solidity: b.area / hullArea, fit: fs / pts.length / Math.sqrt(hullArea), poly }
}

// 다각형 볼륨 판정 기준
const isPolygonVolume = (sh) => sh.verts <= 6 && sh.solidity >= 0.8 && sh.fit <= 0.05

// 볼륨 찾기: 색과 상관없이 벽 배경이 아닌 큰 덩어리 중 곧은 모서리의 다각형. 반환 형식은 detectHolds와 같음(volume: true)
// - 배경: 벽 색과 비슷한 픽셀. 회색 볼륨이 흰 벽의 그림자로 묻히지 않게 어두운 쪽 허용을 좁게(-22)
// - 덩어리: 이웃 픽셀끼리 색(색조 위주, 밝기는 절반 가중)이 비슷할 때만 이어, 붙어 있는 다른 색 홀드와 갈라짐.
//   볼륨의 면은 조명에 따라 밝기만 달라서 같은 덩어리로 남음
export function detectVolumes(img, dbg) {
  const { w, h } = img
  const bgs = backgroundColors(img)
  if (!bgs.length) return []
  const lab = img.lab
  const mask = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p++) {
    const i = p * 3
    let near = false
    for (const bg of bgs) {
      const dc = Math.hypot(lab[i + 1] - bg.a, lab[i + 2] - bg.b)
      const dl = lab[i] - bg.L
      if (dc < 12 && dl < 12 && dl > -22) {
        near = true
        break
      }
    }
    if (!near) mask[p] = 1
  }
  // 가장자리를 2픽셀 깎아(침식) 볼륨에 가늘게 붙은 같은 색 홀드·그림자 연결을 끊음
  let m = open3(mask, w, h)
  for (let it = 0; it < 2; it++) {
    const e = new Uint8Array(w * h)
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x
        e[p] = m[p] && m[p - 1] && m[p + 1] && m[p - w] && m[p + w] ? 1 : 0
      }
    m = e
  }
  const label = new Int32Array(w * h)
  const blobs = []
  const stack = []
  const close = (p, q) => Math.hypot(0.5 * (lab[p * 3] - lab[q * 3]), lab[p * 3 + 1] - lab[q * 3 + 1], lab[p * 3 + 2] - lab[q * 3 + 2]) < 9
  for (let start = 0; start < w * h; start++) {
    if (!m[start] || label[start]) continue
    const id = blobs.length + 1
    const b = { id, area: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, x0: w, x1: 0, y0: h, y1: 0, tx: 0, bx: 0, ly: 0, ry: 0 }
    label[start] = id
    stack.push(start)
    while (stack.length) {
      const p = stack.pop()
      const x = p % w
      const y = (p / w) | 0
      b.area++
      b.sx += x
      b.sy += y
      b.sxx += x * x
      b.syy += y * y
      b.sxy += x * y
      if (x < b.x0) (b.x0 = x), (b.ly = y)
      if (x > b.x1) (b.x1 = x), (b.ry = y)
      if (y < b.y0) (b.y0 = y), (b.tx = x)
      if (y > b.y1) (b.y1 = y), (b.bx = x)
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
        if (q >= 0 && m[q] && !label[q] && close(p, q)) (label[q] = id), stack.push(q)
    }
    blobs.push(b)
  }
  const out = []
  for (const b of blobs) {
    if (b.area < w * h * 0.004 || b.area > w * h * 0.2) continue
    const bw = b.x1 - b.x0 + 1
    // 사진 테두리에 닿은 덩어리(천장 구조물, 바닥, 매트)와 아주 넓은 덩어리는 제외
    if (bw > 0.6 * w || b.x0 <= 2 || b.y0 <= 2 || b.x1 >= w - 3 || b.y1 >= h - 3) continue
    const sh = polygonShape(label, b, w)
    if (dbg) dbg.push({ x: b.sx / b.area / w, y: b.sy / b.area / h, area: b.area / (w * h), verts: sh.verts, solidity: sh.solidity, fit: sh.fit, poly: sh.poly?.map(([x, y]) => [x / w, y / h]) })
    if (!isPolygonVolume(sh)) continue
    out.push(toHold(b, w, h, true))
  }
  return out
}

// 외부 검출기(Roboflow 등)가 준 홀드 상자 중 루트 색인 것만 고름: 상자 가운데 70% 안에서 그 색 픽셀이 25% 이상
export function filterByTarget(img, holds, target, minFrac = 0.25) {
  const { w, h } = img
  return holds.filter((hd) => {
    const b = hd.box
    const cx = ((b.x0 + b.x1) / 2) * w
    const cy = ((b.y0 + b.y1) / 2) * h
    const rx = ((b.x1 - b.x0) / 2) * w * 0.7
    const ry = ((b.y1 - b.y0) / 2) * h * 0.7
    let n = 0
    let m = 0
    for (let y = Math.max(0, Math.round(cy - ry)); y <= Math.min(h - 1, Math.round(cy + ry)); y++)
      for (let x = Math.max(0, Math.round(cx - rx)); x <= Math.min(w - 1, Math.round(cx + rx)); x++) {
        n++
        if (matches(img, y * w + x, target, 1)) m++
      }
    return n > 0 && m / n >= minFrac
  })
}

export const __internals = { findBlobs, isHold, matches, polygonShape }
