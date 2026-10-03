import { useEffect, useMemo, useRef, useState } from 'react'
import { detectAllHolds, detectHolds, pickTarget, sampleImage } from './utils/detect.js'
import { FEET, HOLD_ORDER, HOLD_TYPES, MOVES, estimateHoldType } from './utils/glossary.js'
import { buildSequence } from './utils/stickman.js'
import { blendPose } from './utils/animate.js'
import { LEVELS, bodyModel, estimateGrade, findRoute, generateRoute, toMeters } from './utils/route.js'

// 사진 없이 체험할 수 있는 데모 벽 (초록색 = 우리 루트, 나머지는 다른 루트)
function makeDemoWall() {
  const W = 480
  const H = 640
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#8a8f98'
  g.fillRect(0, 0, W, H)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const blob = (x, y, r, color) => {
    g.fillStyle = color
    g.beginPath()
    g.ellipse(x, y, r * 1.2, r, rnd() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  const noise = ['#d63a3a', '#3a6fd6', '#e0c02e']
  for (let i = 0; i < 26; i++) blob(30 + rnd() * 420, 30 + rnd() * 580, 9 + rnd() * 7, noise[i % 3])
  // 아래에서 위로 이어지는 루트 (초록)
  const route = [
    [190, 590, 15], [280, 545, 12], [200, 490, 10], [300, 440, 14], [220, 385, 9],
    [310, 335, 12], [240, 280, 15], [330, 230, 10], [250, 175, 12], [190, 125, 9],
    [260, 70, 16],
  ]
  route.forEach(([x, y, r]) => blob(x, y, r, '#2fbf5a'))
  return c
}

// 벽 사진 위에 그리는 졸라맨
function Stickman({ p, sv, headR, hard, label, u }) {
  const line = (pts) => pts.map(sv).join(' ')
  const color = hard ? '#ff8a6b' : '#ffffff'
  const limbs = [
    [p.shL, p.elL, p.hl],
    [p.shR, p.elR, p.hr],
    [p.hipL, p.kneeL, p.footL],
    [p.hipR, p.kneeR, p.footR],
  ]
  const halo = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }
  const draw = (stroke, w) => (
    <>
      <polyline {...halo} stroke={stroke} strokeWidth={w} points={line([p.shL, p.shR])} />
      {/* 몸통: 어깨 양쪽에서 같은 쪽 골반으로 이어 사다리꼴로 그림 */}
      <polyline {...halo} stroke={stroke} strokeWidth={w} points={line([p.shL, p.hipL, p.hipR, p.shR])} />
      <polyline {...halo} stroke={stroke} strokeWidth={w} points={line([p.hipL, p.hipR])} />
      {limbs.map((l, i) => <polyline key={i} {...halo} stroke={stroke} strokeWidth={w} points={line(l)} />)}
    </>
  )
  const [hx, hy] = sv(p.head).split(',')
  return (
    <g>
      {draw('rgba(0,0,0,0.6)', 7 * u)}
      {draw(color, 4 * u)}
      <circle cx={hx} cy={hy} r={Math.max(headR, 8 * u)} fill="rgba(0,0,0,0.45)" stroke={color} strokeWidth={4 * u} />
      {label && (
        <text x={Number(hx) + Math.max(headR, 8 * u) + 6 * u} y={Number(hy) + 6 * u} textAnchor="start" fontSize={17 * u} fontWeight="800" fill="#c77dff" stroke="#000" strokeWidth={3 * u} paintOrder="stroke">
          {label}
        </text>
      )}
    </g>
  )
}

// 「내 몸」 탭 오른쪽에 그리는, 입력한 키와 팔 벌린 길이 비율대로의 졸라맨
function BodyFigure({ height, wingspan }) {
  const H = height
  const W = wingspan
  const vbW = Math.max(W * 1.25, H * 0.7)
  const vbH = H * 1.18
  const cx = vbW / 2
  const floorY = H * 1.08
  const y = (up) => floorY - up // 바닥 기준 높이(cm) -> svg y
  const hip = 0.48 * H
  const sh = 0.8 * H
  const headC = sh + 0.117 * H
  const r = 0.067 * H
  const sw = Math.max(H, W) * 0.011
  const stroke = { stroke: '#fff', strokeWidth: sw, strokeLinecap: 'round', fill: 'none' }
  const dim = { stroke: '#ffd400', strokeWidth: sw * 0.5, strokeDasharray: `${sw * 2} ${sw * 1.5}` }
  const font = Math.max(H, W) * 0.055
  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="xMidYMid meet" className="bodysvg" role="img" aria-label="입력한 체형의 졸라맨">
      <line x1={cx - W / 2} x2={cx + W / 2} y1={floorY} y2={floorY} stroke="#3a4152" strokeWidth={sw * 0.6} />
      <circle cx={cx} cy={y(headC)} r={r} {...stroke} />
      <line x1={cx} x2={cx} y1={y(sh)} y2={y(hip)} {...stroke} />
      <line x1={cx - W / 2} x2={cx + W / 2} y1={y(sh)} y2={y(sh)} {...stroke} />
      <polyline points={`${cx - 0.13 * H},${y(0)} ${cx},${y(hip)} ${cx + 0.13 * H},${y(0)}`} {...stroke} strokeLinejoin="round" />
      <line x1={cx - W / 2} x2={cx - W / 2} y1={y(0)} y2={y(H)} {...dim} />
      <text x={cx - W / 2 + font * 0.4} y={y(H) + font} fontSize={font} fill="#ffd400">키 {Math.round(H)}</text>
      <line x1={cx - W / 2} x2={cx + W / 2} y1={y(sh) - H * 0.05} y2={y(sh) - H * 0.05} {...dim} />
      <text x={cx + W / 2} y={y(sh) - H * 0.07} fontSize={font} fill="#ffd400" textAnchor="end">팔 {Math.round(W)}</text>
    </svg>
  )
}

