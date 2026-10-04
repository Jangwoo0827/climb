// 추천 경로의 한 단계에서 사용자의 몸이 어떤 자세인지 졸라맨 관절 좌표(미터, y는 위쪽이 +)로 만든다.
// 손은 홀드에 고정하고, 엉덩이 위치와 상체 기울기를 격자로 탐색해 "팔은 적당히 펴고, 발은 바닥이나 홀드에 올려
// 무릎을 굽히고, 체중이 발 위에 실리는" 자세를 고른다. 사진 맨 아래(y=0)는 바닥이고, 시작 이후 발은 바닥에 닿지 않는다.
// 손은 항상 엉덩이(허리)보다 위에 있어야 하고, 동작 이름(플래깅, 드롭니, 락오프 등)에 따라 자세가 달라진다.

import { cloneSeen, HIP_Z, newSeen, scoreFrame, SHOULDER_Z, staticTerms } from './reward.js'

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
// 선분 ab와 cd가 서로 가로지르는지(끝점이 닿는 것은 제외)
function segCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}

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
    (avoid ? Math.min(0.15, distSeg(c, avoid[0], avoid[1])) - (distSeg(c, avoid[0], avoid[1]) < 0.035 ? 1 : 0) : 0) + ((c.x - base.x) * side > 0 ? 0.03 : 0) + (base.y - c.y) * down - (down >= 0 && down < 0.5 && (c.y < Math.min(a.y, b.y) - 0.15 || c.y > a.y + 0.01) ? 1 : 0) - // 무릎은 발보다 아래, 엉덩이보다 위로 가지 않음
     (c.y < 0 ? 5 : 0)
  return score(c1) >= score(c2) ? c1 : c2
}

// 팔·다리를 이보다 짧게 접으면(팔/다리 길이 대비 어깨-손, 골반-발 거리) 팔꿈치 145°·무릎 140°를 넘음: 2·sin(35°/2)=0.30, 2·sin(40°/2)=0.34에 여유
const ELBOW_MIN = 0.31
const KNEE_MIN = 0.35
const HAND_MARGIN = 0.05 // 손은 엉덩이보다 최소 이만큼(m) 위에 있어야 함
const FOOT_CLEAR = 0.1 // 등반이 시작되면 발은 바닥에 닿지 않고 바닥에서 최소 이만큼(m) 위의 벽/홀드에 있어야 함

// holds: 미터 단위 홀드, body: bodyModel 결과, heightM: 키(m)
// 자세 계산기: solve(손 홀드 → 몸 위치·발), pose(그리기용 관절), jumpPose(점프 공중 자세)
// 무릎 위치: 원래 고르는 쪽이 손(높은 손)보다 위로 올라가면, 엉덩이-발 선 반대쪽 해(무릎을 옆·아래로)를 씀
function kneeAt(hipP, foot, l, side, down, maxY) {
  const k = joint(hipP, foot, l, l, side, null, down)
  if (k.y <= maxY) return k
  const vx = foot.x - hipP.x
  const vy = foot.y - hipP.y
  const L = vx * vx + vy * vy || 1e-9
  const t = ((k.x - hipP.x) * vx + (k.y - hipP.y) * vy) / L
  const b = { x: hipP.x + vx * t, y: hipP.y + vy * t }
  const m = { x: 2 * b.x - k.x, y: 2 * b.y - k.y }
  return m.y < k.y ? m : k
}

