// 애니메이션 컨트롤러: 두 자세 사이를 이어 그린다.
// 구조: (계획된) 목표 → 몸 중심 이동 → 손발 끝 위치 보간 → IK로 팔꿈치·무릎 계산 → 간단한 스프링 물리
// 관절 좌표를 그대로 섞지 않고 매 프레임 IK로 다시 계산하므로, 움직이는 중에도 뼈 길이가 변하지 않는다.

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const lerp = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
const clamp01 = (t) => Math.min(1, Math.max(0, t))
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
// 스프링 같은 몸 이동: 천천히 출발해(속도 0) 끝에서 목표를 살짝(약 4%) 지나쳤다가 자리를 잡음. 체중이 실리는 느낌
export const spring = (t) => {
  const x = t * t * (3 - 2 * t) // 부드러운 출발
  const c1 = 0.6
  return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2
}
const seg = (t, a, b, f = easeInOut) => f(clamp01((t - a) / (b - a)))

const END = { hl: ['shL', 'elL'], hr: ['shR', 'elR'], footL: ['hipL', 'kneeL'], footR: ['hipR', 'kneeR'] }

// 2관절 IK: root에서 end로 길이 l1, l2인 두 마디. 관절 후보 두 개 중 hint에 가까운 쪽(이전·목표 자세에서 꺾이던 방향)을 고름
// end가 닿지 않으면 root에서 end 방향으로 닿는 데까지만 뻗음(뼈 길이 유지)
// bend: -1~1. 부호는 꺾이는 쪽(마디 진행 방향의 왼쪽 +), 크기는 굽힘 정도(1 = 뼈 길이대로 다 굽힘)
// 꺾이는 방향이 바뀔 때는 크기를 줄였다가 넘어감: 실제로는 팔꿈치·무릎을 벽 앞뒤로 돌리는 동작이라 정면에서는 잠깐 펴져 보임
export function ik2(root, end, l1, l2, bend) {
  const full = dist(root, end) || 1e-6
  const reach = Math.min(full, l1 + l2 - 1e-6)
  const ux = (end.x - root.x) / full
  const uy = (end.y - root.y) / full
  const tip = { x: root.x + ux * reach, y: root.y + uy * reach }
  const along = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach)
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along))
  const base = { x: root.x + ux * along, y: root.y + uy * along }
  const hb = h * bend // 진행 방향의 왼쪽(-uy, ux)으로 hb만큼
  const joint = { x: base.x - uy * hb, y: base.y + ux * hb }
  return { joint, tip }
}

// 관절이 마디(root→end)의 어느 쪽으로 꺾였는지: +1 왼쪽, -1 오른쪽
function sideOf(root, joint, end) {
  const c = (end.x - root.x) * (joint.y - root.y) - (end.y - root.y) * (joint.x - root.x)
  return c >= 0 ? 1 : -1
}

// 이번 동작에서 움직이는 손발: 발 먼저(많이 움직이는 발부터), 손은 나중 — 한 번에 하나씩 차례로 옮김
export function moversOf(from, to) {
  const ms = Object.keys(END).map((k) => ({ k, d: dist(from[k], to[k]) })).filter((m) => m.d > 0.03)
  ms.sort((a, b) => (a.k.startsWith('foot') ? 0 : 1) - (b.k.startsWith('foot') ? 0 : 1) || b.d - a.d)
  return ms
}

