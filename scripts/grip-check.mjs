// 홀드 종류가 자세에 반영되는지: 언더클링은 어깨가 홀드 위, 사이드풀은 몸이 홀드 옆으로 빠짐, 슬로퍼는 어깨가 홀드보다 충분히 아래
// 실행: node scripts/grip-check.mjs
import { bodyModel, findRoute, toMeters } from '../src/utils/route.js'
import { buildSequence } from '../src/utils/stickman.js'
const types = ['undercling', 'sidepull', 'sloper', 'jug']
const px = [[190, 590], [280, 545], [200, 490], [300, 440], [220, 385], [310, 335], [240, 280], [330, 230], [250, 175], [190, 125], [260, 70]].map(([x, y]) => [x / 480, y / 640])
const st = Object.fromEntries(types.map((t) => [t, { n: 0, dy: 0, dx: 0 }]))
for (const height of [150, 165, 185])
  for (let rot = 0; rot < 4; rot++) {
    // 시작·끝을 뺀 홀드에 종류를 돌려가며 배정
    const holds = toMeters(px.map(([x, y], i) => ({ x, y, size: 0.003, type: i === 0 || i === 10 ? 'jug' : types[(i + rot) % 4] })), 3.5, 0.75)
    const body = bodyModel({ height, apeIndex: 1, flexibility: 3, level: 'beginner' })
    const r = findRoute(holds, body, [0], [10])
    if (!r) continue
    const arm = (body.span - 0.23 * height / 100) / 2
    for (const fr of buildSequence(r, holds, body, height / 100)) {
      if (fr.k !== 'hand') continue
      const p = fr.fig.p
      for (const id of fr.fig.hands) {
        const h = holds[id]
        const hp = Math.hypot(p.hl.x - h.mx, p.hl.y - h.my) < Math.hypot(p.hr.x - h.mx, p.hr.y - h.my) ? p.shL : p.shR
        const s = st[h.type]
        if (!s) continue
        s.n++
        s.dy += (hp.y - h.my) / arm // + 이면 어깨가 홀드보다 위
        s.dx += Math.abs(hp.x - h.mx) / arm
      }
    }
  }
for (const [t, s] of Object.entries(st)) console.log(t.padEnd(11), 'n', s.n, '어깨-홀드 높이(팔길이)', (s.dy / s.n).toFixed(2), '옆 거리', (s.dx / s.n).toFixed(2))
