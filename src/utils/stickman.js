// 추천 경로의 한 단계에서 사용자의 몸이 어떤 자세인지 졸라맨 관절 좌표(미터, y는 위쪽이 +)로 만든다.
// 손은 홀드에 고정하고, 엉덩이 위치와 상체 기울기를 격자로 탐색해 "팔은 적당히 펴고, 발은 바닥이나 홀드에 올려
// 무릎을 굽히고, 체중이 발 위에 실리는" 자세를 고른다. 사진 맨 아래(y=0)는 바닥이고, 시작 이후 발은 바닥에 닿지 않는다.
// 손은 항상 엉덩이(허리)보다 위에 있어야 하고, 동작 이름(플래깅, 드롭니, 락오프 등)에 따라 자세가 달라진다.

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// 점 p에서 선분 a-b까지의 거리
function distSeg(p, a, b) {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy || 1e-9
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2))
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t))
}

// 두 마디(길이 l1, l2)로 a에서 b까지 이어지는 관절 위치 후보 2개 중 하나를 고른다.
// avoid가 있으면 그 선분(몸통)에서 더 먼 쪽을 고르고, 비슷하면 side(-1 왼쪽, +1 오른쪽) 쪽을 고른다.
// 팔꿈치: 어깨-손을 잇는 선의 아래쪽으로만 꺾음(위로 드는 치킨 윙 금지). 몸통에 닿는 자세는 몸 위치 쪽에서 감점해 피함
function elbow(sh, hand, l) {
  const c = joint(sh, hand, l, l, 1, null, 0)
  const full = dist(sh, hand) || 1e-6
  const d = Math.min(full, 2 * l - 1e-6)
  const ux = (hand.x - sh.x) / full
  const uy = (hand.y - sh.y) / full
  const along = d / 2
  const base = { x: sh.x + ux * along, y: sh.y + uy * along }
  const mirror = { x: 2 * base.x - c.x, y: 2 * base.y - c.y }
  return c.y <= mirror.y ? c : mirror
}

function joint(a, b, l1, l2, side, avoid, down = 0.8) {
  const full = dist(a, b) || 1e-6
  const d = Math.min(full, l1 + l2 - 1e-6)
  const ux = (b.x - a.x) / full
  const uy = (b.y - a.y) / full
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along))
  const base = { x: a.x + ux * along, y: a.y + uy * along }
  const c1 = { x: base.x - uy * h, y: base.y + ux * h }
  const c2 = { x: base.x + uy * h, y: base.y - ux * h }
  // 몸통에서 멀고, 아래로 처지는 쪽(사람 팔꿈치·무릎은 위로 꺾이지 않음)을 고름
  const score = (c) =>
    (avoid ? Math.min(0.15, distSeg(c, avoid[0], avoid[1])) - (distSeg(c, avoid[0], avoid[1]) < 0.035 ? 1 : 0) : 0) + ((c.x - base.x) * side > 0 ? 0.03 : 0) + (base.y - c.y) * down - (down < 0.5 && (c.y < Math.min(a.y, b.y) - 0.15 || c.y > a.y + 0.01) ? 1 : 0) - // 무릎은 발보다 아래, 엉덩이보다 위로 가지 않음
     (c.y < 0 ? 5 : 0)
  return score(c1) >= score(c2) ? c1 : c2
}

const HAND_MARGIN = 0.05 // 손은 엉덩이보다 최소 이만큼(m) 위에 있어야 함
const FOOT_CLEAR = 0.1 // 등반이 시작되면 발은 바닥에 닿지 않고 바닥에서 최소 이만큼(m) 위의 벽/홀드에 있어야 함

