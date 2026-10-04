// 볼륨 검출 확인: testimage 사진마다 다각형 볼륨을 찾고 후보별 모양 지표를 JSON으로 저장
// 실행: python로 RGBA 덤프(.bin) 후 node scripts/volume-check.mjs a.bin [b.bin ...]
import { readFileSync, writeFileSync } from 'node:fs'
import { detectVolumes, fromRGBA } from '../src/utils/detect.js'
const res = {}
for (const f of process.argv.slice(2)) {
  const buf = readFileSync(f)
  const w = buf.readUInt32LE(0)
  const h = buf.readUInt32LE(4)
  const img = fromRGBA(new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, w * h * 4), w, h)
  const dbg = []
  const vols = detectVolumes(img, dbg)
  res[f] = { w, h, vols: vols.map((v) => ({ x: v.x, y: v.y })), cands: dbg }
  console.log(f, '볼륨', vols.length, '/ 큰 덩어리', dbg.length)
}
writeFileSync(process.env.OUT ?? 'volume-check.json', JSON.stringify(res))
