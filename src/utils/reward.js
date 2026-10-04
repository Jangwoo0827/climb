// 강화학습 보상 명세(rl/)를 앱의 2D 졸라맨 프레임에 맞게 옮긴 채점기.
// 물리 시뮬레이션이 없으므로 정면 2D 자세로 계산할 수 있는 항목만 쓰고, 하중은 다리 방향으로 어림한다.
// 가중치는 rl/config/rewards.json 과 같은 값(scripts/reward-check.mjs 가 일치 여부를 검사).

export const WEIGHTS = {
  height_gain: 0.5,
  hand_hold_reached: 5.0,
  foot_hold_secured: 2.0,
  time_penalty: -0.01,
  contact_count: 0.2,
  com_support: 0.3,
  leg_load_ratio: 0.3,
  straight_arm_rest: 0.1,
  rom_barrier: 0.5,
  grip_alignment: 0.2,
  toe_precision: 0.1,
}
export const PARAMS = { gamma: 0.99, foot_load_ratio: 0.2, com_k: 5.0, rom_k: 20.0, rom_threshold: 0.9 }
// 2D로 옮기면서 새로 둔 항목(명세에 없음): 프레임 사이 관절 이동량. 같은 결과면 덜 크게 움직이는 쪽(action_rate 대용)
export const EXTRA = { motion: -0.5 }
export const STEPS = 20 // 한 프레임(약 1초) = 시뮬레이션 20스텝(0.05초)으로 보고 매 스텝 항목에 곱함

export const TERM_NAMES = {
  height_gain: '몸 올리기',
  hand_hold_reached: '손 홀드 확보',
  foot_hold_secured: '발 홀드 확보',
  time_penalty: '시간',
  contact_count: '3점 지지',
  com_support: '무게중심 안정',
  leg_load_ratio: '다리로 버티기',
  straight_arm_rest: '팔 펴고 매달리기',
  rom_barrier: '관절 한계',
  grip_alignment: '홀드 방향대로 잡기',
  toe_precision: '발끝으로 딛기',
  motion: '움직임 크기',
}

const DEG = Math.PI / 180
const LIMITS = { elbow: [0, 145 * DEG], knee: [0, 140 * DEG] }
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// 벽에서 몸까지 깊이(정면 2D 그림에는 없음): 골반 약 0.12·키(≈20cm), 어깨 약 0.15·키(≈25cm), 손발은 벽(0).
// 그림에서 발이 엉덩이 바로 밑이어도 실제로는 앞뒤로 떨어져 있어 무릎이 그만큼 접히지 않음
export const HIP_Z = 0.12
export const SHOULDER_Z = 0.15

// 관절 굽힘 각도(0 = 곧게 폄): 두 뼈 길이와, 깊이를 더한 실제 3D 끝점 거리로 코사인 법칙
function flexion(root, mid, end, z) {
  const l1 = d2(root, mid)
  const l2 = d2(mid, end)
  const d = Math.hypot(d2(root, end), z)
  if (d >= l1 + l2) return 0
  return Math.PI - Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2 || 1), -1, 1))
}

// 굽히는 쪽 끝만 장벽(곧게 편 끝은 정상 자세) — rl/climbing_rl/rewards/joint.py 와 같은 규칙
function romBarrier(q, [lo, hi]) {
  const mid = (lo + hi) / 2
  if (q <= mid) return 0
  const x = Math.abs(q - mid) / ((hi - lo) / 2)
  return x > PARAMS.rom_threshold ? Math.exp(PARAMS.rom_k * (x - PARAMS.rom_threshold)) - 1 : 0
}

function hull(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length <= 2) return p
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper = []
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}
function segDist(p, a, b) {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const L = vx * vx + vy * vy
  const t = L ? clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / L, 0, 1) : 0
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t))
}
function distToPolygon(p, pts) {
  const h = hull(pts)
  if (h.length === 1) return d2(p, h[0])
  if (h.length === 2) return segDist(p, h[0], h[1])
  let inside = true
  for (let i = 0; i < h.length; i++) {
    const a = h[i]
    const b = h[(i + 1) % h.length]
    if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0) inside = false
  }
  if (inside) return 0
  return Math.min(...h.map((a, i) => segDist(p, a, h[(i + 1) % h.length])))
}

// 홀드 종류별로 손이 당겨야 하는 방향(손 → 어깨 방향과 비교). 저그 등은 아래로, 언더클링은 위로, 사이드풀은 옆으로
function gripDir(hold, hand, body) {
  if (hold?.type === 'undercling') return { x: 0, y: 1 }
  if (hold?.type === 'sidepull') return { x: hand.x < body.x ? 1 : -1, y: 0 }
  return { x: 0, y: -1 }
}

// 발 하중 어림: 엉덩이 바로 아래로 뻗은 다리일수록 체중을 많이 받음. 벽 밀기(스미어)는 마찰만큼만, 힐훅은 거의 못 받음
function footShares(fig) {
  const { p } = fig
  if (fig.airborne) return [0, 0]
  return [
    [p.footL, fig.feetInfo[0]],
    [p.footR, fig.feetInfo[1]],
  ].map(([f, info]) => {
    const v = clamp((p.hip.y - f.y) / (d2(p.hip, f) || 1), 0, 1) // 다리가 수직에 가까울수록 1
    const k = info.kind === 'smear' ? 0.25 : info.kind === 'heelhook' ? 0.2 : 1
    return 0.45 * v * k
  })
}