function makeSolver(holds, body, heightM) {
  const sw = 0.23 * heightM // 어깨너비
  const arm = Math.max(0.3, (body.span - sw) / 2) // 팔 전체 길이
  const torso = 0.3 * heightM
  const leg = 0.47 * heightM
  // 하이 스텝: 발을 엉덩이 쪽으로 얼마나 높이 올릴 수 있는지(다리 길이 비율). 유연성은 여기에만 영향을 줌
  const highStep = body.highStep ?? 0.3

  // 점프의 정점: 발이 벽에서 떨어지고, 몸을 쭉 펴서 목표 홀드를 향해 두 팔을 뻗는 자세
  const jumpPose = (L, R, st) => {
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
    // 관절 가동범위(rl/ 보상 명세 4-3): 무릎은 140°까지만 굽힘 → 골반 옆점(hipL/hipR)과 발 사이가 다리의 0.35배 이상
    // 완화 단계(손이 아주 낮은 싯 스타트 등)에서는 조금 더 접는 것을 허용하고, 대신 보상의 관절 한계 항목이 감점함
    const kMin = relax ? 0.25 : KNEE_MIN
    // 거리는 골반의 벽 앞 깊이(HIP_Z)를 더한 실제 3D 거리
    const zh = HIP_Z * heightM
    const kneeOk = (a, b, hip) => {
      const [l, r] = a.p.x <= b.p.x ? [a, b] : [b, a]
      const d3 = (f, hx) => Math.hypot(dist(f.p, { x: hx, y: hip.y }), zh)
      return d3(l, hip.x - 0.05 * heightM) >= kMin * leg && d3(r, hip.x + 0.05 * heightM) >= kMin * leg
    }
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
    // 싯 스타트: 손이 낮아 다리를 펴고 설 수 없으면, 엉덩이를 바닥 가까이 두고 무릎을 가슴 쪽으로 올려 발을 앞 홀드에 올림
    const sit = handTop < FOOT_CLEAR + 0.6 * leg
    if (sit) {
      loY = Math.min(0.2, handTop)
      hiY = Math.max(loY, handTop)
    }
    let best = null

    for (let hx = mid.x - 0.6; hx <= mid.x + 0.6; hx += 0.06) {
      for (let hy = loY; hy <= hiY + 1e-9; hy += 0.05) {
        const hip = { x: hx, y: hy }

        // 발: 편한 발 자리(삼각형 밑변)를 기준으로, 다리를 적당히 편 범위 안의 홀드를 우선 딛고 없으면 벽을 민다(스미어)
        const SNAP = 0.3
        let f1 = null
        let f2 = null
        let footCost = Infinity
        if (opts?.fixedFeet) {
          // 발을 그대로 둔 채 몸만 옮김(손이나 다른 발만 움직이는 프레임)
          f1 = opts.fixedFeet[0]
          f2 = opts.fixedFeet[1]
          const reach = (f) => {
            const d = dist(f.p, hip)
            if (sit) return d <= 0.95 * leg && d >= 0.3 * leg && f.p.y <= hip.y + 0.15 * leg
            // 동작 중간 자세: 무릎을 좀 더 굽혀도 되지만 다리를 옆으로 눕히지는 않음(수직에서 약 55도까지)
            // 아주 완화(3차): 동작 중간 한 순간만 — 무릎을 더 굽히고 다리를 더 옆으로 둬도 됨
            if (opts.loose === 2) return d <= 0.99 * leg && d >= 0.48 * leg && f.p.y <= hip.y - 0.05 * leg && Math.abs(f.p.x - hip.x) <= 1.35 * (hip.y - f.p.y) + 0.02
            if (opts.loose) return d <= 0.97 * leg && d >= 0.5 * leg && f.p.y <= hip.y - 0.15 * leg && Math.abs(f.p.x - hip.x) <= 1.35 * (hip.y - f.p.y) - 0.04
            // 발을 고르는 조건과 같게: 다리를 적당히 펴고(무릎이 접히지 않게), 엉덩이 아래쪽 방향(다리를 눕히지 않게)
            return d <= 0.97 * leg && d >= 0.55 * leg && f.p.y <= hip.y - Math.min(highStep, 0.2) * leg && Math.abs(f.p.x - hip.x) <= 1.2 * (hip.y - f.p.y) - 0.04
          }
          if (!reach(f1) || !reach(f2) || !kneeOk(f1, f2, hip)) continue
          // 두 발 간격: 합발이 아니면 골반 너비 이상, 다리를 찢지 않게
          const fmatch = f1.id !== null && f1.id === f2.id
          if (!fmatch && (dist(f1.p, f2.p) < 0.16 * heightM || Math.abs(f1.p.x - f2.p.x) > 0.58 * heightM)) continue
          // 손 프레임은 무게중심이 두 발 사이(발을 옮기는 도중인 발 프레임은 잠깐 벗어나도 됨)
          if (!opts.footStep && opts.loose !== 1 && !fmatch && !sit && (hx < Math.min(f1.p.x, f2.p.x) - 0.04 || hx > Math.max(f1.p.x, f2.p.x) + 0.04)) continue
          footCost = 0
        } else {
        const fy = sit ? Math.max(FOOT_CLEAR + 0.1, hy) : Math.max(FOOT_CLEAR, hy - 0.78 * leg)
        const off = sit ? 0.2 * heightM : Math.min(0.17 * heightM, 1.1 * (hy - fy))
        // 발 후보: 다리를 적당히 편 거리·엉덩이 아래쪽 방향 안의 홀드 전부 + 편한 자리 두 곳의 벽 밀기(스미어)
        const idealL = { x: hx - off, y: fy }
        const idealR = { x: hx + off, y: fy }
        const cands = [
          { p: idealL, c: 30, id: null }, // 벽 밀기는 밟을 홀드가 정말 없을 때만
          { p: idealR, c: 30, id: null },
        ]
        holds.forEach((h) => {
          if (h.id === L || h.id === R || h.my < FOOT_CLEAR) return
          const p = { x: h.mx, y: h.my }
          const d = dist(p, hip)
          if (sit) {
            // 싯 스타트: 무릎을 올리고 엉덩이 높이 근처의 앞쪽 홀드를 딛음
            if (d > 0.9 * leg || d < 0.3 * leg || p.y > hip.y + 0.15 * leg) return
          } else {
            if (d > 0.97 * leg || d < (relax ? near : 0.68) * leg || p.y > hip.y - highStep * leg) return // 다리를 적당히 편 거리 안(무릎이 접히지 않게), 하이 스텝 높이는 유연성만큼
            if (Math.abs(p.x - hip.x) > 1.2 * (hip.y - p.y)) return // 다리를 옆으로 눕히지 않음
          }
          const dd = Math.min(dist(p, idealL), dist(p, idealR))
          // 직전 단계에 딛던 홀드는 계속 딛는 쪽이 유리: 한 발은 남기고 다른 발만 옮겨 올라감
          const kept = opts?.prevFeet?.includes(h.id) ? 1.5 : 0
          cands.push({ p, c: (dd / SNAP) ** 2 * 0.5 - (h.type === 'volume' ? 0.2 : 0) - kept, id: h.id })
        })
        // 두 발을 짝으로 고름: 서로 겹치지 않고, 무게중심(엉덩이)이 두 발 사이에 오는 조합
        for (let i = 0; i < cands.length; i++)
          for (let j = i; j < cands.length; j++) {
            const a = cands[i]
            const b = cands[j]
            const footMatch = i === j // 합발: 한 홀드에 두 발을 함께 올림
            if (footMatch && a.id === null) continue
            if (!footMatch && dist(a.p, b.p) < 0.16 * heightM) continue
            const lo = Math.min(a.p.x, b.p.x)
            const hi = Math.max(a.p.x, b.p.x)
            // 한 발만 홀드: 다른 발은 편한 자리에서 벽을 밀면 합발보다 자연스러울 때가 있어 비용을 합발과 비슷하게(7)
            const oneFoot = !footMatch && (a.id === null) !== (b.id === null)
            let c = (oneFoot ? (a.id === null ? 7 + b.c : a.c + 7) : a.c + b.c) + (footMatch ? 8 : 0) // 합발은 다른 홀드 두 개를 딛을 수 없을 때만
            if (!footMatch && (hx < lo - 0.04 || hx > hi + 0.04)) continue // 무게중심이 두 발 밖인 조합은 쓰지 않음
            if (!footMatch && hx < lo - 0.03 || (!footMatch && hx > hi + 0.03)) c += 4 + (Math.min(Math.abs(hx - lo), Math.abs(hx - hi)) / torso) * 8
            if (hi - lo > 0.58 * heightM) continue // 다리를 찢는 조합은 쓰지 않음
            if (!kneeOk(a, b, hip)) continue // 무릎을 가동범위 넘게 접는 조합은 쓰지 않음
            if (c < footCost) {
              footCost = c
              f1 = a
              f2 = b
            }
          }
        }
        if (!f1) continue
        const fx = (f1.p.x + f2.p.x) / 2

        // 상체 기울기: 손 쪽으로 몸을 기울일 수 있음
        for (const lean of [-0.1, -0.05, 0, 0.05, 0.1]) { // 상체는 크게 기울이지 않음
          const S = { x: hx + lean, y: hy + torso }
          let cost = footCost
          let reachOk = true
          const armSegs = []
          let maxFlex = 0

          // 팔: 동작에 맞는 만큼 펴는 게 좋고, 완전히 뻗는 건 감점. 손이 반대편 어깨 너머면 감점
          for (const [dx, h, wrong] of [
            [-sw / 2, hl, (h0) => h0.x > S.x - sw * 0.2],
            [sw / 2, hr, (h0) => h0.x < S.x + sw * 0.2],
          ]) {
            const isMoving = !!opts?.movingPt && Math.abs(h.x - opts.movingPt.x) < 1e-6 && Math.abs(h.y - opts.movingPt.y) < 1e-6
            const target = armTarget(opts?.move, isMoving)
            const d = dist({ x: S.x + dx, y: S.y }, h)
            if (d > arm * 0.999) reachOk = false // 팔이 닿지 않는 자세는 고르지 않음
            if (Math.hypot(d, SHOULDER_Z * heightM) < ELBOW_MIN * arm) reachOk = false // 팔꿈치는 145°까지만 굽힘(어깨의 벽 앞 깊이 포함)
            if (d > 0.97 * arm) cost += 200 * ((d - 0.97 * arm) / arm + 0.05)
            else cost += ((d - target * arm) / arm) ** 2 * 30 // 팔을 곧게 펴고 엉덩이를 내려 뼈로 매달림(팔 힘을 아낌)
            if (wrong(h)) cost += 4 // 손이 가슴 앞이나 반대편이면 팔이 몸에 걸림
            // 실제 팔꿈치 위치를 계산해 위로 꺾이거나(치킨 윙) 몸통에 닿으면 감점
            const sh = { x: S.x + dx, y: S.y }
            const el = elbow(sh, h, arm / 2)
            if (distSeg(el, S, hip) < 0.05) reachOk = false // 팔꿈치가 몸통을 뚫는 자세는 쓰지 않음
            armSegs.push([[sh, el], [el, h]])
            // 팔꿈치 굽힘(어깨의 벽 앞 깊이 포함 3D): 0 = 곧게 폄
            const d3 = Math.hypot(d, SHOULDER_Z * heightM)
            const l = arm / 2
            maxFlex = Math.max(maxFlex, d3 >= arm ? 0 : Math.PI - Math.acos(Math.max(-1, Math.min(1, (2 * l * l - d3 * d3) / (2 * l * l)))))
            if (h.y < S.y) cost += ((S.y - h.y) / arm) ** 2 * 6 // 손이 어깨 아래면 몸을 낮춰 손을 어깨 높이 근처로
          }

          // 무릎이 두 손보다 위로 올라가는(스파이더맨) 자세는 쓰지 않음
          {
            const top = Math.max(hl.y, hr.y)
            const [fa, fb] = f1.p.x <= f2.p.x ? [f1, f2] : [f2, f1]
            const kd = sit ? -0.6 : 0.05
            const kl = kneeAt({ x: hip.x - 0.05 * heightM, y: hip.y }, fa.p, leg / 2, -1, kd, top)
            const kr = kneeAt({ x: hip.x + 0.05 * heightM, y: hip.y }, fb.p, leg / 2, 1, kd, top)
            if (Math.max(kl.y, kr.y) > top + 0.02) reachOk = false
          }
          // 두 팔이 서로 겹치는(교차하는) 자세는 쓰지 않음
          if (armSegs[0].some(([a, b]) => armSegs[1].some(([c, d]) => segCross(a, b, c, d)))) reachOk = false
          // 발이 체중을 거의 못 받는데(벽 밀기·옆으로 뻗은 다리) 팔을 크게 굽혀 매달리는 자세는 비현실적 근력 → 쓰지 않음(완화 단계와 맨틀 제외)
          if (!relax && !sit && opts?.move !== 'mantle' && maxFlex > 60 * Math.PI / 180) {
            const share = (f) => {
              const v = Math.max(0, Math.min(1, (hip.y - f.p.y) / (dist(hip, f.p) || 1)))
              return 0.45 * v * (f.id === null ? 0.25 : f.p.y > hip.y - 0.3 * leg ? 0.2 : 1)
            }
            if (share(f1) + share(f2) < 0.35) reachOk = false
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

          if (!reachOk && best?.reachOk) continue
          if (!best || (reachOk && !best.reachOk) || cost < best.cost) best = { cost, hip, S, f1, f2, sit, reachOk }
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

  // 풀린 자세 s를 그리기용 관절 좌표로 바꿈. move/st: 이 프레임의 손 동작(발 프레임이면 null)
  const pose = (s, L, R, move, st) => {
  const { hl, hr, hip, S } = s
  const shL = add(S, { x: -sw / 2, y: 0 })
  const shR = add(S, { x: sw / 2, y: 0 })
  const hipL = add(hip, { x: -0.05 * heightM, y: 0 })
  const hipR = add(hip, { x: 0.05 * heightM, y: 0 })
  const feet = [{ ...s.f1 }, { ...s.f2 }]
  // 발 매칭이면 같은 홀드 양쪽에 발을 나란히 올림
  if (s.f1.id !== null && s.f1.id === s.f2.id) {
    feet[0].p = { x: s.f1.p.x - 0.04, y: s.f1.p.y }
    feet[1].p = { x: s.f1.p.x + 0.04, y: s.f1.p.y }
  }

  const dir = st ? Math.sign(st.dx || 1) : 0
  feet.sort((a, b) => a.p.x - b.p.x)
  const [footL, footR] = feet
  const kindOf = (f) => {
    if (s.f1.id !== null && s.f1.id === s.f2.id) return 'footmatch'
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
      // 싯 스타트는 무릎을 위로, 단 손보다 위로는 올리지 않음
      kneeL: kneeAt(hipL, footL.p, leg / 2, dropSide === 'L' ? 1 : -1, s.sit ? -0.6 : 0.05, Math.max(hl.y, hr.y)),
      kneeR: kneeAt(hipR, footR.p, leg / 2, dropSide === 'R' ? -1 : 1, s.sit ? -0.6 : 0.05, Math.max(hl.y, hr.y)),
      footL: footL.p,
      footR: footR.p,
      // 어깨선의 중심에서 엉덩이로 이어지는 몸통 (그리기용)
      neck: { x: S.x, y: S.y },
    },
  }
}
  return { solve, pose, jumpPose }
}

// 후보 동작 묶음의 점수: 프레임 사이 항목(홀드 확보, 몸 올리기, 움직임, 시간)은 합하고,
// 자세 항목은 프레임 평균으로 씀 — 합하면 프레임이 많을수록 '버티기 보상'이 쌓여 쓸데없이 길게 끄는 쪽이 유리해짐
function planScore(prevFig, figs, holds, heightM, seen) {
  const sn = cloneSeen(seen)
  let trans = 0
  let stat = 0
  let pf = prevFig
  for (const fig of figs) {
    const { terms } = scoreFrame(pf, fig, holds, heightM, sn)
    const st = staticTerms(fig, holds, heightM)
    for (const [k, v] of Object.entries(terms)) (k in st ? (stat += v) : (trans += v))
    pf = fig
  }
  return trans + stat / figs.length
}

const feetOfState = (s) => [s.f1, s.f2].slice().sort((a, b) => a.p.x - b.p.x) // [왼발, 오른발]
const sameFoot = (a, b) => (a.id !== null ? a.id === b.id : b.id === null && dist(a.p, b.p) < 0.06)

// 경로 전체를 프레임으로 만듦. 한 프레임에는 팔다리 하나만 움직임(손 따로, 발 따로).
// 손을 옮기기 전에 발을 먼저 한 발씩 올리고(발 먼저), 그 상태로 손이 안 닿으면 손을 먼저 옮기고 발을 따라 올림.
// 반환: [{ k: 'start' | 'foot' | 'hand' | 'jump', i: 손 동작 번호(출발은 -1), side: 'L'|'R'(발 프레임), fig }]
export function buildSequence(route, holds, body, heightM, { useReward = true } = {}) {
  const { solve, pose, jumpPose } = makeSolver(holds, body, heightM)
  const ids = (s) => [s.f1?.id, s.f2?.id].filter((v) => v !== null && v !== undefined)
  const fixed = (L, R, feet, prevHip, opts) => {
    const r = solve(L, R, prevHip, { ...opts, fixedFeet: feet })
    return r?.hip && r.reachOk ? r : null
  }
  const frames = []
  let L = route.startL
  let R = route.startR
  let s = solve(L, R, null, null)
  frames.push({ k: 'start', i: -1, fig: pose(s, L, R, null, null) })
  const seen = newSeen(frames[0].fig)

  route.steps.forEach((st, i) => {
    const opts = { move: st.move, movingPt: { x: holds[st.to].mx, y: holds[st.to].my } }
    const nL = st.dyno || st.hand === 'L' ? st.to : L
    const nR = st.dyno || st.hand === 'R' ? st.to : R
    if (st.dyno) {
      // 점프: 두 발이 함께 떨어졌다가 착지하며 새 발 자리를 딛음
      frames.push({ k: 'jump', i, fig: jumpPose(L, R, st) })
      s = solve(nL, nR, s.hip, { ...opts, prevFeet: ids(s) })
      frames.push({ k: 'hand', i, fig: pose(s, nL, nR, st.move, st) })
      scoreFrame(frames[frames.length - 2].fig, frames[frames.length - 1].fig, holds, heightM, seen)
      L = nL
      R = nR
      return
    }
    // 목표 자세 후보: 직전 발 홀드를 유지하려는 자세 + 그런 치우침 없이 푼 자세
    const targets = [solve(nL, nR, s.hip, { ...opts, prevFeet: ids(s) })]
    const alt = solve(nL, nR, s.hip, opts)
    if (alt?.hip && targets[0]?.hip && !(sameFoot(alt.f1, targets[0].f1) && sameFoot(alt.f2, targets[0].f2))) targets.push(alt)
    const cur = feetOfState(s)
    const prevFig = frames[frames.length - 1].fig
    const toFrames = (plan) => plan.map((f) => {
      const isHand = f.k === 'hand'
      return { k: f.k, i, side: f.side, together: f.together, fig: pose(f.s, f.hands[0], f.hands[1], isHand ? st.move : null, isHand ? st : null) }
    })
    let best = null
    for (const target of targets) {
      if (!target?.hip) continue
      const tgt = feetOfState(target)
      // 목표에서 벽을 밀 발이 지금 홀드를 딛고 있으면, 그 홀드를 그대로 둬도 되는지 보고 되면 떼지 않음
      for (const k of [0, 1]) {
        if (tgt[k].id !== null || cur[k].id === null) continue
        const keep = [...tgt]
        keep[k] = cur[k]
        if (fixed(nL, nR, keep, s.hip, opts)) tgt[k] = cur[k]
      }
      const changed = [0, 1].filter((k) => !sameFoot(cur[k], tgt[k]))

      // 손, 왼발, 오른발 중 바뀌는 것들을 한 번에 하나씩 옮기는 모든 순서
      const orders = []
      const permute = (rest, acc) => {
        if (!rest.length) return orders.push(acc)
        rest.forEach((x, n) => permute([...rest.slice(0, n), ...rest.slice(n + 1)], [...acc, x]))
      }
      permute(['hand', ...changed], [])
      // 중간에 홀드를 딛는 발이 하나도 없는 순간이 적은 순서 → 손을 늦게 옮기는(발 먼저) 순서 순(보상을 끄면 이 순서의 첫 번째를 씀)
      const unsupported = (order) => {
        const f = [...cur]
        let n = 0
        for (const limb of order.slice(0, -1)) {
          if (limb !== 'hand') f[limb] = tgt[limb]
          if (f.every((x) => x.id === null)) n++
        }
        return n
      }
      orders.sort((a, b) => unsupported(a) - unsupported(b) || b.indexOf('hand') - a.indexOf('hand'))
      // 엄격한 조건으로 되는 순서를 모두 모으고, 하나도 없으면 중간 자세만 조건을 완화(사람도 동작 중간엔 잠깐 불편한 자세를 지남)
      const plans = []
      for (const loose of [0, 1, 2]) {
        if (plans.length) break
        for (const order of orders) {
          let hands = [L, R]
          let feet = [...cur]
          let hip = s.hip
          const out = []
          let ok = true
          for (const limb of order) {
            if (limb === 'hand') hands = [nL, nR]
            else {
              feet = [...feet]
              feet[limb] = tgt[limb]
            }
            const isHand = limb === 'hand'
            const last = limb === order[order.length - 1] // 마지막(도착) 자세는 항상 엄격한 조건
            const r = fixed(hands[0], hands[1], feet, hip, { ...(isHand ? opts : { move: null, footStep: true }), loose: last ? 0 : loose })
            if (!r) {
              ok = false
              break
            }
            out.push(isHand ? { k: 'hand', s: r, hands } : { k: 'foot', side: limb === 0 ? 'L' : 'R', s: r, hands })
            hip = r.hip
          }
          if (ok) plans.push(Object.assign(out, { unsup: unsupported(order) }))
        }
      }
      // 강화학습 보상(reward.js)으로 후보를 채점해 가장 높은 것을 고름
      if (!useReward) {
        if (plans.length && !best) best = { plan: plans[0], frames: toFrames(plans[0]) }
        continue
      }
      // 발이 홀드에 하나도 없는 순간이 적은 순서가 우선(사용자 규칙), 그 안에서 보상으로 고름
      const minUnsup = Math.min(...plans.map((p) => p.unsup))
      for (const plan of plans) {
        if (plan.unsup > minUnsup) continue
        const fr = toFrames(plan)
        const sc = planScore(prevFig, fr.map((f) => f.fig), holds, heightM, seen)
        if (!best || sc > best.score) best = { score: sc, plan, frames: fr }
      }
    }
    let plan = best?.plan
    if (!plan) {
      const target = targets.find((t) => t?.hip) ?? targets[0]
      plan = [{ k: 'hand', s: target, hands: [nL, nR], together: true }]
    }
    const chosen = best?.frames ?? toFrames(plan)
    let pf = prevFig
    for (const f of chosen) {
      scoreFrame(pf, f.fig, holds, heightM, seen) // 보너스 받은 홀드 기록 갱신
      pf = f.fig
      frames.push(f)
    }
    s = plan[plan.length - 1].s
    L = nL
    R = nR
  })
  return frames
}
