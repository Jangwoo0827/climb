// 개발용 테스트 뷰어: testimage 폴더의 모든 이미지에서 홀드/볼륨 인식을 눌러 보며 확인한다.
// 합성 이미지(testimage/synthetic)는 truth.json 정답과 비교해 재현율/오검출을 계산한다.
import { detectHolds, pickTarget, sampleImage } from './utils/detect.js'

const urls = import.meta.glob('/testimage/**/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' })
const entries = Object.entries(urls).sort(([a], [b]) => a.localeCompare(b))
const grid = document.getElementById('grid')
const report = document.getElementById('report')
const cards = []

let truth = {}
try {
  truth = await (await fetch('/testimage/synthetic/truth.json')).json()
} catch {
  truth = {}
}

// decode()는 화면이 숨겨진 상태에서는 끝나지 않을 수 있어 onload로 기다림
const load = (url) =>
  new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('이미지를 불러오지 못했어요: ' + url))
    im.src = url
  })

function draw(card, dets, target, tapAt) {
  const { canvas, im, img, name } = card
  const g = canvas.getContext('2d')
  g.drawImage(im, 0, 0, canvas.width, canvas.height)
  const k = canvas.width / img.w
  const t = truth[name.split('/').pop()]
  if (t) {
    g.fillStyle = '#3b82ff'
    for (const pts of Object.values(t.groups))
      for (const [x, y] of pts) {
        g.beginPath()
        g.arc(x * (canvas.width / im.naturalWidth), y * (canvas.width / im.naturalWidth), 4, 0, 7)
        g.fill()
      }
  }
  g.lineWidth = Math.max(2, canvas.width / 300)
  for (const d of dets) {
    const cx = d.x * canvas.width
    const cy = d.y * canvas.height
    const r = Math.max(8, Math.sqrt(d.size * img.w * img.h / Math.PI) * k * 1.25)
    if (d.volume) {
      g.strokeStyle = '#7fd8ff'
      g.setLineDash([8, 5])
      g.beginPath()
      g.arc(cx, cy, r, 0, 7)
      g.stroke()
      g.setLineDash([])
      g.fillStyle = '#7fd8ff'
      for (const p of Object.values(d.extent ?? {})) {
        g.beginPath()
        g.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, 7)
        g.fill()
      }
      g.fillStyle = '#7fd8ff'
      g.font = `${Math.max(12, canvas.width / 40)}px sans-serif`
      g.fillText('볼륨', cx - 12, cy)
    } else {
      g.strokeStyle = '#3dff7a'
      g.beginPath()
      g.arc(cx, cy, r, 0, 7)
      g.stroke()
    }
  }
  if (tapAt) {
    g.strokeStyle = '#ff4dff'
    g.lineWidth = 3
    g.strokeRect(tapAt.x - 8, tapAt.y - 8, 16, 16)
  }
  const lab = target
    ? `L ${target.L.toFixed(0)} · 채도 ${target.chroma.toFixed(0)} · ${target.kind === 'gray' ? '회색/검정/흰색' : '색조 ' + target.hue.toFixed(0) + '°'}`
    : ''
  card.stat.innerHTML = target
    ? `홀드 ${dets.filter((d) => !d.volume).length}개 · 볼륨 ${dets.filter((d) => d.volume).length}개 · ${lab}`
    : '이미지에서 홀드를 눌러 보세요'
}

for (const [path, url] of entries) {
  const name = path.replace('/testimage/', '')
  const im = await load(url)
  const img = sampleImage(im, im.naturalWidth, im.naturalHeight)
  const card = document.createElement('div')
  card.className = 'card'
  const title = document.createElement('h2')
  title.textContent = `${name} (${im.naturalWidth}×${im.naturalHeight})`
  const canvas = document.createElement('canvas')
  canvas.width = Math.min(im.naturalWidth, 700)
  canvas.height = Math.round((canvas.width * im.naturalHeight) / im.naturalWidth)
  const stat = document.createElement('div')
  stat.className = 'stat'
  card.append(title, canvas, stat)
  grid.append(card)
  const c = { name, im, img, canvas, stat }
  cards.push(c)
  draw(c, [], null)
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect()
    const nx = (e.clientX - r.left) / r.width
    const ny = (e.clientY - r.top) / r.height
    const target = pickTarget(img, nx, ny)
    const t0 = performance.now()
    const dets = detectHolds(img, target)
    draw(c, dets, target, { x: nx * canvas.width, y: ny * canvas.height })
    c.stat.innerHTML += ` · ${(performance.now() - t0).toFixed(0)}ms`
  })
}

