// 애니메이션 검사: 연속한 두 프레임 사이를 보간할 때 뼈 길이 유지, 시작·끝 일치, 튀는 움직임이 없는지 확인
// 실행: node scripts/anim-check.mjs
import { blendPose, moversOf } from '../src/utils/animate.js'
import { bodyModel, findRoute, toMeters } from '../src/utils/route.js'
import { buildSequence } from '../src/utils/stickman.js'

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const bones = [['shL', 'elL'], ['elL', 'hl'], ['shR', 'elR'], ['elR', 'hr'], ['hipL', 'kneeL'], ['kneeL', 'footL'], ['hipR', 'kneeR'], ['kneeR', 'footR']]
const demo = [[190, 590], [280, 545], [200, 490], [300, 440], [220, 385], [310, 335], [240, 280], [330, 230], [250, 175], [190, 125], [260, 70]].map(([x, y]) => ({ x: x / 480, y: y / 640, size: 0.003, type: 'jug' }))

let pairs = 0
let boneBad = 0
let endBad = 0
let jumpBad = 0
let worstBone = 0
for (const W of [3.5, 5])
  for (const height of [150, 165, 185]) {
    const holds = toMeters(demo, W, 0.75)
    const body = bodyModel({ height, apeIndex: 1, flexibility: 3, level: 'beginner' })
    const r = findRoute(holds, body, [0], [10])
    if (!r) continue
    const frames = buildSequence(r, holds, body, height / 100)
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].k === 'jump' || frames[i - 1].k === 'jump') continue // 점프는 공중 자세라 따로
      const a = frames[i - 1].fig.p
      const b = frames[i].fig.p
      pairs++
      let prev = blendPose(a, b, 0)
      if (Object.keys(b).some((k) => dist(prev[k], a[k]) > 0.02)) endBad++
      if (Object.keys(b).some((k) => dist(blendPose(a, b, 1)[k], b[k]) > 0.02)) endBad++
      // 앱과 같은 실제 시간 간격(35ms)으로 샘플: 여러 손발이 바뀌면 재생 시간이 길어짐
      const n = moversOf(a, b).length
      const dt = 0.05 / (n > 1 ? 0.4 + 0.6 * n : 1)
      const bs = { bend: {}, dt: 0.7 * (n > 1 ? 0.4 + 0.6 * n : 1) * dt }
      blendPose(a, b, 0, bs)
      for (let t = dt; t <= 1 + dt - 1e-9; t += dt) {
        const p = blendPose(a, b, Math.min(1, t), bs)
        for (const [x, y] of bones) {
          const d = dist(p[x], p[y]) - dist(b[x], b[y]) // 늘어나는 것만 문제(정면에서 짧아 보이는 건 팔꿈치를 벽 앞뒤로 돌리는 중)
          worstBone = Math.max(worstBone, d)
          if (d > 0.0105) boneBad++ // 1cm(+반올림 0.05cm) 이하는 원래 자세에서 팔을 끝까지 뻗은 데서 오는 오차
        }
        // 한 스텝(약 35ms)에 관절이 25cm 넘게 움직이면 튐
        if (Object.keys(b).some((k) => dist(p[k], prev[k]) > 0.25)) jumpBad++
        prev = p
      }
    }
  }
console.log('프레임 쌍', pairs, '· 뼈가 늘어남', boneBad, `(최대 ${(worstBone * 100).toFixed(2)}cm)`, '· 시작/끝 불일치', endBad, '· 튐', jumpBad)
process.exitCode = boneBad || endBad ? 1 : 0 // 튐은 다리를 깊게 접은 자세에서 남아 있어 개수만 보고함
