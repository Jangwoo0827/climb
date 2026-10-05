// 3D 벽: 사진 위에 지정한 벽 면들(사각형, 실제로는 직사각형이라고 가정)로 꺾인 벽의 실제 모양을 복원한다.
// - 면마다 사진 속 사각형 → 원근 분석(호모그래피 분해)으로 그 면이 3D에서 향하는 방향(법선)을 구함
// - 이웃 면이 공유하는 모서리가 3D에서 같은 점이 되도록 면마다 카메라와의 거리를 맞춤
// - 가장 큰 면을 정면(벽 = z 0, 위쪽 = y)으로 세우고, 전체 폭을 벽 너비에 맞춤
// 좌표: 사진 좌표(u, v: 0~1, v는 아래로 +) ↔ 기존 평면 벽 좌표(mx = u·벽너비, my = (1 − v)·벽높이) ↔ 3D 월드(m)
import { homography } from './rectify.js'

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const addv = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s })
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const len = (a) => Math.hypot(a.x, a.y, a.z)
const norm = (a) => {
  const l = len(a) || 1
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}

// faces: [[{x,y}x4] 정규화, 왼쪽 위부터 시계 방향], aspect: 사진 가로/세로, wallW: 벽 너비(m)
// focal: 초점거리 / 사진 긴 변(폰 기본 카메라 약 0.75)
export function buildWall3D(faces, aspect, wallW, focal = 0.75) {
  if (!faces?.length) return null
  // 카메라 좌표: 사진 중심이 원점, x 오른쪽, y 아래, z 앞(사진 안쪽). 단위는 사진 긴 변 = 1
  const W = aspect >= 1 ? 1 : aspect
  const H = aspect >= 1 ? 1 / aspect : 1
  const f = focal
  const ray = (p) => norm({ x: (p.x - 0.5) * W / f, y: (p.y - 0.5) * H / f, z: 1 })
  const F = faces.map((q) => {
    const img = q.map((p) => ({ x: (p.x - 0.5) * W, y: (p.y - 0.5) * H }))
    const Hm = homography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], img)
    // K⁻¹·H 의 첫째·둘째 열 = 면의 가로·세로 방향(크기는 실제 변 길이에 비례)
    const a = { x: Hm[0] / f, y: Hm[3] / f, z: Hm[6] }
    const b = { x: Hm[1] / f, y: Hm[4] / f, z: Hm[7] }
    let n = norm(cross(a, b))
    const center = ray({ x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 })
    if (dot(n, center) > 0) n = { x: -n.x, y: -n.y, z: -n.z } // 법선은 카메라 쪽(면 앞쪽)
    const area = Math.abs((img[2].x - img[0].x) * (img[3].y - img[1].y) - (img[3].x - img[1].x) * (img[2].y - img[0].y)) / 2
    return { q, n, d: null, area }
  })
  // 거리 맞추기: 가장 큰 면을 거리 1로 두고, 공유 모서리를 따라 이웃 면 거리를 정함(평면: n·X + d = 0, X = s·ray)
  const main = F.reduce((bi, fc, i) => (fc.area > F[bi].area ? i : bi), 0)
  const planeDepth = (fc, r) => -fc.d / dot(fc.n, r) // ray r 위에서 면까지의 거리 s
  // 정면: 사진 가운데 시선이 거리 1에서 면과 만나게(n·X + d = 0 → d = −n·ray)
  F[main].d = -dot(F[main].n, ray({ x: 0.5, y: 0.5 }))
  const same = (p, o) => Math.abs(p.x - o.x) < 1e-6 && Math.abs(p.y - o.y) < 1e-6
  let changed = true
  while (changed) {
    changed = false
    F.forEach((fc) => {
      if (fc.d !== null) return
      const est = []
      for (const known of F) {
        if (known.d === null) continue
        for (const p of fc.q)
          if (known.q.some((o) => same(p, o))) {
            const r = ray(p)
            const s = planeDepth(known, r)
            est.push(-dot(fc.n, { x: r.x * s, y: r.y * s, z: r.z * s }))
          }
      }
      if (est.length) {
        fc.d = est.reduce((x, y) => x + y, 0) / est.length
        changed = true
      }
    })
  }
  // 이웃이 없어 거리를 못 정한 면: 정면과 같은 거리로
  F.forEach((fc) => {
    if (fc.d === null) fc.d = F[main].d
  })
  // 사진 좌표 → 카메라 3D(그 면 평면과 시선의 교점)
  const camPoint = (fc, p) => {
    const r = ray(p)
    const s = planeDepth(fc, r)
    return { x: r.x * s, y: r.y * s, z: r.z * s }
  }
  // 월드 축: 정면의 가로 방향 = x, 법선 = z(벽 밖), 그 둘의 수직 = y(위)
  const mq = F[main].q
  const ex = norm(sub(camPoint(F[main], mq[1]), camPoint(F[main], mq[0])))
  const ez = F[main].n
  let ey = cross(ez, ex)
  if (ey.y > 0) ey = { x: -ey.x, y: -ey.y, z: -ey.z } // 카메라 y는 아래가 +, 월드 y는 위가 +
  const ex2 = norm(cross(ey, ez))
  const toWorld0 = (c) => ({ x: dot(c, ex2), y: dot(c, ey), z: dot(c, ez) })
  // 크기: 모든 면 모서리의 가로 폭을 벽 너비에 맞춤. 위치: 정면 왼쪽 위 모서리가 평면 벽에서의 자리와 같게
  const all = F.flatMap((fc) => fc.q.map((p) => toWorld0(camPoint(fc, p))))
  const minX = Math.min(...all.map((p) => p.x))
  const maxX = Math.max(...all.map((p) => p.x))
  const k = wallW / Math.max(1e-6, maxX - minX)
  const wallH = wallW / aspect
  const tl = toWorld0(camPoint(F[main], mq[0]))
  const off = { x: mq[0].x * wallW - tl.x * k, y: (1 - mq[0].y) * wallH - tl.y * k, z: -tl.z * k }
  const toWorld = (c) => {
    const w = toWorld0(c)
    return { x: w.x * k + off.x, y: w.y * k + off.y, z: w.z * k + off.z }
  }
  const nWorld = (n) => norm({ x: dot(n, ex2), y: dot(n, ey), z: dot(n, ez) })
  const inside = (p, q) => {
    let inn = false
    for (let i = 0, j = 3; i < 4; j = i++)
      if (q[i].y > p.y !== q[j].y > p.y && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inn = !inn
    return inn
  }
  // 사진 좌표가 속한 면(없으면 가장 가까운 면 중심)
  const faceOf = (p) => {
    const hit = F.find((fc) => inside(p, fc.q))
    if (hit) return hit
    let best = F[main]
    let bd = Infinity
    for (const fc of F) {
      const cx = (fc.q[0].x + fc.q[1].x + fc.q[2].x + fc.q[3].x) / 4
      const cy = (fc.q[0].y + fc.q[1].y + fc.q[2].y + fc.q[3].y) / 4
      const d = Math.hypot(p.x - cx, p.y - cy)
      if (d < bd) (bd = d), (best = fc)
    }
    return best
  }
  // 평면 벽 좌표(mx, my)와 벽에서 떨어진 거리 z → 3D 월드 점과 그 자리의 면 법선
  const map = (mx, my, z = 0) => {
    const p = { x: mx / wallW, y: 1 - my / wallH }
    const fc = faceOf(p)
    const w = toWorld(camPoint(fc, p))
    const n = nWorld(fc.n)
    return { p: addv(w, n, z), n }
  }
  // 그리기용: 면마다 사진 좌표 격자(seg×seg)와 그 3D 점
  const meshes = F.map((fc) => {
    const seg = 12
    const verts = []
    const uvs = []
    for (let j = 0; j <= seg; j++)
      for (let i = 0; i <= seg; i++) {
        const s = i / seg
        const t = j / seg
        const top = { x: fc.q[0].x + (fc.q[1].x - fc.q[0].x) * s, y: fc.q[0].y + (fc.q[1].y - fc.q[0].y) * s }
        const bot = { x: fc.q[3].x + (fc.q[2].x - fc.q[3].x) * s, y: fc.q[3].y + (fc.q[2].y - fc.q[3].y) * s }
        const p = { x: top.x + (bot.x - top.x) * t, y: top.y + (bot.y - top.y) * t }
        verts.push(toWorld(camPoint(fc, p)))
        uvs.push({ u: p.x, v: 1 - p.y })
      }
    return { seg, verts, uvs, n: nWorld(fc.n) }
  })
  const floorY = Math.min(...meshes.flatMap((m) => m.verts.map((v) => v.y)))
  return { map, meshes, floorY, mainIndex: main }
}