function useTweenPose(target, ms = 700) {
  const [shown, setShown] = useState(target)
  const fromRef = useRef(target)
  const shownRef = useRef(target)
  useEffect(() => {
    if (!target) {
      shownRef.current = null
      setShown(null)
      return
    }
    const from = shownRef.current
    if (!from) {
      shownRef.current = target
      setShown(target)
      return
    }
    fromRef.current = from
    let raf
    const t0 = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / ms)
      const p = blendPose(fromRef.current, target, t)
      shownRef.current = p
      setShown(p)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    // 화면이 가려져 애니메이션 프레임이 멈춰도 최종 자세로는 넘어가게 함
    const done = setTimeout(() => {
      cancelAnimationFrame(raf)
      shownRef.current = target
      setShown(target)
    }, ms + 80)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(done)
    }
  }, [target, ms])
  return shown
}

const defaultBody = { height: '165', wingspan: '165', flexibility: '3', wall: '3.5' }
const pos = (s, d) => {
  const v = parseFloat(s)
  return Number.isFinite(v) && v > 0 ? v : d
}
const anyNum = (s, d) => {
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : d
}
const median = (arr) => {
  if (!arr.length) return 0.002
  const a = [...arr].sort((x, y) => x - y)
  return a[a.length >> 1]
}

// 컨테이너 안에 사진 비율을 유지한 채 꽉 채워 넣을 크기를 계산
function useFit(ref, aspect, dep) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el || !aspect) return
    const calc = () => {
      const { width, height } = el.getBoundingClientRect()
      const w = Math.min(width, height * aspect)
      setSize({ w, h: w / aspect })
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, aspect, dep])
  return size
}

function NumField({ label, unit, value, onChange, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="inp">
        <input type="number" inputMode="decimal" step="any" value={value} onChange={(e) => onChange(e.target.value)} />
        <em>{unit}</em>
      </div>
      {hint && <small>{hint}</small>}
    </label>
  )
}

