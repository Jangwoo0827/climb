// 보상 기반 선택(켜기) vs 기존 규칙(끄기)의 보상 항목별 평균 비교. 실행: node scripts/reward-compare.mjs
import { bodyModel, findRoute, toMeters } from '../src/utils/route.js'
import { buildSequence } from '../src/utils/stickman.js'
import { estimateHoldType } from '../src/utils/glossary.js'
import { scoreFrames } from '../src/utils/reward.js'

const px = [[190, 590], [280, 545], [200, 490], [300, 440], [220, 385], [310, 335], [240, 280], [330, 230], [250, 175], [190, 125], [260, 70]].map(([x, y]) => [x / 480, y / 640])
let seed = 7
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const extra = Array.from({ length: 26 }, () => [(30 + rnd() * 420) / 480, (30 + rnd() * 580) / 640])
const scenes = {
  demo: { aspect: 0.75, px, start: [0], fin: [10] },
  demoFree: { aspect: 0.75, px, start: [0], fin: [10], extra },
  wideStart: { aspect: 0.8, px: [[0.25, 0.62], [0.62, 0.6], [0.45, 0.78], [0.5, 0.45], [0.35, 0.33], [0.55, 0.2], [0.42, 0.08]], start: [0, 1], fin: [6] },
}
const sum = { on: {}, off: {} }
const n = { on: 0, off: 0 }
const tot = { on: 0, off: 0 }
for (const sc of Object.values(scenes))
  for (const W of [3.5, 5])
    for (const height of [150, 165, 185])
      for (const level of ['beginner', 'advanced']) {
        const holds = toMeters([...sc.px.map(([x, y], i) => { const h = { x, y, size: 0.002 + ((i * 37) % 7) * 0.0004, elong: 1, angle: 0 }; return { ...h, type: estimateHoldType(h, 0.003) } }), ...(sc.extra ?? []).map(([x, y]) => ({ x, y, size: 0.003, type: 'jug', footOnly: true }))], W, sc.aspect)
        const body = bodyModel({ height, apeIndex: 1, flexibility: 3, level })
        const r = findRoute(holds, body, sc.start, sc.fin)
        if (!r) continue
        for (const mode of ['on', 'off']) {
          const fr = buildSequence(r, holds, body, height / 100, { useReward: mode === 'on' })
          const s = scoreFrames(fr, holds, height / 100)
          tot[mode] += s.total
          for (const f of s.frames) { n[mode]++; for (const [k, v] of Object.entries(f.terms)) sum[mode][k] = (sum[mode][k] ?? 0) + v }
        }
      }
console.log('총 보상  켜기', tot.on.toFixed(1), ' 끄기', tot.off.toFixed(1), ' 프레임', n.on, n.off)
for (const k of Object.keys(sum.on)) console.log(k.padEnd(18), (sum.on[k] / n.on).toFixed(3).padStart(8), (sum.off[k] / n.off).toFixed(3).padStart(8))
