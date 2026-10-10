// 3D(잡는 자리 보정 포함) 애니메이션 검사: 손발이 한 순간에 튀는지(텔레포트), 팔다리가 뼈 길이보다 늘어나는지
// 실행: node scripts/anim3d-check.mjs
import { blendPose, moversOf } from '../src/utils/animate.js'
import { pose3d } from '../src/utils/depth.js'
import { holdProfile } from '../src/utils/hold3d.js'
import { bodyModel, findRoute, toMeters } from '../src/utils/route.js'
import { buildSequence } from '../src/utils/stickman.js'

const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0))
const px = [[190, 590], [280, 545], [200, 490], [300, 440], [220, 385], [310, 335], [240, 280], [330, 230], [250, 175], [190, 125], [260, 70]].map(([x, y]) => [x / 480, y / 640])
const types = ['jug', 'crimp', 'sloper', 'pinch', 'pocket', 'sidepull', 'undercling']
let jumps = 0
let spikes = 0
let stretch = 0
let worst = 0
let samples = 0
for (const height of [150, 165, 185])
  for (let rot = 0; rot < types.length; rot++) {
    const holds = toMeters(px.map(([x, y], i) => ({ x, y, size: 0.003, type: types[(i + rot) % types.length] })), 3.5, 0.75)
    const body = bodyModel({ height, apeIndex: 1, flexibility: 3, level: 'beginner' })
    const H = height / 100
    const r = findRoute(holds, body, [0], [10])
    if (!r) continue
    const frames = buildSequence(r, holds, body, H)
    // 앱과 같게: 각 프레임에서 손이 잡은 홀드의 종류·크기
    const gripsOf = (fig) => {
      const at = (pt) => {
        let best = null
        for (const id of fig.hands) {
          const h = holds[id]
          const d = Math.hypot(h.mx - pt.x, h.my - pt.y)
          if (!best || d < best.d) best = { d, h }
        }
        const rr = 0.06
        return { type: best.h.type, hold: { mx: best.h.mx, my: best.h.my, rx: rr, ry: rr, depth: holdProfile(best.h.type, rr, rr).depth, base: 0 } }
      }
      return [at(fig.p.hl), at(fig.p.hr)]
    }
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].k === 'jump' || frames[i - 1].k === 'jump') continue
      const a = frames[i - 1].fig.p
      const b = frames[i].fig.p
      const grips = [...gripsOf(frames[i].fig), ...gripsOf(frames[i - 1].fig)]
      const n = moversOf(a, b).length
      const dt = 0.05 / (n > 1 ? 0.4 + 0.6 * n : 1)
      // 이전 프레임 끝 자세는 이전 프레임의 잡기로(앱에서 실제로 보이던 자세)
      let prev = process.env.MODE === '2d' /* 비교용: 3D 보정 없이 2D 동작만 */ ? Object.fromEntries(Object.entries(a).map(([k, q]) => [k, { ...q, z: 0 }])) : pose3d(a, H, frames[i - 1].fig.feetInfo, gripsOf(frames[i - 1].fig), [a])
      const lastStep = { hl: 0, hr: 0, footL: 0, footR: 0 }
      const bs3 = { bend: {}, dt: 0.7 * (n > 1 ? 0.4 + 0.6 * n : 1) * dt } // 앱처럼 프레임 사이 상태를 이어 씀
      blendPose(a, b, 0, bs3)
      for (let t = dt; t <= 1 + 1e-9; t += dt) {
        const p2 = blendPose(a, b, Math.min(1, t), bs3)
        const p = process.env.MODE === '2d' /* 비교용: 3D 보정 없이 2D 동작만 */ ? Object.fromEntries(Object.entries(p2).map(([k, q]) => [k, { ...q, z: 0 }])) : pose3d(p2, H, frames[i].fig.feetInfo, grips, [a, b])
        samples++
        if (['hl', 'hr', 'footL', 'footR'].some((k) => d3(p[k], prev[k]) > 0.12)) jumps++
        for (const [s, e, w] of [['shL', 'elL', 'hl'], ['shR', 'elR', 'hr'], ['hipL', 'kneeL', 'footL'], ['hipR', 'kneeR', 'footR']]) {
          const ex = d3(p[e], p[w]) - Math.hypot(b[e].x - b[w].x, b[e].y - b[w].y)
          worst = Math.max(worst, ex)
          if (ex > 0.02) stretch++
        }
        // 순간이동: 바로 전 순간 움직임의 3배를 넘고 5cm 이상 갑자기 움직임(빠르지만 매끄러운 움직임은 제외)
        for (const k of ['hl', 'hr', 'footL', 'footR']) {
          const st = d3(p[k], prev[k])
          if (st > 0.05 && st > 3 * Math.max(lastStep[k], 0.01)) spikes++
          lastStep[k] = st
        }
        prev = p
      }
    }
  }
console.log('샘플', samples, '· 순간이동(갑자기 3배·5cm↑)', spikes, '· 빠른 이동(한 순간 12cm↑)', jumps, '· 팔다리 2cm↑ 늘어남', stretch, `(최대 ${(worst * 100).toFixed(1)}cm)`)
