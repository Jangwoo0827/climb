// 애니메이션 중간 프레임 검사: 팔이 몸통을 뚫는지, 팔꿈치·무릎이 갑자기 뒤집히는지(꺾임), 관절 각도가 떨리는지(삐걱)
// 실행: node scripts/smooth-check.mjs
import { blendPose, moversOf } from '../src/utils/animate.js'
import { bodyModel, findRoute, toMeters } from '../src/utils/route.js'
import { buildSequence } from '../src/utils/stickman.js'
const seg = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, l = vx * vx + vy * vy || 1e-9; const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l)); return Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t) }
const ang = (a, b, c) => { const v1 = [a.x - b.x, a.y - b.y], v2 = [c.x - b.x, c.y - b.y]; return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1)))) * 180 / Math.PI }
const side = (a, b, c) => Math.sign((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x))
const px = [[190, 590], [280, 545], [200, 490], [300, 440], [220, 385], [310, 335], [240, 280], [330, 230], [250, 175], [190, 125], [260, 70]].map(([x, y]) => [x / 480, y / 640])
let drift = 0, driftMax = 0, pierce = 0, flips = 0, jitter = 0, zig = 0, straightPop = 0, samples = 0, jumpFrames = 0, jumpBad = 0
const why = {}
const note = (k) => (why[k] = (why[k] ?? 0) + 1)
let ctx = ''
// 장면: 일반 루트, 간격이 넓어 점프가 필요한 루트
const jumpPx = [[0.45, 0.93], [0.55, 0.9], [0.5, 0.66], [0.45, 0.4], [0.55, 0.13], [0.5, 0.1]]
const SCENES = [{ px, fin: 10 }, { px: jumpPx, fin: 5 }]
for (const sc of SCENES) for (const height of [150, 165, 185]) for (const W of [3.5, 5]) for (const level of ['beginner', 'advanced']) {
  const holds = toMeters(sc.px.map(([x, y]) => ({ x, y, size: 0.003, type: 'jug' })), W, 0.75)
  const body = bodyModel({ height, apeIndex: 1, flexibility: 3, level })
  const r = findRoute(holds, body, [0], [sc.fin]); if (!r) continue
  const fr = buildSequence(r, holds, body, height / 100)
  for (let i = 1; i < fr.length; i++) {
    const a = fr[i - 1].fig.p, b = fr[i].fig.p
    const isJump = fr[i].k === 'jump' || fr[i - 1].k === 'jump'
    ctx = fr[i].k + (fr[i].together ? '+함께' : '') + '/' + moversOf(a, b).map((m) => m.k).join('')
    if (isJump) jumpFrames++
    const n = moversOf(a, b).length, dt = 0.05 / (n > 1 ? 0.4 + 0.6 * n : 1)
    let prev = null
    const lastD = {}
    const hist = {}
    const bs = { bend: {}, dt: 0.7 * (n > 1 ? 0.4 + 0.6 * n : 1) * dt }
    for (let t = 0; t <= 1.0001; t += dt) {
      const p = blendPose(a, b, Math.min(1, t), process.env.NOSTATE ? null : bs); samples++
      // 고정된 손발(움직이는 중이 아닌 것)이 홀드에서 끌려가지 않는지
      { const mv = new Set(moversOf(a, b).map((m) => m.k)); for (const k of ['hl', 'hr', 'footL', 'footR']) { if (mv.has(k)) continue; const d = Math.min(Math.hypot(p[k].x - a[k].x, p[k].y - a[k].y), Math.hypot(p[k].x - b[k].x, p[k].y - b[k].y)); driftMax = Math.max(driftMax, d); if (d > 0.04) drift++ } }
      for (const [sh, el, hd] of [['shL', 'elL', 'hl'], ['shR', 'elR', 'hr']]) if (seg(p[el], p.neck, p.hip) < 0.035 || seg(p[hd], p.neck, p.hip) < 0.02) { pierce++; note('관통 ' + ['L','R'][+(sh==='shR')] + ' ' + ctx) }
      if (prev) for (const [r0, j, e, nm] of [['shL', 'elL', 'hl', '왼팔'], ['shR', 'elR', 'hr', '오른팔'], ['hipL', 'kneeL', 'footL', '왼다리'], ['hipR', 'kneeR', 'footR', '오른다리']]) {
        const s1 = side(p[r0], p[j], p[e]), s0 = side(prev[r0], prev[j], prev[e])
        const a1 = ang(p[r0], p[j], p[e]), a0 = ang(prev[r0], prev[j], prev[e])
        if (s1 !== s0 && s1 && s0 && Math.min(a1, a0) < 150) { flips++; note('뒤집힘 ' + nm + ' ' + ctx) }
        if (Math.abs(a1 - a0) > 25) { jitter++; note('급변 ' + nm + ' ' + ctx) }
        // 떨림(삐걱): 각도 변화 방향이 바뀌는데 양쪽 변화가 모두 4° 넘음
        const d = a1 - a0
        if (lastD[nm] !== undefined && Math.sign(d) !== Math.sign(lastD[nm]) && Math.abs(d) > 4 && Math.abs(lastD[nm]) > 4) { zig++; note('떨림 ' + nm) }
        if (Math.abs(d) > 4) lastD[nm] = d
        // 접혀 있다가(<120°) 한 걸음에 곧게(>170°) 펴지는 팝
        if (a0 < 120 && a1 > 170) straightPop++
      }
      prev = p
    }
  }
  // 점프 키프레임 자세 검사
  fr.filter((f) => f.k === 'jump').forEach((f) => { const p = f.fig.p; let bad = false
    if (Math.min(p.footL.y, p.footR.y) < 0.15) bad = true // 바닥 근처에서 뜸
    if (p.hl.y < p.hip.y || p.hr.y < p.hip.y) bad = true // 손이 허리 아래
    if (bad) jumpBad++ })
}
console.log('샘플', samples, '· 고정 손발이 4cm↑ 끌려감', drift, `(최대 ${(driftMax * 100).toFixed(0)}cm)`, '· 팔이 몸통 관통', pierce, '· 굽힘 뒤집힘', flips, '· 관절 급변(25°↑)', jitter, '· 각도 떨림', zig, '· 접힘→곧게 팝', straightPop, '· 점프 구간 프레임', jumpFrames, '· 이상한 점프 자세', jumpBad)
console.log(Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 40))
