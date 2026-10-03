// 사용자 체형을 반영한 경로 탐색.
// 상태 = (왼손 홀드, 오른손 홀드). 한 번에 한 손만 옮기고, 비용이 가장 낮은 경로를 다익스트라로 찾는다.
// 팔이 닿는 거리(정적 이동)로 이어지지 않는 구간은 점프(다이노)로 건널 수 있다. 점프는 비용이 커서 꼭 필요할 때만 쓰인다.

import { HOLD_TYPES, MOVES } from './glossary.js'

export const LEVELS = {
  beginner: { label: '입문', reachRatio: 0.78, comfort: 0.5, downPenalty: 6, jugBonus: 1.6, jump: 0.2, grip: 1.0 },
  intermediate: { label: '중급', reachRatio: 0.9, comfort: 0.6, downPenalty: 3, jugBonus: 1.0, jump: 0.32, grip: 0.6 },
  advanced: { label: '상급', reachRatio: 1.0, comfort: 0.7, downPenalty: 1.5, jugBonus: 0.5, jump: 0.45, grip: 0.3 },
}

// 키(cm), 윙스팬 비율(팔 벌린 길이 / 키), 유연성(1~5), 실력 -> 미터 단위 도달 거리
export function bodyModel({ height, apeIndex, flexibility, level }) {
  const L = LEVELS[level]
  const span = (height / 100) * apeIndex
  // 입력값은 제한이 없어도 계산이 무너지지 않도록 보정값만 0.5~2배로 제한
  const flexBonus = Math.min(2, Math.max(0.5, 1 + (flexibility - 3) * 0.035))
  const maxReach = span * L.reachRatio * flexBonus // 한 손을 옮길 때 다른 손과의 최대 거리
  const Hm = height / 100
  const arm = Math.max(0.3, (span - 0.23 * Hm) / 2)
  return {
    span,
    maxReach,
    // 손이 허리(엉덩이)보다 아래로 내려가지 않게 하려면 두 손의 높이 차가 이보다 작아야 함: 팔 길이 + 몸통 - 여유
    maxVertical: arm * 0.97 + 0.3 * Hm - 0.05,
    comfort: span * L.comfort * flexBonus, // 이 이하면 편안한 움직임
    jumpReach: maxReach + span * L.jump, // 점프하면 닿는 최대 거리
    level: L,
  }
}

// holds: {x,y,size} 정규화 좌표(y는 아래로 증가). 이미지 너비 1.0 = wallWidthM 미터
export function toMeters(holds, wallWidthM, aspect) {
  const wallHeightM = wallWidthM / aspect
  return holds.map((h, i) => ({
    id: i,
    mx: h.x * wallWidthM,
    my: (1 - h.y) * wallHeightM, // 위쪽이 +
    size: h.size,
    type: h.type, // 홀드 종류(점보, 크림프 등)
    parent: h.parent, // 볼륨의 접점이면 그 볼륨이 원래 몇 번째 검출인지
    nx: h.x,
    ny: h.y,
  }))
}

const dist = (a, b) => Math.hypot(a.mx - b.mx, a.my - b.my)

