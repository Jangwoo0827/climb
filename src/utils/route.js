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
  const physical = span // 두 손 사이 물리적 최대 = 양팔 + 어깨너비 = 팔 벌린 길이
  // 한 손을 옮길 때 다른 손과의 최대 거리: 팔 길이(팔 벌린 길이)로만 정해짐(유연성과 무관), 몸의 한계 92%를 넘지 않음
  const maxReach = Math.min(span * L.reachRatio, physical * 0.92)
  const Hm = height / 100
  const arm = Math.max(0.3, (span - 0.23 * Hm) / 2)
  return {
    span,
    maxReach,
    // 손이 허리(엉덩이)보다 아래로 내려가지 않게 하려면 두 손의 높이 차가 이보다 작아야 함: 팔 길이 + 몸통 - 여유
    maxVertical: arm * 0.97 + 0.3 * Hm - 0.05,
    comfort: span * L.comfort, // 이 이하면 편안한 움직임
    // 하이 스텝: 발을 엉덩이에서 다리 길이의 이 비율만큼 아래까지 올릴 수 있음(작을수록 높이 올림). 유연성 3 기준 0.3, 1점마다 0.06
    highStep: Math.min(0.45, Math.max(0.1, 0.3 - ((Number.isFinite(flexibility) ? flexibility : 3) - 3) * 0.06)),
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
    footOnly: h.footOnly, // 발 자유: 다른 색 홀드(발로만 씀)
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
    if (finish.has(l) && finish.has(r)) { // 끝: 두 손이 모두 끝 홀드를 잡음(하나면 매칭, 둘이면 하나씩)
      goal = [l, r]
      break
    }
    for (const hand of ['L', 'R']) {
      const fixed = hand === 'L' ? r : l
      const cur = hand === 'L' ? l : r
      for (let t = 0; t < n; t++) {
        if (t === cur || holds[t].footOnly) continue // 발 자유로 추가된 홀드는 발로만 씀
        const match = t === fixed // 매칭: 반대 손이 잡은 홀드로 두 손을 모음
        const d = dist(holds[t], holds[fixed])
        if (d > body.jumpReach) continue
        const dy = holds[t].my - holds[cur].my
        // 팔이 닿지 않거나, 손을 허리 위로 유지할 수 없을 만큼 높이 차가 크면 점프(양손을 목표 홀드로)
        const dyno = !match && d > body.maxReach || Math.abs(holds[t].my - holds[fixed].my) > body.maxVertical
        if (dyno && dy < -0.05) continue // 점프는 위나 옆으로만
        let cost
        if (dyno) {
          // 점프는 위험하고 힘들어서 큰 비용. 멀수록 더 비쌈
          cost = 30 + (d - body.maxReach) * 20
        } else {
          // 손 교차 방지: 왼손이 오른손보다 너무 오른쪽이면 감점
          const cross = hand === 'L' ? holds[t].mx - holds[fixed].mx : holds[fixed].mx - holds[t].mx
          // 멀리 뻗을수록 제곱으로 비싸짐: 한 번에 멀리 가기보다 중간 홀드나 매칭으로 나눠 가는 쪽이 싸게 됨
          const travel = dist(holds[t], holds[cur])
          cost = 0.6 + (travel / body.comfort) ** 2 * 1.2
          cost += (Math.max(0, d - body.comfort * 0.8) / body.comfort) ** 2 * 12 // 두 손 사이가 벌어질수록 크게 감점
          if (match) cost += 0.4 // 매칭은 한 동작을 더 쓰는 만큼 약간의 비용
          // 아래에 있는 손을 올리는 동작을 우선: 두 손 높이를 비슷하게 유지해 몸이 늘어지지 않게 함
          if (holds[cur].my < holds[fixed].my - 0.05) cost -= 0.5
          const gap = Math.abs(holds[t].my - holds[fixed].my)
          cost += Math.max(0, gap - 0.35) * 6 // 이동 뒤 두 손 높이 차가 35cm를 넘으면 감점
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
function classifyMove({ dyno, hard, dx, dy, type, match }) {
  if (dyno) return 'dyno'
  if (match) return 'match'
  if (type === 'volume' && dy > 0.2) return 'mantle' // 볼륨 위로 올라서는 동작
  if (hard && dy > 0.25) return 'deadpoint'
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
    const move = classifyMove({ dyno: s.dyno, hard, dx, dy, type: b.type, match: s.to === other })
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

// ---- 난이도 추정과 루트 생성 (GenClimb의 "난이도에 맞춘 루트 생성" 아이디어를 사진 속 벽에 맞게 규칙으로 구현) ----

// 경로의 V등급을 어림함: 손 이동 거리(팔 벌린 길이 대비), 점프, 잡기 어려운 홀드가 많을수록 어려움. 정확한 등급이 아니라 추정값
export function estimateGrade(route, holds, body) {
  // 매칭(두 손 모으기)은 짧은 정리 동작이라 빼고, 루트 생성과 같은 기준(팔 벌린 길이 대비 손 사이 거리)으로 계산
  const moves = route?.steps.filter((s) => s.move !== 'match') ?? []
  if (!moves.length) return null
  const ratios = moves.map((s) => s.reach / body.span)
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length
  const max = Math.max(...ratios)
  const grip = moves.reduce((a, s) => a + Math.max(0, HOLD_TYPES[holds[s.to].type]?.penalty ?? 0), 0) / moves.length
  const dynos = moves.filter((s) => s.dyno).length
  const v = (mean - 0.3) / 0.045 + Math.max(0, (max - 0.6) / 0.045) * 0.3 + dynos + grip * 1.5
  return Math.max(0, Math.min(10, Math.round(v)))
}

// 간단한 시드 난수(같은 시드면 같은 루트)
function rng(seed) {
  let s = seed % 2147483647 || 1
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

// all: 미터 단위 홀드 전체(toMeters 결과), 목표 V등급에 맞는 손 이동 거리로 아래에서 위로 손 홀드를 고름.
// 반환: { hands: [인덱스...], start: [인덱스 1~2개], finish: 인덱스, feet: [발 전용 인덱스...] } 또는 null
export function generateRoute(all, body, grade, seed = 1) {
  if (all.length < 4) return null
  const rand = rng(seed * 7919 + grade * 104729)
  const span = body.span
  const target = span * (0.3 + 0.045 * grade) // 손 이동 목표 거리: 난이도가 높을수록 멀리
  const maxD = Math.min(body.maxReach, target * 1.35)
  const ys = all.map((h) => h.my)
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  // 시작: 아래쪽 30% 안에서 무작위 하나, 그 옆에 손이 닿는 홀드가 있으면 두 손 시작
  const low = all.filter((h) => h.my < lo + (hi - lo) * 0.3 && h.my > 0.5 && h.my < 1.9)
  if (!low.length) return null
  const first = low[Math.floor(rand() * low.length)]
  const pair = all.filter((h) => h !== first && Math.abs(h.my - first.my) < 0.35 && Math.hypot(h.mx - first.mx, h.my - first.my) < span * 0.5 && Math.hypot(h.mx - first.mx, h.my - first.my) > 0.2)
  const second = pair.length ? pair[Math.floor(rand() * pair.length)] : null
  const hands = [first.id, ...(second ? [second.id] : [])]
  const used = new Set(hands)
  let cur = second && second.my > first.my ? second : first
  // 위로 올라가며 다음 손 홀드를 무작위로(목표 거리에 가까울수록 잘 뽑히게) 고름
  for (let guard = 0; guard < 40; guard++) {
    if (cur.my > hi - 0.35) break
    const cand = all.filter((h) => !used.has(h.id) && h.my > cur.my + 0.12 && Math.hypot(h.mx - cur.mx, h.my - cur.my) <= maxD)
    if (!cand.length) break
    const w = cand.map((h) => {
      const d = Math.hypot(h.mx - cur.mx, h.my - cur.my)
      return Math.exp(-(((d - target) / (0.18 * span)) ** 2)) * (0.3 + rand())
    })
    let r = rand() * w.reduce((a, b) => a + b, 0)
    let k = 0
    while (k < w.length - 1 && (r -= w[k]) > 0) k++
    cur = cand[k]
    hands.push(cur.id)
    used.add(cur.id)
  }
  if (hands.length < 4) return null
  // 끝도 두 손: 마지막 홀드 옆(같은 높이 근처, 팔이 닿는 거리)에 홀드가 있으면 두 번째 끝 홀드로
  const last = all[hands[hands.length - 1]]
  const pairEnd = all.filter((h) => !used.has(h.id) && Math.abs(h.my - last.my) < 0.3 && Math.hypot(h.mx - last.mx, h.my - last.my) > 0.2 && Math.hypot(h.mx - last.mx, h.my - last.my) < span * 0.45)
  const finish2 = pairEnd.length ? pairEnd[Math.floor(rand() * pairEnd.length)] : null
  if (finish2) {
    hands.push(finish2.id)
    used.add(finish2.id)
  }
  // 발 전용: 손 홀드 아래쪽(다리 길이 범위)에 있는, 손으로 안 쓰는 홀드
  const leg = 0.47 * (span / 1) // 팔 벌린 길이 ≈ 키
  const feet = all
    .filter((h) => !used.has(h.id))
    .filter((h) => hands.some((id) => { const t = all[id]; return h.my < t.my - 0.4 && h.my > t.my - 1.2 - leg * 0.5 && Math.abs(h.mx - t.mx) < 0.7 }))
    .map((h) => h.id)
  return { hands, start: hands.slice(0, second ? 2 : 1), finish: finish2 ? [last.id, finish2.id] : [last.id], feet }
}