// from, to: 관절 좌표(stickman.js의 p), t: 0~1
export function blendPose(from, to, t) {
  // 1) 움직이는 손발과 각자의 시간 구간: 여러 개면 0.15~1을 나눠 하나씩(손발 따로)
  const movers = moversOf(from, to)
  const n = movers.length
  const win = {}
  const w = n > 1 ? 0.85 / n : 0.7
  movers.forEach((m, i) => (win[m.k] = n > 1 ? [0.15 + i * w, 0.15 + (i + 1) * w] : [0.3, 1]))
  // 2) 몸 중심(엉덩이·어깨 중심): 스프링으로 살짝 지나쳤다 자리 잡기. 여러 손발이면 마지막 손발이 출발할 무렵까지 몸을 옮김
  const bodyEnd = n > 1 ? win[movers[n - 1].k][0] + w * 0.5 : 0.65
  const tb = n ? clamp01(t / bodyEnd) : t
  const ub = n ? spring(tb) : easeInOut(t)
  const hip = lerp(from.hip, to.hip, ub)
  const neck = lerp(from.neck, to.neck, ub)
  const p = { hip, neck }
  // 골반·어깨·머리도 몸 중심과 같은 속도로 이전 자세에서 목표 자세로(시작·끝이 두 자세와 정확히 맞음)
  for (const k of ['hipL', 'hipR', 'shL', 'shR', 'head']) p[k] = lerp(from[k], to[k], ub)

  // 3) 손발 끝: 움직이는 것은 자기 구간에만 들어 올려 호를 그리며, 나머지는 홀드에 그대로
  const center = { x: (to.hip.x + to.neck.x) / 2, y: (to.hip.y + to.neck.y) / 2 }
  const uOf = {}
  for (const key of Object.keys(END)) {
    if (!win[key]) {
      p[key] = lerp(from[key], to[key], easeInOut(t)) // 거의 움직이지 않음(홀드에 고정)
      continue
    }
    const u = seg(t, win[key][0], win[key][1])
    uOf[key] = u
    const most = dist(from[key], to[key])
    const q = lerp(from[key], to[key], u)
    const lift = Math.sin(Math.PI * u) * Math.min(0.12, 0.25 * most)
    if (key.startsWith('foot')) q.y += lift
    else {
      const ox = q.x - center.x
      const oy = q.y - center.y
      const nn = Math.hypot(ox, oy) || 1
      q.x += (ox / nn) * lift
      q.y += (oy / nn) * lift
    }
    p[key] = q
  }

  // 3.5) 홀드에 붙어 있는 손발(지금 움직이는 것 제외)이 닿는 범위 안에 몸이 있도록 몸 전체를 끌어당김
  // (손발 여러 개를 차례로 옮길 때 몸이 먼저 너무 멀리 가서 딛고 있던 발이 끌려가는 것 방지)
  // 움직이는 중인 손발은 영향이 0, 출발·도착 순간으로 갈수록 부드럽게 1(뚝 끊기지 않게)
  const grip = (k) => (win[k] ? (1 - 2 * uOf[k]) ** 2 : 1)
  for (let it = 0; it < 6; it++) {
    let cx = 0
    let cy = 0
    let wsum = 0
    for (const [end, [rootKey, jointKey]] of Object.entries(END)) {
      const g = grip(end)
      const L = dist(to[rootKey], to[jointKey]) + dist(to[jointKey], to[end]) - 1e-4
      const d = dist(p[rootKey], p[end])
      if (d <= L || g <= 0) continue
      cx += g * ((p[end].x - p[rootKey].x) / d) * (d - L)
      cy += g * ((p[end].y - p[rootKey].y) / d) * (d - L)
      wsum += g
    }
    if (!wsum) break
    const f = 0.5 // 절반씩 여러 번 당겨 여러 손발 사이에서 균형
    for (const k of ['hip', 'neck', 'hipL', 'hipR', 'shL', 'shR', 'head']) p[k] = { x: p[k].x + (cx / wsum) * f, y: p[k].y + (cy / wsum) * f }
  }

  // 4) IK: 팔꿈치·무릎을 매번 다시 계산(뼈 길이는 목표 자세의 길이 그대로)
  for (const [end, [rootKey, jointKey]] of Object.entries(END)) {
    const l1 = dist(to[rootKey], to[jointKey])
    const l2 = dist(to[jointKey], to[end])
    // 꺾이는 방향: 이전·목표 자세가 같은 쪽이면 그대로, 다르면 굽힘을 줄였다가 반대쪽으로 넘어감
    const s0 = sideOf(from[rootKey], from[jointKey], from[end])
    const s1 = sideOf(to[rootKey], to[jointKey], to[end])
    const v = uOf[end] ?? ub
    const bend = s0 === s1 ? s1 : s0 * (1 - v) + s1 * v
    const { joint, tip } = ik2(p[rootKey], p[end], l1, l2, bend)
    p[jointKey] = joint
    p[end] = tip
  }
  return p
}