// 최소 힙 (다익스트라용)
class MinHeap {
  constructor() {
    this.a = []
  }
  get size() {
    return this.a.length
  }
  push(item) {
    const a = this.a
    a.push(item)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p][0] <= a[i][0]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop() {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l][0] < a[m][0]) m = l
        if (r < a.length && a[r][0] < a[m][0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

export function findRoute(holds, body, startIds, finishIds) {
  const n = holds.length
  if (!n || !startIds.length || !finishIds.length) return null
  const maxSize = Math.max(...holds.map((h) => h.size))
  const finish = new Set(finishIds)
  const key = (l, r) => l * n + r

  const dp = new Map()
  const prev = new Map()
  const heap = new MinHeap()
  for (const a of startIds)
    for (const b of startIds) {
      if (a === b && startIds.length > 1) continue
      if (dist(holds[a], holds[b]) > body.maxReach || Math.abs(holds[a].my - holds[b].my) > body.maxVertical) continue
      dp.set(key(a, b), 0)
      prev.set(key(a, b), null)
      heap.push([0, a, b])
    }
  if (!heap.size) return null

  let goal = null
  while (heap.size) {
    const [c, l, r] = heap.pop()
    if (c > (dp.get(key(l, r)) ?? Infinity)) continue
    if (finish.has(l) || finish.has(r)) {
      goal = [l, r]
      break
    }
    for (const hand of ['L', 'R']) {
      const fixed = hand === 'L' ? r : l
      const cur = hand === 'L' ? l : r
      for (let t = 0; t < n; t++) {
        if (t === cur || t === fixed) continue
        const d = dist(holds[t], holds[fixed])
        if (d > body.jumpReach) continue
        const dy = holds[t].my - holds[cur].my
        // 팔이 닿지 않거나, 손을 허리 위로 유지할 수 없을 만큼 높이 차가 크면 점프(양손을 목표 홀드로)
        const dyno = d > body.maxReach || Math.abs(holds[t].my - holds[fixed].my) > body.maxVertical
        if (dyno && dy < -0.05) continue // 점프는 위나 옆으로만
        let cost
        if (dyno) {
          // 점프는 위험하고 힘들어서 큰 비용. 멀수록 더 비쌈
          cost = 30 + (d - body.maxReach) * 20
        } else {
          // 손 교차 방지: 왼손이 오른손보다 너무 오른쪽이면 감점
          const cross = hand === 'L' ? holds[t].mx - holds[fixed].mx : holds[fixed].mx - holds[t].mx
          cost = 1 + Math.max(0, d - body.comfort) * 8 // 팔이 뻗을수록 비용 증가
          cost += Math.max(0, dist(holds[t], holds[cur]) - body.comfort * 0.7) * 6 // 한 손이 너무 멀리 건너뛰면 감점
          if (dy < 0) cost += -dy * body.level.downPenalty // 내려가는 동작 억제
          if (dy > 0) cost -= Math.min(dy, 0.5) * 0.6 // 위로 가는 진행은 약간 보상
          if (cross > 0.25) cost += 2
          cost += (1 - holds[t].size / maxSize) * body.level.jugBonus // 큰 홀드 선호
          cost += (HOLD_TYPES[holds[t].type]?.penalty ?? 0) * body.level.grip // 잡기 어려운 종류(크림프, 슬로퍼 등)는 초보일수록 감점
          cost = Math.max(0.2, cost)
        }
        const nl = dyno ? t : hand === 'L' ? t : l // 점프하면 양손이 목표 홀드로 감
        const nr = dyno ? t : hand === 'R' ? t : r
        const nk = key(nl, nr)
        const nc = c + cost
        if (nc < (dp.get(nk) ?? Infinity)) {
          dp.set(nk, nc)
          prev.set(nk, { from: key(l, r), hand, to: t, dyno })
          heap.push([nc, nl, nr])
        }
      }
    }
  }
  if (!goal) return null

  const steps = []
  let k = key(goal[0], goal[1])
  while (prev.get(k)) {
    const p = prev.get(k)
    steps.push({ hand: p.hand, to: p.to, dyno: p.dyno })
    k = p.from
  }
  steps.reverse()
  const startL = Math.floor(k / n)
  const startR = k % n
  return { startL, startR, steps: annotate(holds, body, startL, startR, steps) }
}

// 손 이동의 성격(동작 이름)을 정한다. dx, dy는 움직이는 손의 이동량(미터), d는 반대 손과의 거리
function classifyMove({ dyno, hard, dx, dy, type }) {
  if (dyno) return 'dyno'
  if (type === 'volume' && dy > 0.2) return 'mantle' // 볼륨 위로 올라서는 동작
  if (hard && dy > 0.25) return 'deadpoint'
  if (Math.abs(dx) > 0.4 && Math.abs(dy) < 0.35) return 'flag'
  if (Math.abs(dx) > 0.25 && dy > 0.1) return 'dropknee'
  if (dy > 0.3) return 'lockoff'
  if (dy < -0.1) return 'downclimb'
  return 'reach'
}

// 각 동작에 동작 이름, 잡는 홀드 종류, 자세 조언을 붙인다.
function annotate(holds, body, startL, startR, steps) {
  let L = startL
  let R = startR
  return steps.map((s, i) => {
    const from = s.hand === 'L' ? L : R
    const other = s.hand === 'L' ? R : L
    const a = holds[from]
    const b = holds[s.to]
    const o = holds[other]
    const d = dist(b, o)
    const dx = b.mx - a.mx
    const dy = b.my - a.my
    const hard = !!s.dyno || d > body.comfort * 1.15
    const move = classifyMove({ dyno: s.dyno, hard, dx, dy, type: b.type })
    const tips = [...MOVES[move].tips]
    if (!s.dyno && d > body.comfort * 1.15 && move !== 'deadpoint' && move !== 'lockoff') {
      tips.push('팔이 많이 뻗어요. 발을 먼저 높이 올려 다리로 밀어주세요')
    }
    const grip = HOLD_TYPES[b.type]
    if (grip) tips.push(`${grip.name}: ${grip.grip}`)
    if (s.dyno) L = R = s.to
    else if (s.hand === 'L') L = s.to
    else R = s.to
    return {
      index: i + 1,
      hand: s.hand,
      from,
      to: s.to,
      reach: d,
      dyno: !!s.dyno,
      move,
      holdType: b.type,
      hard,
      dx,
      dy,
      tips,
    }
  })
}
