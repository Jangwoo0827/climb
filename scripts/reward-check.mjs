// src/utils/reward.js 의 가중치·파라미터가 rl/config/rewards.json(파이썬 보상 모듈)과 같은지 검사. 실행: node scripts/reward-check.mjs
import { readFileSync } from 'node:fs'
import { PARAMS, WEIGHTS } from '../src/utils/reward.js'

const cfg = JSON.parse(readFileSync(new URL('../rl/config/rewards.json', import.meta.url), 'utf-8'))
let bad = 0
for (const [k, v] of Object.entries(WEIGHTS)) if (cfg.terms[k] !== v) { bad++; console.log('가중치 다름', k, v, '≠', cfg.terms[k]) }
for (const [k, v] of Object.entries(PARAMS)) if (cfg.params[k] !== v) { bad++; console.log('파라미터 다름', k, v, '≠', cfg.params[k]) }
console.log(bad ? `불일치 ${bad}개` : `일치: 가중치 ${Object.keys(WEIGHTS).length}개, 파라미터 ${Object.keys(PARAMS).length}개`)
process.exitCode = bad ? 1 : 0