// 한 프레임 자세의 매 스텝 항목(원래 값, 가중치 곱하기 전)
export function staticTerms(fig, holds, heightM = 1.7) {
  const { p } = fig
  const zs = SHOULDER_Z * heightM
  const zh = HIP_Z * heightM
  const t = {}
  if (fig.airborne) {
    // 점프 순간: 접촉 없음(명세의 0점 지지는 0, 다이노 판정은 경로 쪽에서 이미 '닿지 않을 때만' 점프)
    return { contact_count: 0, com_support: 0, leg_load_ratio: 0, straight_arm_rest: 0, rom_barrier: 0, grip_alignment: 0, toe_precision: 0 }
  }
  // 손 2 + 발 2(스미어도 벽 접촉)
  t.contact_count = 1
  const com = { x: (p.hip.x * 0.55 + p.neck.x * 0.45), y: p.hip.y * 0.55 + p.neck.y * 0.45 }
  t.com_support = Math.exp(-PARAMS.com_k * distToPolygon(com, [p.hl, p.hr, p.footL, p.footR]))
  t.leg_load_ratio = Math.min(0.9, footShares(fig).reduce((a, b) => a + b, 0))
  const elbows = [flexion(p.shL, p.elL, p.hl, zs), flexion(p.shR, p.elR, p.hr, zs)]
  const knees = [flexion(p.hipL, p.kneeL, p.footL, zh), flexion(p.hipR, p.kneeR, p.footR, zh)]
  t.straight_arm_rest = elbows.reduce((a, q) => a + (1 - clamp(q / LIMITS.elbow[1], 0, 1)), 0) / 2
  t.rom_barrier = -(elbows.reduce((a, q) => a + romBarrier(q, LIMITS.elbow), 0) + knees.reduce((a, q) => a + romBarrier(q, LIMITS.knee), 0))
  const [L, R] = fig.hands
  const handHolds = (p.hl.x <= p.hr.x ? [L, R] : [R, L]).map((id) => holds[id])
  t.grip_alignment = [[p.hl, p.shL, handHolds[0]], [p.hr, p.shR, handHolds[1]]].reduce((a, [h, sh, hold]) => {
    // 손 → 어깨 방향(3D: 어깨는 벽에서 zs만큼 떨어져 있음). 홀드 방향은 벽면(z=0) 안의 벡터
    const f = { x: sh.x - h.x, y: sh.y - h.y }
    const n = Math.hypot(f.x, f.y, zs) || 1
    const g = gripDir(hold, h, p.neck)
    return a + (f.x * g.x + f.y * g.y) / n
  }, 0) / 2
  t.toe_precision = fig.feetInfo.reduce((a, f) => a + (f.id !== null && f.kind !== 'heelhook' ? 1 : 0), 0)
  return t
}

// 프레임 사이 항목: 몸 올리기(포텐셜), 새로 확보한 홀드(홀드별 1회), 움직임 크기
export function transitionTerms(prev, fig, seen, heightM) {
  const t = {}
  t.height_gain = PARAMS.gamma * fig.p.hip.y - prev.p.hip.y
  t.hand_hold_reached = 0
  t.foot_hold_secured = 0
  if (!fig.airborne) {
    for (const id of fig.hands) if (!seen.hands.has(id)) { seen.hands.add(id); t.hand_hold_reached++ }
    const shares = footShares(fig)
    fig.feetInfo.forEach((f, k) => {
      if (f.id !== null && !seen.feet.has(f.id) && shares[k] >= PARAMS.foot_load_ratio) { seen.feet.add(f.id); t.foot_hold_secured++ }
    })
  }
  let m = 0
  for (const k of ['head', 'elL', 'elR', 'hip', 'kneeL', 'kneeR', 'footL', 'footR', 'hl', 'hr']) m += (d2(prev.p[k], fig.p[k]) / heightM) ** 2
  t.motion = m
  t.time_penalty = STEPS
  return t
}

const weightOf = (k) => WEIGHTS[k] ?? EXTRA[k] ?? 0

// 프레임 하나의 보상: 정적 항목 × STEPS + 전이 항목. seen: 이미 보너스를 받은 홀드({hands, feet} Set) — 갱신됨
export function scoreFrame(prev, fig, holds, heightM, seen) {
  const terms = {}
  const st = staticTerms(fig, holds, heightM)
  for (const [k, v] of Object.entries(st)) terms[k] = weightOf(k) * v * STEPS
  if (prev) for (const [k, v] of Object.entries(transitionTerms(prev, fig, seen, heightM))) terms[k] = (terms[k] ?? 0) + weightOf(k) * v
  const total = Object.values(terms).reduce((a, b) => a + b, 0)
  return { total, terms }
}

export const newSeen = (fig) => ({ hands: new Set(fig.hands), feet: new Set(fig.feetOnHolds) })
export const cloneSeen = (s) => ({ hands: new Set(s.hands), feet: new Set(s.feet) })

// 경로 전체 채점: 프레임마다 {total, terms}, 그리고 합계
export function scoreFrames(frames, holds, heightM) {
  if (!frames.length) return { frames: [], total: 0 }
  const seen = newSeen(frames[0].fig)
  const out = frames.map((f, i) => scoreFrame(i ? frames[i - 1].fig : null, f.fig, holds, heightM, seen))
  return { frames: out, total: out.reduce((a, b) => a + b.total, 0) }
}