function HoldIcon({ type, size = 44 }) {
  const t = HOLD_TYPES[type]
  if (!t) return null
  return (
    <svg viewBox="0 0 48 32" width={size} height={(size * 32) / 48} aria-hidden="true">
      <path d={t.icon} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}

export default function App() {
  const [tab, setTab] = useState('course') // course | body | terms
  const [raw, setRaw] = useState(defaultBody) // 입력창에 적힌 글자 그대로(제한 없음)
  const [level, setLevel] = useState('beginner')
  const [photo, setPhoto] = useState(null) // {url, img, aspect}
  const [target, setTarget] = useState(null)
  const [holds, setHolds] = useState([])
  const [frameIdx, setFrameIdx] = useState(0) // 0=출발 자세, 이후 동작별 프레임(점프는 공중+착지 2프레임)
  const [feetFree, setFeetFree] = useState(true) // 발 자유: 다른 색 홀드도 발로 씀
  const [mode, setMode] = useState('edit') // edit | start | finish | type
  const [term, setTerm] = useState({ kind: 'move', key: null })
  const boxRef = useRef(null)
  const stageRef = useRef(null)
  const fileRef = useRef(null)
  const fit = useFit(stageRef, photo?.aspect, tab + (target ? 't' : 'f'))

  // 입력창의 글자를 숫자로 바꿈. 비었거나 잘못 쓰면 기본값을 대신 씀(입력 자체는 제한하지 않음)
  const height = pos(raw.height, 165)
  const wingspan = pos(raw.wingspan, height)
  const flexibility = anyNum(raw.flexibility, 3)
  const wallWidth = pos(raw.wall, 3.5)
  const setR = (key, v) => setRaw((r) => ({ ...r, [key]: v }))

  const loadCanvasOrImage = (source, w, h, url) => {
    setPhoto({ url, img: sampleImage(source, w, h), aspect: w / h })
    setTarget(null)
    setHolds([])
    setFrameIdx(0)
    setMode('edit')
  }

  const useDemo = () => {
    const c = makeDemoWall()
    loadCanvasOrImage(c, c.width, c.height, c.toDataURL())
  }

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const url = URL.createObjectURL(f)
    const im = new Image()
    im.onload = () => loadCanvasOrImage(im, im.naturalWidth, im.naturalHeight, url)
    im.src = url
    e.target.value = ''
  }

  // 홀드 종류: 직접 고친 값이 있으면 그것을, 없으면 모양으로 추정한 값을 씀
  const normalSize = useMemo(() => median(holds.filter((h) => !h.volume).map((h) => h.size)), [holds])
  const typedHolds = useMemo(
    () => holds.map((h) => ({ ...h, type: h.type ?? (h.volume ? 'volume' : estimateHoldType(h, normalSize)) })),
    [holds, normalSize],
  )
  // 경로 탐색에 쓰는 자리: 볼륨은 가장자리(위/왼쪽/오른쪽/아래)와 중앙을 손·발 자리로 펼침
  const usable = useMemo(() => {
    const out = []
    typedHolds.forEach((h, i) => {
      if (h.type === 'volume' && h.extent) {
        for (const pt of [h.extent.top, h.extent.left, h.extent.right, h.extent.bottom, { x: h.x, y: h.y }]) {
          out.push({ x: pt.x, y: pt.y, size: normalSize, type: 'volume', parent: i, role: h.role })
        }
      } else out.push({ ...h, parent: i })
    })
    return out
  }, [typedHolds, normalSize])

  const onTap = (e) => {
    if (!photo) return
    const r = boxRef.current.getBoundingClientRect()
    const nx = (e.clientX - r.left) / r.width
    const ny = (e.clientY - r.top) / r.height
    if (!target) {
      const t = pickTarget(photo.img, nx, ny)
      setTarget(t)
      setHolds(detectHolds(photo.img, t))
      setFrameIdx(0)
      return
    }
    const nearest = holds.reduce(
      (b, h, i) => {
        const d = Math.hypot((h.x - nx) * photo.aspect, h.y - ny)
        return d < b.d ? { i, d } : b
      },
      { i: -1, d: Infinity },
    )
    setFrameIdx(0)
    if (mode === 'edit') {
      // 가까운 홀드는 제거, 빈 곳은 홀드 추가
      if (nearest.d < 0.035) setHolds(holds.filter((_, i) => i !== nearest.i))
      else setHolds([...holds, { x: nx, y: ny, size: normalSize, type: 'jug' }])
    } else if (mode === 'type') {
      // 홀드를 누를 때마다 종류가 바뀜
      if (nearest.d < 0.06) {
        const cur = typedHolds[nearest.i].type
        const next = HOLD_ORDER[(HOLD_ORDER.indexOf(cur) + 1) % HOLD_ORDER.length]
        setHolds(holds.map((h, i) => (i === nearest.i ? { ...h, type: next } : h)))
      }
    } else if (nearest.d < 0.06) {
      // 시작/끝 홀드 지정: 같은 홀드를 다시 누르면 해제. 시작은 최대 2개
      let next = holds.map((h, i) => (i === nearest.i ? { ...h, role: h.role === mode ? undefined : mode } : h))
      const starts = next.map((h, i) => (h.role === 'start' ? i : -1)).filter((i) => i >= 0 && i !== nearest.i)
      if (mode === 'start' && next[nearest.i].role === 'start' && starts.length >= 2) {
        next = next.map((h, i) => (i === starts[0] ? { ...h, role: undefined } : h))
      }
      setHolds(next)
    }
  }

  const model = useMemo(
    () => bodyModel({ height, apeIndex: wingspan / height, flexibility, level }),
    [height, wingspan, flexibility, level],
  )

  // 발 자유용: 사진 속 모든 색의 홀드(경로 홀드와 겹치는 것은 제외)
  const allHolds = useMemo(() => (photo ? detectAllHolds(photo.img) : []), [photo])
  const footExtras = useMemo(() => {
    if (!feetFree || !photo) return []
    return allHolds
      .filter((a) => !usable.some((u) => Math.hypot((u.x - a.x) * photo.aspect, u.y - a.y) < 0.03))
      .map((a) => ({ ...a, type: 'jug', footOnly: true }))
  }, [feetFree, allHolds, usable, photo])

  const plan = useMemo(() => {
    if (!photo || usable.length < 3) return null
    const m = toMeters([...usable, ...footExtras], wallWidth, photo.aspect)
    const ys = m.slice(0, usable.length).map((h) => h.my)
    const lo = Math.min(...ys)
    const hi = Math.max(...ys)
    const span = hi - lo || 1
    // 직접 지정한 시작/끝 홀드가 있으면 그것을 쓰고, 없으면 맨 아래 20% / 맨 위 10%를 자동으로 사용
    const picked = (role) => usable.map((h, i) => (h.role === role ? i : -1)).filter((i) => i >= 0)
    const handM = m.slice(0, usable.length)
    const startIds = picked('start').length ? picked('start') : handM.filter((h) => h.my < lo + span * 0.2).map((h) => h.id)
    const finishIds = picked('finish').length ? picked('finish') : handM.filter((h) => h.my > hi - span * 0.1).map((h) => h.id)
    const route = findRoute(m, model, startIds, finishIds)
    return { m, route }
  }, [photo, usable, footExtras, wallWidth, model])

  const nSteps = plan?.route?.steps.length ?? 0
  // 프레임: 출발 → (발 옮기기 → 손 옮기기)… 한 프레임에 팔다리 하나만 움직임
  const frames = useMemo(() => (plan?.route ? buildSequence(plan.route, plan.m, model, height / 100) : []), [plan, model, height])
  const fi = Math.min(frameIdx, Math.max(0, frames.length - 1))
  const frame = frames[fi] ?? { k: 'start' }
  const idx = frame.k === 'start' ? -1 : frame.i // 현재 보고 있는 동작 번호(0부터)
  const step = idx >= 0 ? plan?.route?.steps[idx] : null
  const hardCount = plan?.route?.steps.filter((s) => s.hard).length ?? 0
  const grade = plan?.route ? estimateGrade(plan.route, plan.m, model) : null
  const dynoCount = plan?.route?.steps.filter((s) => s.dyno).length ?? 0
  const fig = frame.fig ?? null
  const isFoot = frame.k === 'foot'
  // 발 홀드 순서: 전체 경로를 따라가며 발이 처음 딛는 홀드에 발1, 발2 … 번호를 붙임
  const footOrder = useMemo(() => {
    if (!plan?.route) return []
    const order = []
    for (const f of frames) for (const id of f.fig.feetOnHolds) if (!order.includes(id)) order.push(id)
    return order
  }, [plan, frames])
  const shownPose = useTweenPose(fig?.p ?? null)
  const [playing, setPlaying] = useState(false)
  // 재생: 처음부터 마지막 동작까지 자동으로 한 동작씩 넘김
  useEffect(() => {
    if (!playing) return
    if (fi >= frames.length - 1) {
      setPlaying(false)
      return
    }
    const id = setTimeout(() => setFrameIdx(fi + 1), frame.k === 'jump' ? 650 : frame.k === 'foot' ? 950 : 1200)
    return () => clearTimeout(id)
  }, [playing, fi, frames.length, frame.k])
  const togglePlay = () => {
    if (playing) setPlaying(false)
    else {
      if (fi >= frames.length - 1) setFrameIdx(0)
      setPlaying(true)
    }
  }

  // 미터 -> SVG 좌표 (viewBox 높이 1 = 벽 높이)
  const k = photo ? photo.aspect / wallWidth : 1
  const sv = (p) => `${p.x * k},${1 - p.y * k}`
  const u = fit.h ? 1 / fit.h : 0.002 // 화면 1픽셀에 해당하는 SVG 단위: 사진 크기와 상관없이 표시가 읽히게

  // 루트 생성(GenClimb 아이디어): 사진 속 모든 홀드에서 고른 난이도에 맞는 루트를 만듦. 누를 때마다 다른 루트
  const [genOpen, setGenOpen] = useState(false)
  const [genGrade, setGenGrade] = useState(2)
  const [genSeed, setGenSeed] = useState(1)
  const [genMsg, setGenMsg] = useState('')
  const generate = (grade) => {
    if (!photo) return
    const m = toMeters(allHolds, wallWidth, photo.aspect)
    let res = null
    let seed = genSeed
    for (let tries = 0; tries < 12 && !res; tries++) res = generateRoute(m, model, grade, ++seed)
    setGenSeed(seed)
    if (!res) {
      setGenMsg('이 사진에서는 그 난이도의 루트를 만들지 못했어요. 벽 너비나 난이도를 바꿔 보세요')
      return
    }
    const role = (i) => (res.start.includes(i) ? 'start' : res.finish.includes(i) ? 'finish' : undefined)
    setHolds([
      ...res.hands.map((i) => ({ ...allHolds[i], role: role(i) })),
      ...res.feet.map((i) => ({ ...allHolds[i], footOnly: true })),
    ])
    setTarget({ kind: 'gen' })
    setFrameIdx(0)
    setMode('edit')
    setGenOpen(false) // 루트를 만들면 난이도 줄을 접어 벽 사진을 크게
    setGenMsg(`손 홀드 ${res.hands.length}개 · 발 전용 ${res.feet.length}개로 V${grade} 목표 루트를 만들었어요`)
  }

  const resetPick = () => {
    setTarget(null)
    setHolds([])
    setFrameIdx(0)
    setMode('edit')
  }
  const openTerm = (kind, key) => {
    setTerm({ kind, key })
    setTab('terms')
  }

  // 용어 탭에서 선택한 항목이 보이게 스크롤
  useEffect(() => {
    if (tab !== 'terms' || !term.key) return
    document.getElementById(`term-${term.kind}-${term.key}`)?.scrollIntoView({ block: 'center' })
  }, [tab, term])

  const moveKey = isFoot ? null : (fig?.move ?? step?.move ?? null)
  // 발 프레임: 옮긴 발과 그 발이 딛는 홀드
  const movedFoot = isFoot ? fig?.feetInfo.find((f) => f.side === frame.side) : null
  const movedFootLabel = movedFoot ? (movedFoot.id !== null && footOrder.includes(movedFoot.id) ? `발${footOrder.indexOf(movedFoot.id) + 1} 홀드` : '벽(스미어)') : ''
  const footLabel = { L: '왼발', R: '오른발' }

  return (
    <div className="app">
      <header className="top">
        <h1>🧗 클라이밍 도우미 <small className="ver">{__APP_VERSION__}</small></h1>
        {photo && tab === 'course' && (
          <div className="actions">
            <button className={genOpen ? 'icon on' : 'icon'} onClick={() => setGenOpen(!genOpen)} aria-label="루트 생성">🎲</button>
            {target && <button className="icon" onClick={resetPick} aria-label="홀드 색 다시 고르기">🎨</button>}
            <button className="icon" onClick={() => fileRef.current.click()} aria-label="새 사진">📷</button>
          </div>
        )}
      </header>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      {tab === 'course' && (
        <main className="course">
          <div className="stage" ref={stageRef}>
            {!photo ? (
              <div className="empty">
                <div className="big">벽을 보여주세요</div>
                <p>사진을 찍으면 내 몸에 맞는<br />경로와 자세를 알려줘요</p>
                <button className="btn primary wide" onClick={() => fileRef.current.click()}>📷 사진 찍기 / 선택</button>
                <button className="btn wide" onClick={useDemo}>데모 벽으로 체험</button>
              </div>
            ) : (
              <div className="wall" ref={boxRef} onClick={onTap} style={{ width: fit.w, height: fit.h }}>
                <img src={photo.url} alt="벽" draggable="false" />
                <svg viewBox={`0 0 ${photo.aspect} 1`} preserveAspectRatio="none">
                  {plan?.route &&
                    [plan.route.startL, ...plan.route.steps.map((s) => s.to)].slice(1).map((id, j, arr) => {
                      const a = plan.m[j === 0 ? plan.route.startL : arr[j - 1]]
                      const b = plan.m[id]
                      return (
                        <line
                          key={j}
                          x1={a.nx * photo.aspect} y1={a.ny} x2={b.nx * photo.aspect} y2={b.ny}
                          stroke={plan.route.steps[j].dyno ? '#c77dff' : '#ffd400'}
                          strokeWidth={4 * u}
                          strokeDasharray={plan.route.steps[j].dyno ? `${9 * u} ${6 * u}` : undefined}
                        />
                      )
                    })}
                  {fig && shownPose && fig.feetInfo.map((f) =>
                    f.kind === 'smear' ? (
                      // 스미어: 홀드 없이 벽을 미는 발. 발바닥이 벽에 닿아 있음을 짧은 선으로 표시
                      <line key={'sm' + f.side} x1={Number(sv(shownPose[f.side === 'L' ? 'footL' : 'footR']).split(',')[0]) - 10 * u} x2={Number(sv(shownPose[f.side === 'L' ? 'footL' : 'footR']).split(',')[0]) + 10 * u} y1={Number(sv(shownPose[f.side === 'L' ? 'footL' : 'footR']).split(',')[1]) + 4 * u} y2={Number(sv(shownPose[f.side === 'L' ? 'footL' : 'footR']).split(',')[1]) + 4 * u} stroke="#4dd0ff" strokeWidth={4 * u} strokeLinecap="round" />
                    ) : null,
                  )}
                  {fig && shownPose && <Stickman p={shownPose} sv={sv} u={u} headR={0.06 * (height / 100) * k} hard={step?.hard} label={fig.airborne ? '점프!' : null} />}
                  {typedHolds.map((h, i) =>
                    h.type === 'volume' && h.extent ? (
                      <circle key={i} cx={h.x * photo.aspect} cy={h.y} r={Math.sqrt((h.size * photo.aspect) / Math.PI) * 0.85} fill="none" stroke="#b0e0ff" strokeWidth={2.5 * u} strokeDasharray={`${8 * u} ${5 * u}`} />
                    ) : (
                      <circle key={i} cx={h.x * photo.aspect} cy={h.y} r={8 * u} fill="none" stroke="#fff" strokeWidth={2 * u} />
                    ),
                  )}
                  {usable.map((u, i) =>
                    u.type === 'volume' ? <circle key={'v' + i} cx={u.x * photo.aspect} cy={u.y} r={4 * u} fill="#b0e0ff" stroke="#000" strokeWidth={1.5 * u} /> : null,
                  )}
                  {footOrder.map((id, n) => {
                    const h = plan.m[id]
                    const now = fig?.feetOnHolds.includes(id)
                    return (
                      <text key={'fo' + id} x={h.nx * photo.aspect + 12 * u} y={h.ny + 5 * u} fontSize={13 * u} fontWeight="800" fill={now ? '#4dd0ff' : '#9bdcf5'} opacity={now ? 1 : 0.75} stroke="#000" strokeWidth={3 * u} paintOrder="stroke">
                        발{n + 1}
                      </text>
                    )
                  })}
                  {[...new Set(fig?.feetOnHolds ?? [])].map((id) => (
                    <circle key={'f' + id} cx={plan.m[id].nx * photo.aspect} cy={plan.m[id].ny} r={12 * u} fill="none" stroke="#4dd0ff" strokeWidth={3.5 * u} />
                  ))}
                  {holds.map((h, i) =>
                    h.role ? (
                      <g key={'r' + i}>
                        <circle cx={h.x * photo.aspect} cy={h.y} r={15 * u} fill="none" stroke={h.role === 'start' ? '#3ddc84' : '#ff4d8d'} strokeWidth={4 * u} />
                        <text x={h.x * photo.aspect} y={h.y - 20 * u} textAnchor="middle" fontSize={14 * u} fontWeight="800" fill={h.role === 'start' ? '#3ddc84' : '#ff4d8d'} stroke="#000" strokeWidth={3 * u} paintOrder="stroke">
                          {h.role === 'start' ? '시작' : '끝'}
                        </text>
                      </g>
                    ) : null,
                  )}
                  {plan?.route?.steps.map((s) => {
                    const h = plan.m[s.to]
                    const on = s.index - 1 === idx
                    return (
                      <g key={s.index}>
                        <circle cx={h.nx * photo.aspect} cy={h.ny} r={on ? 13 * u : 10 * u} fill={s.dyno ? '#c77dff' : s.hard ? '#ff5a3c' : '#ffd400'} />
                        <text x={h.nx * photo.aspect} y={h.ny + 4.5 * u} textAnchor="middle" fontSize={13 * u} fontWeight="800" fill="#111">
                          {s.index}
                        </text>
                      </g>
                    )
                  })}
                  {/* 홀드 종류 이름: 「종류」 모드에서는 전부, 그 외에는 지금 잡는 홀드만 */}
                  {typedHolds.map((h, i) => {
                    const show = mode === 'type' || (step && plan?.m[step.to]?.parent === i)
                    if (!show) return null
                    return (
                      <text key={'t' + i} x={h.x * photo.aspect} y={h.y + 26 * u} textAnchor="middle" fontSize={12 * u} fontWeight="700" fill="#fff" stroke="#000" strokeWidth={3 * u} paintOrder="stroke">
                        {HOLD_TYPES[h.type]?.name}
                      </text>
                    )
                  })}
                </svg>
                {!target && <div className="banner">👆 따라갈 루트의 홀드 색을 눌러주세요</div>}
              </div>
            )}
          </div>

          {/* 오른쪽 패널: 루트 생성, 모드, 단계 안내 (벽 사진은 왼쪽에 크게) */}
          {photo && (genOpen || target) && (
          <aside className="side">
          {photo && genOpen && (
            <div className="genbar">
              <div className="grades">
                {[0, 1, 2, 3, 4, 5, 6].map((g) => (
                  <button key={g} className={genGrade === g ? 'on' : ''} onClick={() => setGenGrade(g)}>V{g}</button>
                ))}
              </div>
              <button className="genbtn" onClick={() => generate(genGrade)}>🎲 루트 생성</button>
              {genMsg && <small>{genMsg}</small>}
            </div>
          )}

          {photo && target && (
            <div className="modes">
              <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>✋ 편집</button>
              <button className={mode === 'start' ? 'on start' : ''} onClick={() => setMode('start')}>🟢 시작</button>
              <button className={mode === 'finish' ? 'on finish' : ''} onClick={() => setMode('finish')}>🏁 끝</button>
              <button className={mode === 'type' ? 'on' : ''} onClick={() => setMode('type')}>🏷 종류</button>
              <button className={feetFree ? 'on feet' : ''} onClick={() => setFeetFree(!feetFree)} title="다른 색 홀드도 발로 쓰기">🦶 발 자유</button>
            </div>
          )}

          {photo && target && (
            <div className="sheet">
              {!plan?.route ? (
                <p className="hint">점프까지 써도 이어지는 경로를 못 찾았어요. 「내 몸」 탭에서 사진 속 벽 너비가 맞는지 확인하고, 시작·끝 홀드를 다시 지정하거나 🎨로 홀드 색을 다시 골라 보세요.</p>
              ) : (
                <>
                  <div className="stepper">
                    <button className="nav" disabled={fi <= 0} onClick={() => { setPlaying(false); setFrameIdx(fi - 1) }}>◀</button>
                    <button className="nav play" onClick={togglePlay} aria-label={playing ? '멈춤' : '재생'}>{playing ? '❚❚' : '⏵'}</button>
                    <div className="stepinfo">
                      <b>{frame.k === 'start' ? '출발 자세' : frame.k === 'jump' ? `${idx + 1} / ${nSteps} · 점프 순간` : isFoot ? `${idx + 1} / ${nSteps} · 발 옮기기` : `${idx + 1} / ${nSteps} · 손${step?.dyno ? ' 착지' : ''}`}</b>
                      <small>{grade !== null && `난이도 추정 V${grade} · `}힘든 동작 {hardCount}번{dynoCount ? ` · 점프 ${dynoCount}번(점선)` : ''} · 발 홀드는 하늘색</small>
                    </div>
                    <button className="nav" disabled={fi >= frames.length - 1} onClick={() => { setPlaying(false); setFrameIdx(fi + 1) }}>▶</button>
                  </div>
                  <div className="pills">
                    {moveKey && MOVES[moveKey] && (
                      <button className="pill move" onClick={() => openTerm('move', moveKey)}>동작 · {MOVES[moveKey].name}</button>
                    )}
                    {!isFoot && step?.holdType && HOLD_TYPES[step.holdType] && (
                      <button className="pill hold" onClick={() => openTerm('hold', step.holdType)}>홀드 · {HOLD_TYPES[step.holdType].name}</button>
                    )}
                    {fig?.feetInfo.map((f) => (
                      <button key={f.side} className="pill foot" onClick={() => openTerm(f.kind === 'flag' ? 'move' : 'foot', f.kind === 'flag' ? 'flag' : f.kind)}>
                        {footLabel[f.side]} · {FEET[f.kind]?.name ?? f.kind}
                      </button>
                    ))}
                  </div>
                  <div className={step?.hard ? 'tips hard' : 'tips'}>
                    {isFoot ? (
                      <>
                        <h3>🦶 {frame.side === 'L' ? '왼발' : '오른발'}을 {movedFootLabel}로</h3>
                        <ul>
                          <li>손은 그대로 잡고 발만 옮겨요. 발을 먼저 올려 두면 다음 손 동작을 다리로 밀어 올릴 수 있어요</li>
                          {movedFoot && FEET[movedFoot.kind] && <li>{FEET[movedFoot.kind].name}: {FEET[movedFoot.kind].tip}</li>}
                        </ul>
                      </>
                    ) : step ? (
                      <>
                        <h3>{frame.k === 'jump' ? '🚀 ' : ''}{step.dyno ? '양손' : step.hand === 'L' ? '왼손' : '오른손'}을 {step.index}번 홀드로 {step.dyno ? '점프' : ''} <small>{step.move === 'match' ? '두 손 모으기' : `${Math.round(step.reach * 100)}cm`}</small></h3>
                        <ul>{step.tips.map((t) => <li key={t}>{t}</li>)}</ul>
                      </>
                    ) : (
                      <>
                        <h3>출발 자세</h3>
                        <ul><li>양손으로 시작 홀드를 잡고 발을 벽에 붙이세요. ▶를 눌러 한 동작씩 확인하세요</li></ul>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          </aside>
          )}
        </main>
      )}

      {tab === 'body' && (
        <main className="bodytab">
          <div className="bodygrid">
            <div className="fields">
              <NumField label="키" unit="cm" value={raw.height} onChange={(v) => setR('height', v)} />
              <NumField label="팔 벌린 길이" unit="cm" value={raw.wingspan} onChange={(v) => setR('wingspan', v)} hint="양팔을 옆으로 벌린 끝~끝" />
              <NumField label="유연성" unit="점" value={raw.flexibility} onChange={(v) => setR('flexibility', v)} hint="발을 높이 올리는 정도(하이 스텝), 기준 3" />
              <NumField label="사진 속 벽 너비" unit="m" value={raw.wall} onChange={(v) => setR('wall', v)} />
            </div>
            <div className="figure">
              <BodyFigure height={height} wingspan={wingspan} />
              <p className="hint">팔/키 비율 {(wingspan / height).toFixed(2)}</p>
            </div>
          </div>
          <div className="chips">
            {Object.entries(LEVELS).map(([key, v]) => (
              <button key={key} className={level === key ? 'chip on' : 'chip'} onClick={() => setLevel(key)}>
                {v.label}
              </button>
            ))}
          </div>
          <p className="hint">
            내 팔 길이 약 {model.span.toFixed(2)}m · 편하게 닿는 거리 {model.comfort.toFixed(2)}m · 최대 {model.maxReach.toFixed(2)}m · 점프 {model.jumpReach.toFixed(2)}m
          </p>
        </main>
      )}

      {tab === 'terms' && (
        <main className="termsTab">
          <div className="seg">
            {[['hold', '홀드'], ['move', '동작'], ['foot', '발 기술']].map(([kd, label]) => (
              <button key={kd} className={term.kind === kd ? 'on' : ''} onClick={() => setTerm({ kind: kd, key: null })}>{label}</button>
            ))}
          </div>
          <div className="list">
            {term.kind === 'hold' && HOLD_ORDER.map((key) => {
              const t = HOLD_TYPES[key]
              return (
                <article key={key} id={`term-hold-${key}`} className={term.key === key ? 'term sel' : 'term'}>
                  <div className="thead">
                    <span className="ticon"><HoldIcon type={key} /></span>
                    <h3>{t.name} <small>{t.en}</small></h3>
                  </div>
                  <p>{t.desc}</p>
                  <p className="sub">생김새: {t.look}</p>
                  <p className="tip">잡는 법: {t.grip}</p>
                </article>
              )
            })}
            {term.kind === 'move' && Object.entries(MOVES).map(([key, m]) => (
              <article key={key} id={`term-move-${key}`} className={term.key === key ? 'term sel' : 'term'}>
                <div className="thead">
                  <h3>{m.name} <small>{m.en}</small></h3>
                  <span className={m.auto ? 'badge auto' : 'badge'}>{m.auto ? '자동 추천' : '참고용'}</span>
                </div>
                <p>{m.desc}</p>
                <ul>{m.tips.map((t) => <li key={t}>{t}</li>)}</ul>
                <p className="sub">졸라맨: {m.pose}</p>
              </article>
            ))}
            {term.kind === 'foot' && Object.entries(FEET).map(([key, f]) => (
              <article key={key} id={`term-foot-${key}`} className={term.key === key ? 'term sel' : 'term'}>
                <div className="thead">
                  <h3>{f.name} <small>{f.en}</small></h3>
                  <span className={f.auto ? 'badge auto' : 'badge'}>{f.auto ? '자동 추천' : '참고용'}</span>
                </div>
                <p>{f.desc}</p>
                <p className="tip">요령: {f.tip}</p>
              </article>
            ))}
          </div>
        </main>
      )}

      <nav className="tabbar">
        <button className={tab === 'course' ? 'on' : ''} onClick={() => setTab('course')}><span>🧗</span>코스</button>
        <button className={tab === 'body' ? 'on' : ''} onClick={() => setTab('body')}><span>👤</span>내 몸</button>
        <button className={tab === 'terms' ? 'on' : ''} onClick={() => setTab('terms')}><span>📖</span>용어</button>
      </nav>
    </div>
  )
}
