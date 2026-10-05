// 2.5D: 벽면(x, y)에서 푼 졸라맨 자세에 벽에서 떨어진 거리 z를 붙인다.
// 손발 끝은 벽(홀드)에 있고, 골반·어깨는 벽 앞에 떠 있다(reward.js의 HIP_Z, SHOULDER_Z와 같은 값).
// 팔꿈치·무릎은 실제 뼈 길이를 지키는 3D 2관절로 다시 계산: 그림의 굽힘 방향 + 벽 바깥쪽으로 꺾임.
import { HIP_Z, SHOULDER_Z } from './reward.js'
import { gripFrame } from './hold3d.js'

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const addS = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s })
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const len = (a) => Math.sqrt(dot(a, a))
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// root에서 end까지 길이 l1, l2 두 마디. hint: 관절이 꺾이고 싶은 방향(3D)
function joint3(root, end, l1, l2, hint) {
  const ax = sub(end, root)
  const d = Math.max(1e-6, len(ax))
  const u = { x: ax.x / d, y: ax.y / d, z: ax.z / d }
  if (d >= l1 + l2) return addS(root, u, l1) // 다 펴도 안 닿으면 곧게(끝은 살짝 덜 닿음)
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along))
  let v = addS(hint, u, -dot(hint, u)) // 축에 수직인 성분
  let n = len(v)
  if (n < 1e-6) {
    v = addS({ x: 0, y: 0, z: 1 }, u, -u.z)
    n = len(v) || 1
  }
  return addS(addS(root, u, along), { x: v.x / n, y: v.y / n, z: v.z / n }, h)
}

// p: stickman.js / animate.js의 2D 관절 좌표(미터), feetInfo: 발이 홀드인지 벽 밀기인지
// grips: { L: { type, hold: {mx, my, rx, ry, depth} }, R: ... } — 잡은 홀드의 종류·크기. 주면 손을 홀드 표면의 잡는 자리에 놓음
export function pose3d(p, heightM, feetInfo, grips = null) {
  const zh = HIP_Z * heightM
  const zs = SHOULDER_Z * heightM
  const at = (q, z) => ({ x: q.x, y: q.y, z })
  const P = {
    head: at(p.head, zs + 0.03 * heightM),
    neck: at(p.neck, zs),
    shL: at(p.shL, zs),
    shR: at(p.shR, zs),
    hip: at(p.hip, zh),
    hipL: at(p.hipL, zh),
    hipR: at(p.hipR, zh),
    hl: at(p.hl, 0.05), // 홀드를 쥔 손(홀드 두께만큼 앞)
    hr: at(p.hr, 0.05),
  }
  // 잡는 자리: 홀드 종류별로 손가락이 닿는 지점에서 손목 위치를 정하고, 손 방향(f, n)도 함께 넘김
  for (const [side, key] of [['L', 'hl'], ['R', 'hr']]) {
    const g = grips?.[side]
    if (!g?.hold) continue
    const fr = gripFrame(g.type, g.hold, p.hip.x, heightM)
    P[key] = fr.wrist
    // 관절 좌표 목록(Object.entries 등)에는 안 잡히게: 손 방향은 좌표가 아님
    Object.defineProperty(P, side === 'L' ? 'gripL' : 'gripR', { value: { f: fr.f, n: fr.n }, enumerable: false })
  }
  const smear = (side) => feetInfo?.find((f) => f.side === side)?.id === null
  P.footL = at(p.footL, smear('L') ? 0 : 0.03) // 벽 밀기는 발끝이 벽면에 바로
  P.footR = at(p.footR, smear('R') ? 0 : 0.03)
  // 그림에서 꺾인 방향(2D) + 바깥쪽(z+): 무릎은 벽 밖으로 크게, 팔꿈치는 조금
  const limb = (rootK, jointK, endK, out) => {
    const l1 = d2(p[rootK], p[jointK])
    const l2 = d2(p[jointK], p[endK])
    const mid = { x: (p[rootK].x + p[endK].x) / 2, y: (p[rootK].y + p[endK].y) / 2 }
    const hint = { x: p[jointK].x - mid.x, y: p[jointK].y - mid.y, z: out * (l1 + l2) * 0.5 }
    P[jointK] = joint3(P[rootK], P[endK], l1, l2, hint)
  }
  limb('shL', 'elL', 'hl', 0.3)
  limb('shR', 'elR', 'hr', 0.3)
  limb('hipL', 'kneeL', 'footL', 0.8)
  limb('hipR', 'kneeR', 'footR', 0.8)
  return P
}

// 사진 위(정면)에 그릴 때 깊이감: 벽에서 먼 점을 살짝 오른쪽 위로(비스듬히 아래-왼쪽에서 올려다본 느낌)
export const OBLIQUE = { x: 0.3, y: 0.18 }
export const project = (q) => ({ x: q.x + q.z * OBLIQUE.x, y: q.y + q.z * OBLIQUE.y })