// ---- 합성 이미지 평가: 색 그룹마다 첫 홀드를 눌러 재현율/오검출/볼륨 인식을 계산
export async function evaluate() {
  const rows = []
  const vrows = []
  for (const c of cards) {
    const fname = c.name.split('/').pop()
    const t = truth[fname]
    if (!t) continue
    const { img, im } = c
    const s = img.w / im.naturalWidth
    const all = Object.entries(t.groups).flatMap(([g, pts]) => pts.map((p) => ({ g, x: p[0] * s, y: p[1] * s, r: p[2] * s })))
    const vols = (t.volumes ?? []).map((v) => ({ x: v[0] * s, y: v[1] * s, size: v[2] * s, kind: v[3], col: v[4] }))
    for (const [g, pts] of Object.entries(t.groups)) {
      const target = pickTarget(img, pts[0][0] / im.naturalWidth, pts[0][1] / im.naturalHeight)
      const dets = detectHolds(img, target).map((d) => ({ x: d.x * img.w, y: d.y * img.h, vol: d.volume }))
      const mine = all.filter((a) => a.g === g)
      const used = new Set()
      let hit = 0
      for (const m of mine) {
        const j = dets.findIndex((d, i) => !used.has(i) && Math.hypot(d.x - m.x, d.y - m.y) < m.r * 1.5 + 8)
        if (j >= 0) {
          hit++
          used.add(j)
        }
      }
      const fp = dets.filter((d, i) => !used.has(i)).filter((d) => !vols.some((v) => Math.hypot(d.x - v.x, d.y - v.y) < v.size * 2))
      rows.push({ image: fname.replace('.jpg', ''), group: g, truth: mine.length, hit, det: dets.length, fp: fp.length })
    }
    for (const v of vols) {
      const target = pickTarget(img, v.x / s / im.naturalWidth, (v.y - v.size * 0.2) / s / im.naturalHeight)
      const dets = detectHolds(img, target)
      const near = dets.filter((d) => d.volume && Math.hypot(d.x * img.w - v.x, d.y * img.h - v.y) < v.size * 1.6)
      vrows.push({ image: fname.replace('.jpg', ''), kind: v.kind, found: near.length > 0, pts: near.some((d) => d.extent) })
    }
  }
  return { rows, vrows }
}

function renderReport({ rows, vrows }) {
  const sum = rows.reduce((a, r) => ({ t: a.t + r.truth, h: a.h + r.hit, d: a.d + r.det, f: a.f + r.fp }), { t: 0, h: 0, d: 0, f: 0 })
  const vf = vrows.filter((v) => v.found).length
  let html = `<b>요약</b> · 정답 홀드 ${sum.t}개 중 <b>${sum.h}개 찾음 (재현율 ${((sum.h / sum.t) * 100).toFixed(0)}%)</b> · 오검출 <b>${sum.f}개</b> · 볼륨 ${vrows.length}개 중 <b>${vf}개 인식</b><br><br>`
  html += '<table><tr><th>이미지</th><th>누른 색</th><th>정답</th><th>찾음</th><th>검출</th><th>오검출</th></tr>'
  for (const r of rows)
    html += `<tr><td>${r.image}</td><td>${r.group}</td><td>${r.truth}</td><td class="${r.hit < r.truth ? 'bad' : 'good'}">${r.hit}</td><td>${r.det}</td><td class="${r.fp ? 'bad' : 'good'}">${r.fp}</td></tr>`
  html += '</table><br><table><tr><th>볼륨(이미지)</th><th>종류</th><th>인식</th><th>접점</th></tr>'
  for (const v of vrows)
    html += `<tr><td>${v.image}</td><td>${v.kind}</td><td class="${v.found ? 'good' : 'bad'}">${v.found ? '○' : '×'}</td><td>${v.pts ? '○' : '×'}</td></tr>`
  html += '</table>'
  report.innerHTML = html
  report.style.display = 'block'
}

document.getElementById('evalBtn').addEventListener('click', async () => {
  const res = await evaluate()
  window.__evalResult = res
  renderReport(res)
})
document.getElementById('clearBtn').addEventListener('click', () => {
  for (const c of cards) draw(c, [], null)
  report.style.display = 'none'
})
window.__evaluate = evaluate
