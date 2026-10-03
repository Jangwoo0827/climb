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
    (avoid ? Math.min(0.15, distSeg(c, avoid[0], avoid[1])) - (distSeg(c, avoid[0], avoid[1]) < 0.035 ? 1 : 0) : 0) + ((c.x - base.x) * side > 0 ? 0.03 : 0) + (base.y - c.y) * down - (down < 0.5 && (c.y < Math.min(a.y, b.y) - 0.03 || c.y > a.y + 0.01) ? 1 : 0) - // 무릎은 발보다 아래, 엉덩이보다 위로 가지 않음
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
        elL: joint(shL, hl, arm / 2, arm / 2, -1, torsoSeg),
        elR: joint(shR, hr, arm / 2, arm / 2, 1, torsoSeg),
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
    const pts = [holds[L], holds[R]].map((h) => ({ x: h.mx, y: h.my })).sort((a, b) => a.x - b.x)
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

        // 발 후보: 손이 잡지 않은 홀드, 벽에 밀착(스미어). 바닥에는 딛지 않으므로 모두 바닥에서 FOOT_CLEAR 이상 위에 있음
        const feet = []
        holds.forEach((h) => {
          if (h.id === L || h.id === R) return
          const p = { x: h.mx, y: h.my }
          const d = dist(p, hip)
          if (p.y < FOOT_CLEAR) return // 바닥에 닿는 낮은 홀드는 제외
          if (d > 0.95 * leg || d < near * leg || p.y > hip.y - 0.3 * leg) return // 너무 멀거나, 너무 가깝거나(무릎이 접힘), 엉덩이 근처보다 높은 홀드
          // 볼륨은 발판이 넓어 안정적이라 조금 유리하게 침
          feet.push({ p, c: ((d - 0.82 * leg) / leg) ** 2 * 4 + (p.y > hip.y - 0.25 * leg ? 0.3 : 0) - (h.type === 'volume' ? 0.25 : 0), id: h.id })
        })
        for (const s of [-1, 1]) {
          // 낮은 자리에서는 바닥에서 띄운 높이(FOOT_CLEAR)의 벽면에 발을 붙임
          const p = { x: hx + s * 0.17 * heightM, y: Math.max(FOOT_CLEAR, hy - 0.78 * leg) }
          if (dist(p, hip) <= 0.98 * leg && dist(p, hip) >= near * leg) feet.push({ p, c: 2.5, id: null }) // 벽면 스미어는 홀드가 없을 때만: 크게 불리
        }
        // 삼각형 기본자세: 두 발을 넓게 벌려 밑변을 만들고 엉덩이(무게중심)가 그 밑변 위에 오게 하는 발 조합을 고름
        feet.sort((a, b) => a.c - b.c)
        const cand = feet.slice(0, 10)
        let f1 = null
        let f2 = null
        let footCost = Infinity
        for (let i = 0; i < cand.length; i++)
          for (let j = i + 1; j < cand.length; j++) {
            const a = cand[i]
            const b = cand[j]
            const spread = Math.abs(a.p.x - b.p.x)
            if (dist(a.p, b.p) < 0.16 * heightM) continue // 두 발이 한 점에 모이지 않게
            let c = a.c + b.c
            c += ((spread - 0.35 * heightM) / heightM) ** 2 * 30 // 밑변 너비: 키의 35% 정도
            if (spread > 0.6 * heightM) c += 4 // 다리를 일자로 찢는 자세는 거의 불가능
            const lo = Math.min(a.p.x, b.p.x)
            const hi = Math.max(a.p.x, b.p.x)
            if (hx < lo || hx > hi) c += 3 + (Math.min(Math.abs(hx - lo), Math.abs(hx - hi)) / torso) * 6 // 무게중심이 밑변 밖이면 크게 감점
            if (c < footCost) {
              footCost = c
              f1 = a
              f2 = b
            }
          }
        if (!f1) continue
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
            if (d > 0.97 * arm) cost += 40 * ((d - 0.97 * arm) / arm + 0.05)
            else cost += ((d - target * arm) / arm) ** 2 * 3
            if (wrong(h)) cost += 4 // 손이 가슴 앞이나 반대편이면 팔이 몸에 걸림
            // 실제 팔꿈치 위치를 계산해 위로 꺾이거나(치킨 윙) 몸통에 닿으면 감점
            const sh = { x: S.x + dx, y: S.y }
            const el = joint(sh, h, arm / 2, arm / 2, dx < 0 ? -1 : 1, [S, hip])
            if (el.y > Math.max(sh.y, h.y) + 0.02) cost += 3
            if (distSeg(el, S, hip) < 0.04) cost += 3
            if (h.y < S.y) cost += ((S.y - h.y) / arm) ** 2 * 6 // 손이 어깨 아래면 몸을 낮춰 손을 어깨 높이 근처로
          }

          cost += ((hx - fx) / torso) ** 2 * 1.2 // 체중이 발 위에 실리도록
          const footY = Math.min(f1.p.y, f2.p.y)
          cost += Math.max(0, 0.7 * leg - (hy - footY)) / leg * 4 // 엉덩이가 발에 너무 내려앉으면(웅크림) 감점: 다리를 펴서 섬
          cost += ((hx - mid.x) / torso) ** 2 * 0.3
          cost += (lean / torso) ** 2 * 0.5
          if (prev) cost += 1.5 * dist(hip, prev) ** 2

          if (!best || cost < best.cost) best = { cost, hip, S, f1, f2 }
        }
      }
    }
    // 손이 아주 낮거나 팔이 닿지 않는 자세밖에 없으면 조건을 완화해 다시 찾음
    if ((!best || best.cost >= 40) && relax < 1) {
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
      elL: joint(shL, hl, arm / 2, arm / 2, -1, torsoSeg),
      elR: joint(shR, hr, arm / 2, arm / 2, 1, torsoSeg),
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
