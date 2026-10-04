// 졸라맨 자세가 사람 몸으로 가능한지 검사한다. 실행: node scripts/pose-check.mjs
import { bodyModel, findRoute, toMeters } from '../src/utils/route.js'
import { buildSequence } from '../src/utils/stickman.js'
import { estimateHoldType } from '../src/utils/glossary.js'

const segDist = (p, a, b) => {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l = vx * vx + vy * vy || 1e-9
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l))
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t))
}
const scenes = {
  demo: { aspect: 480 / 640, px: [[190, 590], [280, 545], [200, 490], [300, 440], [220, 385], [310, 335], [240, 280], [330, 230], [250, 175], [190, 125], [260, 70]].map(([x, y]) => [x / 480, y / 640]), start: [0], fin: [10] },
  photo: { aspect: 437 / 478, px: [[40, 30], [48, 57], [33, 104], [219, 64], [204, 43], [168, 37], [277, 73], [309, 97], [292, 147], [260, 177], [188, 190], [68, 175], [67, 211], [20, 230], [95, 263], [70, 274], [168, 322], [273, 289], [228, 397], [367, 244], [387, 364], [48, 364], [58, 432]].map(([x, y]) => [x / 437, y / 478]), start: [22], fin: [5] },
  // 발 자유: 데모 경로 + 다른 색 홀드 26개(발로만 씀)
  demoFree: { aspect: 480 / 640, px: [[190, 590], [280, 545], [200, 490], [300, 440], [220, 385], [310, 335], [240, 280], [330, 230], [250, 175], [190, 125], [260, 70]].map(([x, y]) => [x / 480, y / 640]), start: [0], fin: [10], extra: (() => { let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; return Array.from({ length: 26 }, () => [(30 + rnd() * 420) / 480, (30 + rnd() * 580) / 640]) })() },
  // 시작 홀드 2개가 가슴 높이에서 양옆으로 벌어진 경우(실제 신고된 사례)
  wideStart: { aspect: 0.8, px: [[0.25, 0.62], [0.62, 0.6], [0.45, 0.78], [0.5, 0.45], [0.35, 0.33], [0.55, 0.2], [0.42, 0.08]], start: [0, 1], fin: [6] },
}
let total = 0
let multiLimb = 0
let handFrames = 0
let footFrames = 0
let smearBoth = 0
let oneFoot = 0
let steps = 0
let longMoves = 0
let bentArms = 0
let footMatch = 0
let hipHigh = 0
let handGap = 0
let twoHolds = 0
let bad = 0
for (const [name, sc] of Object.entries(scenes).filter(([n]) => !process.env.SCENE || n === process.env.SCENE))
  for (const W of [3.5, 5])
    for (const height of [150, 165, 185])
      for (const level of ['beginner', 'advanced']) {
        const holds = toMeters([...sc.px.map(([x, y], i) => { const h = { x, y, size: 0.002 + ((i * 37) % 7) * 0.0004, elong: 1, angle: 0 }; return { ...h, type: estimateHoldType(h, 0.003) } }), ...(sc.extra ?? []).map(([x, y]) => ({ x, y, size: 0.003, type: 'jug', footOnly: true }))], W, sc.aspect)
        const H = height / 100
        const body = bodyModel({ height, apeIndex: 1, flexibility: 3, level })
        const r = findRoute(holds, body, sc.start, sc.fin)
        if (!r) continue
        const arm = (body.span - 0.23 * H) / 2
        steps += r.steps.length
        longMoves += r.steps.filter((st) => !st.dyno && st.reach > body.comfort * 1.15).length
        const frames = buildSequence(r, holds, body, H, { useReward: process.env.REWARD !== 'off' })
        frames.forEach((fr, fidx) => {
          {
            const i = fr.i
            const phase = fr.k === 'jump' ? 'jump' : 'land'
            total++
            const fig = fr.fig
            const { p } = fig
            // 손 따로 발 따로: 손과 발을 한 프레임에 함께 옮긴 경우(어떤 순서로도 나눌 수 없을 때만 생김)
            if (fr.together) multiLimb++
            if (fr.k === 'hand') handFrames++
            if (fr.k === 'foot') footFrames++
            const issues = []
            for (const [sh, h] of [[p.shL, p.hl], [p.shR, p.hr]]) if (Math.hypot(sh.x - h.x, sh.y - h.y) > arm * 1.001) issues.push('팔 늘어남')
            for (const k of ['footL', 'footR']) if (p[k].y < 0.0999) issues.push(k + ' 바닥에 닿음')
            const sitStartEarly = Math.min(p.hl.y, p.hr.y) < 0.1 + 0.65 * 0.47 * H + 0.05
            if (phase === 'land') {
              for (const h of [p.hl, p.hr]) if (h.y < p.hip.y - 1e-6 && h.y > 0.12) issues.push('손이 허리 아래')
              for (const [k, f] of [['footL', p.footL], ['footR', p.footR]]) if (!sitStartEarly && Math.abs(f.x - p.hip.x) > (fr.k === 'foot' ? 1.35 : 1.2) * (p.hip.y - f.y) + 0.05 && fig.feetInfo.some((x) => x.id !== null)) issues.push(k + ' 옆으로 눕힘')
              // 팔꿈치가 어깨-손 선보다 위로 꺾이면 치킨 윙
              for (const [k, sh, h] of [['elL', p.shL, p.hl], ['elR', p.shR, p.hr]]) { const t = (p[k].x - sh.x) / ((h.x - sh.x) || 1e-6); const lineY = Math.abs(h.x - sh.x) > 0.02 ? sh.y + (h.y - sh.y) * t : -Infinity; if (p[k].y > lineY + 0.02 && Math.abs(h.x - sh.x) > 0.02) issues.push(k + ' 선 위로 꺾임') }
              const fm = fig.feetInfo.every((f) => f.kind === 'footmatch')
              if (!fm && Math.hypot(p.footL.x - p.footR.x, p.footL.y - p.footR.y) < 0.16 * H - 1e-6) issues.push('두 발이 한 점')
              for (const [k, sh, h] of [['elL', p.shL, p.hl], ['elR', p.shR, p.hr]]) if (p[k].y > Math.max(sh.y, h.y) + 0.02) issues.push(k + ' 위로 꺾임')
              const sitStart = Math.min(p.hl.y, p.hr.y) < 0.1 + 0.65 * 0.47 * H + 0.05 // 손이 너무 낮으면 앉아서 출발(싯 스타트): 무릎이 엉덩이보다 높은 게 정상
              // 발을 높이 올린 하이 스텝(발이 엉덩이 근처)은 무릎이 엉덩이보다 높은 게 정상
              if (!sitStart) for (const [k, f] of [['kneeL', p.footL], ['kneeR', p.footR]]) if (p[k].y > p.hip.y + 0.02 && f.y < p.hip.y - 0.45 * 0.47 * H) issues.push(k + ' 엉덩이보다 위')
              for (const k of ['elL', 'elR']) if (segDist(p[k], p.neck, p.hip) < 0.03) issues.push(k + ' 몸통 관통')
              // 무릎 각도: 엉덩이-무릎-발이 50도보다 좁게 접히면 부자연스러움(싯 스타트 제외)
              const ang = (a, b, c) => { const v1 = [a.x - b.x, a.y - b.y]; const v2 = [c.x - b.x, c.y - b.y]; return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1)))) * 180 / Math.PI }
              if (!sitStart) for (const [k, hp, f] of [['kneeL', p.hipL, p.footL], ['kneeR', p.hipR, p.footR]]) if (ang(hp, p[k], f) < 50) issues.push(k + ' 너무 접힘')
              if (Math.abs(p.footL.x - p.footR.x) > 0.62 * H && fig.move !== 'flag') issues.push('다리 찢음')
              // 손이 어깨 위에 있는데 팔을 75% 미만으로 굽힌 매달림(팔 힘 낭비)
              for (const [sh, h] of [[p.shL, p.hl], [p.shR, p.hr]]) if (h.y > sh.y && Math.hypot(sh.x - h.x, sh.y - h.y) < 0.75 * arm && fig.move !== 'lockoff' && fig.move !== 'mantle') bentArms++
              const onHold = fig.feetInfo.filter((f) => f.id !== null).length
              if (onHold === 0) smearBoth++
              if (fm) footMatch++
              if (onHold === 2 && !fm) twoHolds++
              if (Math.abs(p.hl.y - p.hr.y) > 0.6) handGap++
              if (fig.move !== 'mantle' && p.hip.y > Math.max(p.hl.y, p.hr.y) - 0.92 * arm - 0.3 * H + 0.25) hipHigh++
              if (onHold === 1) oneFoot++
              // 삼각형 기본자세: 엉덩이가 두 발 사이(밑변 안)에 있어야 함(플래깅·싯 스타트 제외)
              const lo = Math.min(p.footL.x, p.footR.x) - 0.05
              const hi = Math.max(p.footL.x, p.footR.x) + 0.05
              const flag = fig.move === 'flag'
              if (fr.k !== 'foot' && !flag && !fm && !sitStart && (p.hip.x < lo || p.hip.x > hi)) issues.push('무게중심이 두 발 밖')
            }
            if (issues.length) {
              bad++
              if (bad <= 8) console.log(name, W, height, level, 'step', i, fr.k, issues.join(', '))
            }
          }
        })
      }
if (process.env.SCENE) console.log('scene', process.env.SCENE)
console.log('자세', total, '문제', bad, '· 발이 홀드에 0개', smearBoth, '· 1개', oneFoot, '· 손 이동', steps, '중 크게 뻗는 이동', longMoves, '· 팔 굽혀 매달림', bentArms, '· 합발', footMatch, '· 엉덩이 높음', hipHigh, '· 두 손 높이차 60cm↑', handGap, '· 다른 홀드 두 개', twoHolds, '· 발 옮기기 프레임', footFrames, '· 손과 발을 함께 옮김', multiLimb, '/ 손 동작', handFrames)
process.exitCode = bad ? 1 : 0
