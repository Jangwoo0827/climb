// 졸라맨 자세가 사람 몸으로 가능한지 검사한다. 실행: node scripts/pose-check.mjs
import { bodyModel, findRoute, toMeters } from '../src/utils/route.js'
import { figureAt } from '../src/utils/stickman.js'
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
  // 시작 홀드 2개가 가슴 높이에서 양옆으로 벌어진 경우(실제 신고된 사례)
  wideStart: { aspect: 0.8, px: [[0.25, 0.62], [0.62, 0.6], [0.45, 0.78], [0.5, 0.45], [0.35, 0.33], [0.55, 0.2], [0.42, 0.08]], start: [0, 1], fin: [6] },
}
let total = 0
let bad = 0
for (const [name, sc] of Object.entries(scenes))
  for (const W of [3.5, 5])
    for (const height of [150, 165, 185])
      for (const level of ['beginner', 'advanced']) {
        const holds = toMeters(sc.px.map(([x, y], i) => { const h = { x, y, size: 0.002 + ((i * 37) % 7) * 0.0004, elong: 1, angle: 0 }; return { ...h, type: estimateHoldType(h, 0.003) } }), W, sc.aspect)
        const H = height / 100
        const body = bodyModel({ height, apeIndex: 1, flexibility: 3, level })
        const r = findRoute(holds, body, sc.start, sc.fin)
        if (!r) continue
        const arm = (body.span - 0.23 * H) / 2
        for (let i = -1; i < r.steps.length; i++)
          for (const phase of i >= 0 && r.steps[i].dyno ? ['land', 'jump'] : ['land']) {
            total++
            const { p } = figureAt(r, holds, body, H, i, phase)
            const issues = []
            for (const [sh, h] of [[p.shL, p.hl], [p.shR, p.hr]]) if (Math.hypot(sh.x - h.x, sh.y - h.y) > arm * 1.001) issues.push('팔 늘어남')
            for (const k of ['footL', 'footR']) if (p[k].y < 0.0999) issues.push(k + ' 바닥에 닿음')
            if (phase === 'land') {
              for (const h of [p.hl, p.hr]) if (h.y < p.hip.y - 1e-6 && h.y > 0.12) issues.push('손이 허리 아래')
              if (Math.hypot(p.footL.x - p.footR.x, p.footL.y - p.footR.y) < 0.16 * H - 1e-6) issues.push('두 발이 한 점')
              for (const [k, sh, h] of [['elL', p.shL, p.hl], ['elR', p.shR, p.hr]]) if (p[k].y > Math.max(sh.y, h.y) + 0.02) issues.push(k + ' 위로 꺾임')
              const sitStart = Math.min(p.hl.y, p.hr.y) < 0.1 + 0.45 * 0.47 * H // 손이 너무 낮으면 앉아서 출발(싯 스타트): 무릎이 엉덩이보다 높은 게 정상
              // 발을 높이 올린 하이 스텝(발이 엉덩이 근처)은 무릎이 엉덩이보다 높은 게 정상
              if (!sitStart) for (const [k, f] of [['kneeL', p.footL], ['kneeR', p.footR]]) if (p[k].y > p.hip.y + 0.02 && f.y < p.hip.y - 0.45 * 0.47 * H) issues.push(k + ' 엉덩이보다 위')
              for (const k of ['elL', 'elR']) if (segDist(p[k], p.neck, p.hip) < 0.03) issues.push(k + ' 몸통 관통')
            }
            if (issues.length) {
              bad++
              if (bad <= 8) console.log(name, W, height, level, 'step', i, phase, issues.join(', '))
            }
          }
      }
console.log('자세', total, '문제', bad)
process.exitCode = bad ? 1 : 0