// route: findRoute 결과, holds: 미터 단위 홀드, body: bodyModel 결과, heightM: 키(m)
// stepIndex: 몇 번째 동작을 마친 뒤의 자세인지 (-1이면 출발 자세)
// phase: 'jump'이면 stepIndex번째 동작(점프)의 공중 자세를 만든다
export function figureAt(route, holds, body, heightM, stepIndex, phase = 'land') {
  const sw = 0.23 * heightM // 어깨너비
  const arm = Math.max(0.3, (body.span - sw) / 2) // 팔 전체 길이
  const torso = 0.3 * heightM
  const leg = 0.47 * heightM

  // 점프의 정점: 발이 벽에서 떨어지고, 몸을 쭉 펴서 목표 홀드를 향해 두 팔을 뻗는 자세
  if (phase === 'jump') {
    let L = route.startL
    let R = route.startR
    for (let i = 0; i < stepIndex; i++) {
      const st = route.steps[i]
      if (st.dyno) L = R = st.to
      else if (st.hand === 'L') L = st.to
      else R = st.to
    }
    const st = route.steps[stepIndex]
    const from = holds[L].my <= holds[R].my ? holds[L] : holds[R] // 낮은 쪽 홀드에서 도약
    const T = holds[st.to]
    const tp = { x: T.mx, y: T.my }
    // 점프는 양손이 목표 홀드로 함께 뻗음
    const hl = { x: tp.x - 0.06, y: tp.y }
    const hr = { x: tp.x + 0.06, y: tp.y }
    const reach = 0.95 * arm
    // 어깨는 출발 홀드 쪽으로 살짝 기울되, 어느 팔도 늘어나지 않도록 좌우 위치를 조정
    let sx = tp.x + Math.max(-0.12, Math.min(0.12, (from.mx - tp.x) * 0.25))
    for (let pass = 0; pass < 2; pass++) {
      for (const [h, off] of [[hl, -sw / 2], [hr, sw / 2]]) {
        const gap = h.x - (sx + off)
        const lim = 0.85 * reach
        if (Math.abs(gap) > lim) sx += gap - Math.sign(gap) * lim
      }
    }
    // 어깨가 낮을수록 팔이 길어지므로, 두 팔 모두 팔 길이 안에 들어오는 높이(둘 중 더 높은 쪽)로 잡음
    const sy = Math.max(
      hl.y - Math.sqrt(Math.max(0, reach * reach - (hl.x - (sx - sw / 2)) ** 2)),
      hr.y - Math.sqrt(Math.max(0, reach * reach - (hr.x - (sx + sw / 2)) ** 2)),
    )
    const S = { x: sx, y: sy }
    const hip = { x: sx + (from.mx - tp.x) * 0.08, y: sy - torso }
    const shL = add(S, { x: -sw / 2, y: 0 })
    const shR = add(S, { x: sw / 2, y: 0 })
    const hipL = add(hip, { x: -0.05 * heightM, y: 0 })
    const hipR = add(hip, { x: 0.05 * heightM, y: 0 })
    // 무릎을 살짝 굽혀 발을 끌어올린 채 벽에서 떨어져 있음
    const footL = { x: hip.x - 0.09 * heightM, y: Math.max(FOOT_CLEAR, hip.y - 0.66 * leg) }
    const footR = { x: hip.x + 0.09 * heightM, y: Math.max(FOOT_CLEAR, hip.y - 0.66 * leg) }
    const torsoSeg = [S, hip]
    return {
      hands: [L, R],
      airborne: true,
      move: 'dyno',
      feetOnHolds: [],
      feetInfo: [
        { side: 'L', kind: 'air', id: null },
        { side: 'R', kind: 'air', id: null },
      ],
      p: {
        head: { x: S.x, y: S.y + 0.13 * heightM },
        shL, shR,
        elL: elbow(shL, hl, arm / 2),
        elR: elbow(shR, hr, arm / 2),
        hl, hr, hip, hipL, hipR,
        kneeL: joint(hipL, footL, leg / 2, leg / 2, -1, null, 0.05),
        kneeR: joint(hipR, footR, leg / 2, leg / 2, 1, null, 0.05),
        footL, footR,
        neck: { x: S.x, y: S.y },
      },
    }
  }

  // 동작 이름에 따라 팔을 얼마나 펴는지(팔 길이 대비 거리)를 정함
  const armTarget = (move, isMoving) => {
    if (move === 'lockoff') return isMoving ? 0.95 : 0.55 // 한 팔은 굽혀 고정, 다른 팔은 쭉 뻗음
    if (move === 'deadpoint') return isMoving ? 0.97 : 0.8 // 몸을 길게 펴고 정점에서 잡음
    if (move === 'mantle') return isMoving ? 0.5 : 0.85 // 볼륨을 눌러 몸을 밀어 올림: 움직이는 팔은 굽힘
    return 0.92 // 기본: 팔을 거의 곧게 펴서 뼈로 매달림
  }

  // 한 단계의 자세를 푼다. prev: 직전 단계의 엉덩이 위치(자세가 갑자기 튀지 않게 함), opts: {move, movingPt}
  const solve = (L, R, prev, opts, relax = 0) => {
    const near = relax ? 0.35 : 0.6 // 발이 엉덩이에 이보다 가까우면(다리 길이 비율) 무릎이 접혀 부자연스러움
    // 팔이 몸을 가로지르지 않도록 손은 x 순서대로 왼손/오른손으로 배정
    // 매칭(두 손이 한 홀드)이면 손을 홀드 양쪽으로 살짝 벌려 잡음
    const pts = (L === R ? [{ x: holds[L].mx - 0.04, y: holds[L].my }, { x: holds[L].mx + 0.04, y: holds[L].my }] : [holds[L], holds[R]].map((h) => ({ x: h.mx, y: h.my }))).sort((a, b) => a.x - b.x)
    const [hl, hr] = pts
    const mid = { x: (hl.x + hr.x) / 2, y: (hl.y + hr.y) / 2 }
    const minHipY = FOOT_CLEAR + (relax ? 0.25 : 0.45) * leg // 발(바닥에서 띄움)보다 엉덩이가 충분히 높아야 무릎이 엉덩이 위로 접히지 않음
    const handTop = Math.min(hl.y, hr.y) - HAND_MARGIN // 손이 허리보다 위에 있도록 엉덩이의 최대 높이
    let loY = Math.max(minHipY, mid.y - arm - torso)
    let hiY = Math.min(Math.max(loY, mid.y - torso + 0.3), handTop)
    if (hiY < loY) loY = hiY = Math.max(0.05, hiY) // 손이 거의 바닥이면 최대한 낮은 자세
    let best = null

    for (let hx = mid.x - 0.6; hx <= mid.x + 0.6; hx += 0.06) {
      for (let hy = loY; hy <= hiY + 1e-9; hy += 0.05) {
        const hip = { x: hx, y: hy }

        // 발: 먼저 이 엉덩이 위치에서 편한 발 자리(삼각형 밑변)를 정하고,
        // 그 자리 가까이(SNAP 안)에 홀드가 있으면 그 홀드를 딛고, 없으면 그 자리에서 벽을 민다(스미어).
        // 홀드에 맞춰 몸을 접는 대신, 자연스러운 몸 모양을 기준으로 홀드를 고른다.
        const SNAP = 0.3
        const fy = Math.max(FOOT_CLEAR, hy - 0.78 * leg)
        const off = Math.min(0.17 * heightM, 1.1 * (hy - fy))
        const taken = new Set([L, R])
        const pickFoot = (ideal, other) => {
          let best = null
          holds.forEach((h) => {
            if (taken.has(h.id) || h.my < FOOT_CLEAR) return
            const p = { x: h.mx, y: h.my }
            const dd = dist(p, ideal)
            if (dd > SNAP) return
            const d = dist(p, hip)
            if (d > 0.97 * leg || d < near * leg || p.y > hip.y - 0.3 * leg) return
            if (Math.abs(p.x - hip.x) > 1.2 * (hip.y - p.y)) return // 다리를 옆으로 눕히지 않음
            if (other && dist(p, other.p) < 0.16 * heightM) return // 두 발은 골반 너비 이상 벌림
            const c = (dd / SNAP) ** 2 * 0.8 - (h.type === 'volume' ? 0.2 : 0)
            if (!best || c < best.c) best = { p, c, id: h.id }
          })
          if (best) {
            taken.add(best.id)
            return best
          }
          return { p: ideal, c: 2.5, id: null } // 홀드가 없으면 편한 자리에서 벽을 밀어 버팀
        }
        const f1 = pickFoot({ x: hx - off, y: fy })
        const f2 = pickFoot({ x: hx + off, y: fy }, f1)
        const footCost = f1.c + f2.c
        const fx = (f1.p.x + f2.p.x) / 2

        // 상체 기울기: 손 쪽으로 몸을 기울일 수 있음
        for (const lean of [-0.1, -0.05, 0, 0.05, 0.1]) { // 상체는 크게 기울이지 않음
          const S = { x: hx + lean, y: hy + torso }
          let cost = footCost

          // 팔: 동작에 맞는 만큼 펴는 게 좋고, 완전히 뻗는 건 감점. 손이 반대편 어깨 너머면 감점
          for (const [dx, h, wrong] of [
            [-sw / 2, hl, (h0) => h0.x > S.x - sw * 0.2],
            [sw / 2, hr, (h0) => h0.x < S.x + sw * 0.2],
          ]) {
            const isMoving = !!opts?.movingPt && Math.abs(h.x - opts.movingPt.x) < 1e-6 && Math.abs(h.y - opts.movingPt.y) < 1e-6
            const target = armTarget(opts?.move, isMoving)
            const d = dist({ x: S.x + dx, y: S.y }, h)
            if (d > 0.97 * arm) cost += 200 * ((d - 0.97 * arm) / arm + 0.05) // 팔이 닿지 않는 자세는 사실상 금지
            else cost += ((d - target * arm) / arm) ** 2 * 22 // 팔을 곧게 펴고 엉덩이를 내려 뼈로 매달림(팔 힘을 아낌)
            if (wrong(h)) cost += 4 // 손이 가슴 앞이나 반대편이면 팔이 몸에 걸림
            // 실제 팔꿈치 위치를 계산해 위로 꺾이거나(치킨 윙) 몸통에 닿으면 감점
            const sh = { x: S.x + dx, y: S.y }
            const el = elbow(sh, h, arm / 2)
            if (distSeg(el, S, hip) < 0.05) cost += 10 // 팔꿈치가 몸통에 닿으면 이 몸 위치는 쓰지 않음
            if (h.y < S.y) cost += ((S.y - h.y) / arm) ** 2 * 6 // 손이 어깨 아래면 몸을 낮춰 손을 어깨 높이 근처로
          }

          cost += ((hx - fx) / torso) ** 2 * 1.2 // 체중이 발 위에 실리도록
          // 엉덩이를 내려 앉듯이 매달림: 팔을 곧게 폈을 때의 엉덩이 높이보다 높으면 감점
          // 높은 손에 팔을 곧게 펴고 매달렸을 때의 엉덩이 높이가 목표(낮은 손은 굽혀도 됨). 맨틀링만 예외
          const idealHip = Math.max(hl.y, hr.y) - 0.92 * arm - torso
          cost += (Math.max(0, hy - idealHip) / leg) * (opts?.move === 'mantle' ? 2 : 10)
          const footY = Math.min(f1.p.y, f2.p.y)
          cost += Math.max(0, 0.45 * leg - (hy - footY)) / leg * 4 // 엉덩이가 발에 완전히 주저앉는 것만 감점(적당히 낮춘 엉덩이는 안정적)
          cost += ((hx - mid.x) / torso) ** 2 * 0.3
          cost += (lean / torso) ** 2 * 0.5
          if (prev) cost += 1.5 * dist(hip, prev) ** 2

          if (!best || cost < best.cost) best = { cost, hip, S, f1, f2 }
        }
      }
    }
    // 손이 아주 낮거나 팔이 닿지 않는 자세밖에 없으면 조건을 완화해 다시 찾음
    if ((!best || best.cost >= 200) && relax < 1) {
      const alt = solve(L, R, prev, opts, relax + 1)
      if (!best || (alt.cost ?? Infinity) < best.cost) return alt
    }
    return { hl, hr, ...best }
  }

  const optsFor = (i) => {
    const st = route.steps[i]
    return { move: st.move, movingPt: { x: holds[st.to].mx, y: holds[st.to].my } }
  }

  let L = route.startL
  let R = route.startR
  let s = solve(L, R, null, null)
  for (let i = 0; i <= stepIndex; i++) {
    const st = route.steps[i]
    if (st.dyno) L = R = st.to
    else if (st.hand === 'L') L = st.to
    else R = st.to
    s = solve(L, R, s.hip, optsFor(i))
  }
  const st = stepIndex >= 0 ? route.steps[stepIndex] : null
  const move = st?.move ?? null

  const { hl, hr, hip, S } = s
  const shL = add(S, { x: -sw / 2, y: 0 })
  const shR = add(S, { x: sw / 2, y: 0 })
  const hipL = add(hip, { x: -0.05 * heightM, y: 0 })
  const hipR = add(hip, { x: 0.05 * heightM, y: 0 })
  const feet = [{ ...s.f1 }, { ...s.f2 }]
  // 발 매칭이면 같은 홀드 양쪽에 발을 나란히 올림
  if (s.f1 === s.f2) {
    feet[0].p = { x: s.f1.p.x - 0.04, y: s.f1.p.y }
    feet[1].p = { x: s.f1.p.x + 0.04, y: s.f1.p.y }
  }

  // 플래깅: 한 발만 홀드에 딛고, 다른 다리는 이동 반대쪽으로 쭉 뻗어 균형을 잡음
  const dir = st ? Math.sign(st.dx || 1) : 0
  if (move === 'flag') {
    const support = feet.find((f) => f.id !== null) ?? feet[0]
    const other = feet.find((f) => f !== support)
    other.p = { x: hip.x - dir * 0.55 * leg, y: Math.max(FOOT_CLEAR, hip.y - 0.72 * leg) } // 뻗은 다리는 거의 곧게
    other.id = null
    other.flag = true
    // 뻗은 다리가 딛는 발과 겹치지 않게
    if (dist(other.p, support.p) < 0.16 * heightM) other.p = { x: support.p.x - dir * 0.2 * heightM, y: Math.max(FOOT_CLEAR, support.p.y + 0.05) }
  }

  feet.sort((a, b) => a.p.x - b.p.x)
  const [footL, footR] = feet
  const kindOf = (f) => {
    if (f.flag) return 'flag'
    if (s.f1 === s.f2 && f.id !== null) return 'footmatch'
    if (f.id !== null && holds[f.id].type === 'volume') return 'volume'
    if (f.id !== null) return f.p.y > hip.y - 0.3 * leg ? 'heelhook' : 'edging'
    return 'smear'
  }
  const feetInfo = [
    { side: 'L', kind: kindOf(footL), id: footL.id },
    { side: 'R', kind: kindOf(footR), id: footR.id },
  ]

  // 드롭니: 이동하는 쪽 다리의 무릎을 몸 안쪽으로 꺾음
  const dropSide = move === 'dropknee' ? (dir > 0 ? 'R' : 'L') : null
  const torsoSeg = [S, hip]

  return {
    hands: [L, R],
    move,
    feetInfo,
    feetOnHolds: feetInfo.filter((f) => f.id !== null).map((f) => f.id),
    p: {
      head: { x: S.x, y: S.y + 0.13 * heightM },
      shL,
      shR,
      elL: elbow(shL, hl, arm / 2),
      elR: elbow(shR, hr, arm / 2),
      hl,
      hr,
      hip,
      hipL,
      hipR,
      kneeL: joint(hipL, footL.p, leg / 2, leg / 2, dropSide === 'L' ? 1 : -1, null, 0.05),
      kneeR: joint(hipR, footR.p, leg / 2, leg / 2, dropSide === 'R' ? -1 : 1, null, 0.05),
      footL: footL.p,
      footR: footR.p,
      // 어깨선의 중심에서 엉덩이로 이어지는 몸통 (그리기용)
      neck: { x: S.x, y: S.y },
    },
  }
}
