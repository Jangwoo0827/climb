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
// grips: [{ type, hold: {mx, my, rx, ry, depth, base} }, ...] — 이전·다음 자세에서 손이 잡은 홀드들.
// 손마다 지금 위치에서 가장 가까운 것의 잡는 자리에 놓음(동작 사이에 잡기 정보가 바뀌어도 손이 튀지 않게)
// anchors: 이전·다음 자세의 2D 관절 좌표들. 손발이 그 자리 근처면 홀드를 잡은(디딘) 것, 멀면 공중에서 움직이는 중
export function pose3d(p, heightM, feetInfo, grips = null, anchors = null) {
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
  // - 손이 그 홀드에 가까울수록만 적용(15cm 밖 0 → 3cm 안 1): 다른 홀드로 옮기는 도중 손이 툭 튀지 않게
  // - 팔 길이(위팔+아래팔) 밖이면 어깨에서 팔을 다 편 거리까지만: 팔이 늘어나 보이지 않게
  for (const [side, key, shK, elK] of [['L', 'hl', 'shL', 'elL'], ['R', 'hr', 'shR', 'elR']]) {
    // 후보 홀드마다 '홀드 중심 → 잡는 손목 자리' 보정량을 거리 제곱의 역수 비율로 섞음:
    // 홀드 위에 있으면 그 홀드 보정 100%, 옮겨 가는 동안은 이전·새 홀드 보정이 이동한 만큼 연속적으로 바뀜(문턱이 없어 튀지 않음)
    const cand = []
    for (const c of Array.isArray(grips) ? grips : Object.values(grips ?? {})) {
      if (!c?.hold || cand.some((o) => o.c.hold.mx === c.hold.mx && o.c.hold.my === c.hold.my)) continue
      const d = Math.hypot(p[key].x - c.hold.mx, p[key].y - c.hold.my)
      cand.push({ c, d, iw: 1 / (d * d + 1e-4), fr: gripFrame(c.type, c.hold, p.hip.x, heightM) })
    }
    if (!cand.length) continue
    const sumIw = cand.reduce((a, o) => a + o.iw, 0)
    const cur = P[key]
    const target = { ...cur }
    const fv = { x: 0, y: 0, z: 0 }
    const nv = { x: 0, y: 0, z: 0 }
    for (const o of cand) {
      const k = o.iw / sumIw
      target.x += (o.fr.wrist.x - o.c.hold.mx) * k
      target.y += (o.fr.wrist.y - o.c.hold.my) * k
      target.z += (o.fr.wrist.z - cur.z) * k
      for (const ax of ['x', 'y', 'z']) {
        fv[ax] += o.fr.f[ax] * k
        nv[ax] += o.fr.n[ax] * k
      }
    }
    // 손 모양(손가락 굽힘 방향)은 가장 가까운 홀드에 15cm 안으로 다가갈수록 잡는 모양으로
    const dmin = Math.min(...cand.map((o) => o.d))
    const w = Math.min(1, Math.max(0, (0.15 - dmin) / 0.12))
    P[key] = target
    // 관절 좌표 목록(Object.entries 등)에는 안 잡히게: 손 방향은 좌표가 아님. w로 기본 방향과 섞음(hand.js)
    Object.defineProperty(P, side === 'L' ? 'gripL' : 'gripR', { value: { f: fv, n: nv, w }, enumerable: false })
  }
  const smear = (side) => feetInfo?.find((f) => f.side === side)?.id === null
  P.footL = at(p.footL, smear('L') ? 0 : 0.03) // 벽 밀기는 발끝이 벽면에 바로
  P.footR = at(p.footR, smear('R') ? 0 : 0.03)
  // 팔다리 길이 맞추기: 몸을 벽에서 띄운 만큼 정면 그림보다 실제 거리가 길어져, 거의 편 팔다리는 닿지 않음
  // - 홀드를 잡은(디딘) 손발: 손발은 그 자리에 두고 몸(골반·어깨)을 벽 쪽으로 붙임(팔다리를 펴면 몸이 벽에 붙는 것과 같음)
  // - 공중에서 움직이는 손발: 손발 끝을 팔다리를 다 편 거리까지만 보냄
  //   잡았는지는 손발이 이전·다음 자세의 자기 자리에서 떨어진 거리(3cm 안 1 → 10cm 밖 0)로 부드럽게
  const attach = (k) => {
    if (!anchors?.length) return 1
    const d = Math.min(...anchors.map((a) => (a?.[k] ? Math.hypot(p[k].x - a[k].x, p[k].y - a[k].y) : Infinity)))
    return Math.min(1, Math.max(0, (0.1 - d) / 0.07))
  }
  const limbs = [['hipL', 'kneeL', 'footL'], ['hipR', 'kneeR', 'footR'], ['shL', 'elL', 'hl'], ['shR', 'elR', 'hr']]
  // 팔다리 길이는 실제 뼈 길이(자세 그림의 위팔+아래팔): 애니메이션 중 정면 그림은 팔꿈치가 돌아가며 잠깐 짧아 보일 수 있어 쓰지 않음
  const ref = anchors?.[0] ?? p
  const boneLen = (rootK, jointK, endK) => (d2(ref[rootK], ref[jointK]) + d2(ref[jointK], ref[endK])) * 0.998
  for (const [rootK, jointK, endK] of limbs) {
    const L = boneLen(rootK, jointK, endK)
    const r = P[rootK]
    const e = P[endK]
    const dxy = Math.hypot(r.x - e.x, r.y - e.y)
    const dz = Math.sqrt(Math.max(0, L * L - dxy * dxy))
    if (r.z - e.z > dz) r.z += (Math.max(0.03, e.z + dz) - r.z) * attach(endK)
  }
  for (const [rootK, jointK, endK] of limbs) {
    const L = boneLen(rootK, jointK, endK)
    const r = P[rootK]
    const e = P[endK]
    const d = Math.hypot(e.x - r.x, e.y - r.y, e.z - r.z)
    if (d <= L) continue
    const k = L / d
    P[endK] = { x: r.x + (e.x - r.x) * k, y: r.y + (e.y - r.y) * k, z: r.z + (e.z - r.z) * k }
  }
  P.hip.z = (P.hipL.z + P.hipR.z) / 2
  P.neck.z = (P.shL.z + P.shR.z) / 2
  P.head.z = P.neck.z + 0.03 * heightM
  // 그림에서 꺾인 방향(2D) + 바깥쪽(z+): 무릎은 벽 밖으로 크게, 팔꿈치는 조금
  const limb = (rootK, jointK, endK, out) => {
    const l1 = d2(ref[rootK], ref[jointK])
    const l2 = d2(ref[jointK], ref[endK])
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
