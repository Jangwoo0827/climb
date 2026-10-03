// 홀드 분류 모델 평가: dataset/holds/test 의 사진으로 예측해 experiments/<이름>/predictions.json 저장
// 사용: python scripts/export_test_pixels.py  (테스트 사진을 픽셀 파일로)
//       node scripts/eval_hold_model.mjs <모델 폴더> <실험 이름>
//       python scripts/report_metrics.py <실험 이름>   (지표·혼동 행렬)
import fs from 'node:fs'
import path from 'node:path'
import * as tf from '@tensorflow/tfjs'

const [modelDir = 'public/models/holds', expName = 'experiment_000'] = process.argv.slice(2)
const meta = JSON.parse(fs.readFileSync(path.join(modelDir, 'metadata.json'), 'utf8'))
const topo = JSON.parse(fs.readFileSync(path.join(modelDir, 'model.json'), 'utf8'))
const weights = fs.readFileSync(path.join(modelDir, 'weights.bin'))
const model = await tf.loadLayersModel(
  tf.io.fromMemory({
    modelTopology: topo.modelTopology,
    weightSpecs: topo.weightsManifest.flatMap((g) => g.weights),
    weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
  }),
)

const index = JSON.parse(fs.readFileSync('dataset/holds/test_index.json', 'utf8'))
const pix = fs.readFileSync('dataset/holds/test_pixels.bin')
const S = index.size
const out = []
for (let i = 0; i < index.items.length; i++) {
  const arr = new Uint8Array(pix.buffer, pix.byteOffset + i * S * S * 3, S * S * 3)
  // Teachable Machine과 같은 입력: 224x224 RGB, 픽셀을 -1~1로. 한 장씩(이 모델은 여러 장을 한 번에 넣으면 섞임)
  const x = tf.tidy(() => tf.tensor3d(arr, [S, S, 3], 'int32').toFloat().div(127.5).sub(1).expandDims(0))
  const p = Array.from(await model.predict(x).data())
  x.dispose()
  const k = p.indexOf(Math.max(...p))
  out.push({ file: index.items[i].file, true: index.items[i].label, pred: meta.labels[k], prob: p[k], probs: Object.fromEntries(meta.labels.map((l, j) => [l, p[j]])) })
}
const dir = path.join('experiments', expName)
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'predictions.json'), JSON.stringify({ model: modelDir, labels: meta.labels, crop: meta.crop ?? 'loose', items: out }, null, 1))
console.log(`${out.length}장 예측 → ${dir}/predictions.json, 정확도 ${((out.filter((o) => o.true === o.pred).length / out.length) * 100).toFixed(1)}%`)
