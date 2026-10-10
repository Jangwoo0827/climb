// 코스 후보 여러 개를 만들어 점수(강화학습 보상 함수로 매긴 자세 점수)로 순위를 매긴다.
// 후보: 첫 코스를 만들고, 이미 쓴 홀드에 비용을 더해 다시 탐색해서 서로 다른 코스를 얻음.
// 점수: 코스의 자세 프레임마다 보상 점수를 합한 뒤 프레임 수로 나눈 평균(긴 코스가 합계로 유리해지지 않게)
import { estimateGrade, findRoute } from './route.js'
import { buildSequence } from './stickman.js'
import { scoreFrames } from './reward.js'

export function rankRoutes({ m, startIds, finishIds }, body, heightM, obstacles = [], count = 3) {
  const pen = {}
  const fixed = new Set([...startIds, ...finishIds])
  const seen = new Set()
  const out = []
  for (let attempt = 0; attempt < 10 && out.length < count; attempt++) {
    const route = findRoute(m, body, startIds, finishIds, { holdPenalty: pen })
    if (!route) break
    const sig = route.steps.map((s) => `${s.hand}${s.to}`).join(',')
    for (const st of route.steps) if (!fixed.has(st.to)) pen[st.to] = (pen[st.to] ?? 0) + 1.5 // 다음 탐색은 이 홀드를 덜 쓰게
    if (seen.has(sig)) continue
    seen.add(sig)
    const frames = buildSequence(route, m, body, heightM, { obstacles })
    const sc = scoreFrames(frames, m, heightM)
    out.push({ route, score: sc.total / Math.max(1, frames.length), grade: estimateGrade(route, m, body), moves: route.steps.length })
  }
  return out.sort((a, b) => b.score - a.score)
}