// 면 하나 옆에 이어 붙일 새 면(공유하는 변은 같은 점): dir = 'right' | 'left' | 'up' | 'down'
export function adjacentFace(q, dir) {
  const [tl, tr, br, bl] = q
  const c = (p) => ({ ...p })
  const clamp = (v) => Math.min(1, Math.max(0, v))
  if (dir === 'right') {
    const w = Math.max(0.08, Math.min(0.3, 1 - Math.max(tr.x, br.x)))
    return [tr, { x: clamp(tr.x + w), y: tr.y }, { x: clamp(br.x + w), y: br.y }, br].map(c)
  }
  if (dir === 'left') {
    const w = Math.max(0.08, Math.min(0.3, Math.min(tl.x, bl.x)))
    return [{ x: clamp(tl.x - w), y: tl.y }, tl, bl, { x: clamp(bl.x - w), y: bl.y }].map(c)
  }
  if (dir === 'up') {
    const h = Math.max(0.08, Math.min(0.3, Math.min(tl.y, tr.y)))
    return [{ x: tl.x, y: clamp(tl.y - h) }, { x: tr.x, y: clamp(tr.y - h) }, tr, tl].map(c)
  }
  const h = Math.max(0.08, Math.min(0.3, 1 - Math.max(bl.y, br.y)))
  return [bl, br, { x: br.x, y: clamp(br.y + h) }, { x: bl.x, y: clamp(bl.y + h) }].map(c)
}
