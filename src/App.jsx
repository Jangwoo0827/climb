import { Suspense, lazy, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { detectAllHolds, detectHolds, detectVolumes, filterByTarget, pickTarget, sampleImage, volumeExtent } from './utils/detect.js'
import { detectHoldsCloud, getRfKey, setRfKey } from './utils/rfDetect.js'
import { FEET, HOLD_ORDER, HOLD_TYPES, MOVES, estimateHoldType } from './utils/glossary.js'
import { buildSequence } from './utils/stickman.js'
import { blendPose, moversOf } from './utils/animate.js'
import { TERM_NAMES, scoreFrames } from './utils/reward.js'
import { pose3d, project } from './utils/depth.js'
import { holdOutline, holdProfile, insidePoly, volumeBase, volumeHeight, volumeNormal, volumeSurfaceZ } from './utils/hold3d.js'
import { estimateScaleFromImage, isReliable } from './utils/scale.js'
import { defaultFace, rectifyFaces } from './utils/rectify.js'
import { adjacentFace, buildWall3D } from './utils/wall3d.js'
import { handPose } from './utils/hand.js'

const View3D = lazy(() => import('./View3D.jsx'))
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

// 홀드 h가 사실 볼륨 vol 자체인지: 중심이 볼륨 상자 안이고, 상자 넓이가 볼륨 상자의 35% 이상(볼륨 위의 작은 홀드는 아님)
function isVolumeItself(h, vol) {
  if (h === vol || h.type === 'volume' || !vol.box) return false
  const b = vol.box
  if (h.x < b.x0 || h.x > b.x1 || h.y < b.y0 || h.y > b.y1) return false
  const area = (bx) => (bx.x1 - bx.x0) * (bx.y1 - bx.y0)
  const ha = h.box ? area(h.box) : h.size / 0.785
  return ha >= 0.35 * area(b)
}

// 벽 사진 위에 그리는 졸라맨(2.5D): 벽에서 먼 부위는 살짝 비스듬히 옮기고 굵게, 벽 쪽 부위는 가늘게
function Stickman({ p3, sv, headR, hard, label, u, heightM, handTypes }) {
  const P = Object.fromEntries(Object.entries(p3).map(([k, q]) => [k, project(q)]))
  const color = hard ? '#ff8a6b' : '#ffffff'
  const segs = [
    ['shL', 'shR'], ['shL', 'hipL'], ['shR', 'hipR'], ['hipL', 'hipR'],
    ['shL', 'elL'], ['elL', 'hl'], ['shR', 'elR'], ['elR', 'hr'],
    ['hipL', 'kneeL'], ['kneeL', 'footL'], ['hipR', 'kneeR'], ['kneeR', 'footR'],
  ]
    .map(([a, b]) => ({ a, b, z: (p3[a].z + p3[b].z) / 2 }))
    .sort((x, y) => x.z - y.z) // 벽 쪽(뒤)부터 그려 앞 부위가 위에 오게
  const wOf = (z) => 1 + (z / heightM) * 2.2
  const halo = { fill: 'none', strokeLinecap: 'round' }
  const [hx, hy] = sv(P.head).split(',')
  const hr = Math.max(headR, 8 * u) * wOf(p3.head.z) * 0.8
  return (
    <g>
      {segs.map((sg) => (
        <g key={sg.a + sg.b}>
          <polyline {...halo} stroke="rgba(0,0,0,0.6)" strokeWidth={7 * u * wOf(sg.z)} points={`${sv(P[sg.a])} ${sv(P[sg.b])}`} />
          <polyline {...halo} stroke={color} strokeOpacity={0.75 + Math.min(0.25, sg.z / heightM)} strokeWidth={4 * u * wOf(sg.z)} points={`${sv(P[sg.a])} ${sv(P[sg.b])}`} />
        </g>
      ))}
      {/* 손: 홀드 종류별 잡는 모양(손바닥, 손가락, 엄지) */}
      {[['L', 'hl', 'elL'], ['R', 'hr', 'elR']].map(([side, hk, ek]) => {
        const hd = handPose(handTypes?.[side], p3[hk], p3[ek], side, heightM, p3[side === 'L' ? 'gripL' : 'gripR'])
        const pts = (arr) => arr.map((q) => sv(project(q))).join(' ')
        return (
          <g key={side}>
            <polygon points={pts(hd.palm)} fill="#ffd9b3" stroke="#000" strokeWidth={1.2 * u} />
            {[...hd.fingers, hd.thumb].map((ch, i) => (
              <polyline key={i} points={pts(ch)} fill="none" stroke="#ffd9b3" strokeWidth={2.2 * u} strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </g>
        )
      })}
      <circle cx={hx} cy={hy} r={hr} fill="rgba(0,0,0,0.45)" stroke={color} strokeWidth={4 * u} />
      {label && (
        <text x={Number(hx) + hr + 6 * u} y={Number(hy) + 6 * u} textAnchor="start" fontSize={17 * u} fontWeight="800" fill="#c77dff" stroke="#000" strokeWidth={3 * u} paintOrder="stroke">
          {label}
        </text>
      )}
    </g>
  )
}

// 옆에서 본 모습: 왼쪽이 벽, 오른쪽이 벽 바깥. 홀드를 딛은 발과 벽을 미는 발(하늘색)이 구분돼 보임
function SideView({ p3, feetInfo, heightM }) {
  const H = 190
  const ys = Object.values(p3).map((q) => q.y)
  const lo = Math.max(0, Math.min(...ys) - 0.15)
  const hi = Math.max(...ys) + 0.15
  const sc = (H - 10) / (hi - lo)
  const wallX = 18
  const W = Math.max(110, wallX + 0.75 * sc + 10) // 벽에서 75cm까지 보이게(가로세로 같은 비율)
  const X = (q) => wallX + q.z * sc
  const Y = (q) => H - 5 - (q.y - lo) * sc
  const pt = (q) => `${X(q).toFixed(1)},${Y(q).toFixed(1)}`
  const side = (s) => [[s === 'L' ? 'shL' : 'shR', s === 'L' ? 'elL' : 'elR', s === 'L' ? 'hl' : 'hr'], [s === 'L' ? 'hipL' : 'hipR', s === 'L' ? 'kneeL' : 'kneeR', s === 'L' ? 'footL' : 'footR']]
  const smear = (s) => feetInfo?.find((f) => f.side === s)?.id === null
  return (
    <svg className="sideview" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="옆에서 본 자세">
      <rect x={0} y={0} width={wallX} height={H} fill="#3a4152" />
      {lo <= 0.001 && <line x1={0} x2={W} y1={Y({ y: 0 })} y2={Y({ y: 0 })} stroke="#555" strokeWidth={2} />}
      {['hl', 'hr'].map((k) => <circle key={k} cx={wallX} cy={Y(p3[k])} r={4} fill="#ffd400" />)}
      {['L', 'R'].map((s) => !smear(s) && <circle key={s} cx={wallX} cy={Y(p3[s === 'L' ? 'footL' : 'footR'])} r={4} fill="#4dd0ff" />)}
      {/* 먼 쪽(왼쪽 팔다리)은 흐리게, 가까운 쪽(오른쪽)은 진하게 */}
      {['L', 'R'].map((s) => side(s).map((ch, i) => (
        <polyline key={s + i} points={ch.map((k) => pt(p3[k])).join(' ')} fill="none" stroke={s === 'L' ? 'rgba(255,255,255,0.45)' : '#fff'} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      )))}
      <polyline points={[p3.neck, p3.hip].map(pt).join(' ')} fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" />
      <circle cx={X(p3.head)} cy={Y(p3.head)} r={0.06 * heightM * sc} fill="none" stroke="#fff" strokeWidth={2.5} />
      {['L', 'R'].map((s) => smear(s) && <line key={'sm' + s} x1={wallX - 1} x2={wallX - 1} y1={Y(p3[s === 'L' ? 'footL' : 'footR']) - 6} y2={Y(p3[s === 'L' ? 'footL' : 'footR']) + 6} stroke="#4dd0ff" strokeWidth={3} strokeLinecap="round" />)}
      <text x={W - 3} y={11} textAnchor="end" fontSize={10} fill="#9aa3b5">옆에서 본 모습</text>
    </svg>
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

// 애니메이션 중인 자세를 담는 작은 저장소. 매 프레임 값이 바뀌어도 앱 전체가 아니라 이 값을 구독한 부분(졸라맨, 측면, 3D)만 다시 그림
function usePoseTween(target, ms = 700) {
  const store = useRef(null)
  if (!store.current) {
    const subs = new Set()
    store.current = { value: target, get: () => store.current.value, subscribe: (f) => (subs.add(f), () => subs.delete(f)), set: (v) => ((store.current.value = v), subs.forEach((f) => f())) }
  }
  useEffect(() => {
    const st = store.current
    if (!target) return st.set(null)
    const from = st.value
    if (!from) return st.set(target)
    // 손발 여러 개가 바뀌는 동작은 하나씩 차례로 옮기므로 그만큼 길게
    const n = moversOf(from, target).length
    const dur = n > 1 ? ms * (0.4 + 0.6 * n) : ms
    let raf
    const t0 = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / dur)
      st.set(blendPose(from, target, t))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    // 화면이 가려져 애니메이션 프레임이 멈춰도 최종 자세로는 넘어가게 함
    const done = setTimeout(() => {
      cancelAnimationFrame(raf)
      st.set(target)
    }, dur + 80)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(done)
    }
  }, [target, ms])
  return store.current
}

// 저장소의 현재 자세(2D)와 그 3D 좌표를 받아 children(p, p3)를 그림
function LivePose({ store, feetInfo, heightM, grips, anchors, surfaces, children }) {
  const p = useSyncExternalStore(store.subscribe, store.get)
  const p3 = useMemo(() => (p ? pose3d(p, heightM, feetInfo, grips, anchors, surfaces) : null), [p, heightM, feetInfo, grips, anchors, surfaces])
  return p && p3 ? children(p, p3) : null
}

const defaultBody = { height: '165', wingspan: '165', flexibility: '3', wall: '3.5', bolt: '20' }
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
  // Roboflow 클라우드 홀드 검출: { status: 'loading' | 'ok' | 'off', holds }. 실패하거나 키가 없으면 색 검출만 씀
  const [cloud, setCloud] = useState({ status: 'off', holds: [] })
  const [rfKey, setRfKeyState] = useState(getRfKey)
  const [holdsSrc, setHoldsSrc] = useState(null) // 'color' | 'cloud': 지금 루트 홀드를 어떤 검출로 만들었는지
  const [showBoxes, setShowBoxes] = useState(false) // AI가 찾은 홀드 상자를 모두 보여주기(확인용)
  const [target, setTarget] = useState(null)
  const [holds, setHolds] = useState([])
  const [frameIdx, setFrameIdx] = useState(0) // 0=출발 자세, 이후 동작별 프레임(점프는 공중+착지 2프레임)
  const [feetFree, setFeetFree] = useState(true) // 발 자유: 다른 색 홀드도 발로 씀
  const [mode, setMode] = useState('edit') // edit | start | finish | type | volume
  const [drag, setDrag] = useState(null) // 볼륨 모드에서 끌어 그리는 중인 범위 {x0,y0,x1,y1}(0~1)
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
  // 벽 너비 자동 추정(볼트 구멍 격자): 사진을 열면 격자 간격(px)을 재고, 「볼트 구멍 간격」(cm)으로 벽 너비를 계산해 채움
  const [scaleEst, setScaleEst] = useState(null) // { spacingPx, imgW, ok } | null
  const boltM = pos(raw.bolt, 20) / 100
  const autoWall = scaleEst?.ok ? (scaleEst.imgW / scaleEst.spacingPx) * boltM : null

  const loadCanvasOrImage = (source, w, h, url) => {
    setPhoto({ url, img: sampleImage(source, w, h), aspect: w / h })
    setWallFaces(null)
    setTarget(null)
    setHolds([])
    setFrameIdx(0)
    setMode('edit')
  }

  // 벽 펴기: 면마다 네 모서리를 맞추면 정면에서 본 평평한 벽 사진으로 바꿈(천장·바닥은 잘려 나감)
  const [straight, setStraight] = useState(null) // { faces: [[{x,y}x4], ...], sel: 고른 면 번호, drag } | null
  const [wallFaces, setWallFaces] = useState(null) // 3D 벽으로 지정한 면들(사진 좌표). 없으면 평평한 벽
  const onStraightPointer = (e) => {
    if (!straight) return
    const r = boxRef.current.getBoundingClientRect()
    const pt = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
    if (e.type === 'pointerdown') {
      // 가장 가까운 모서리를 잡음(화면에서 약 25px 안)
      let best = null
      straight.faces.forEach((f, fi) =>
        f.forEach((q, ci) => {
          const d = Math.hypot((q.x - pt.x) * r.width, (q.y - pt.y) * r.height)
          if (d < 28 && (!best || d < best.d)) best = { d, fi, ci }
        }),
      )
      if (best) {
        e.currentTarget.setPointerCapture?.(e.pointerId)
        setStraight({ ...straight, sel: best.fi, drag: { from: straight.faces[best.fi][best.ci] } })
      } else {
        // 면 안을 누르면 그 면을 고름(면 추가는 고른 면 옆으로)
        const fi = straight.faces.findIndex((f) => {
          let inn = false
          for (let i = 0, j = 3; i < 4; j = i++) if (f[i].y > pt.y !== f[j].y > pt.y && pt.x < ((f[j].x - f[i].x) * (pt.y - f[i].y)) / (f[j].y - f[i].y) + f[i].x) inn = !inn
          return inn
        })
        if (fi >= 0) setStraight({ ...straight, sel: fi })
      }
    } else if (e.type === 'pointermove' && straight.drag) {
      // 이웃 면과 같은 자리였던 모서리(공유 모서리)는 함께 움직임
      const f0 = straight.drag.from
      const faces = straight.faces.map((f) => f.map((q) => (Math.abs(q.x - f0.x) < 1e-6 && Math.abs(q.y - f0.y) < 1e-6 ? pt : q)))
      setStraight({ ...straight, faces, drag: { from: pt } })
    } else if (e.type === 'pointerup') setStraight({ ...straight, drag: null })
  }
  const apply3D = () => {
    setWallFaces(straight.faces)
    setStraight(null)
    setView3d(true)
  }
  const applyStraight = () => {
    const faces = straight.faces
    setStraight(null)
    const im = new Image()
    im.onload = () => {
      const c = rectifyFaces(im, faces)
      loadCanvasOrImage(c, c.width, c.height, c.toDataURL('image/jpeg', 0.92))
    }
    im.src = photo.url
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
  // AI 홀드 종류 판별(Teachable Machine 모델): 홀드 위치를 키로 결과를 저장해 두고, 새 홀드만 판별
  const [mlTypes, setMlTypes] = useState({})
  const holdKey = (h) => `${h.x.toFixed(4)},${h.y.toFixed(4)}`
  useEffect(() => {
    if (!photo || !holds.length) return
    const todo = holds.filter((h) => !h.footOnly && !(holdKey(h) in mlTypes))
    if (!todo.length) return
    let cancelled = false
    const im = new Image()
    im.onload = async () => {
      const { classifyHolds } = await import('./utils/holdModel.js') // 모델(TensorFlow.js)은 필요할 때만 불러옴
      const res = await classifyHolds(im, todo)
      if (cancelled || !res.length) return
      setMlTypes((prev) => {
        const next = { ...prev }
        todo.forEach((h, i) => (next[holdKey(h)] = res[i]))
        return next
      })
    }
    im.src = photo.url
    return () => {
      cancelled = true
    }
  }, [photo, holds, mlTypes])
  useEffect(() => setMlTypes({}), [photo])
  const ML_MIN = 0.5 // AI 확신도가 이보다 낮으면 크기·모양 추정을 씀
  const typedHolds = useMemo(
    () =>
      holds.map((h) => {
        if (h.type) return h // 직접 고친 종류가 우선
        if (h.volume) return { ...h, type: 'volume' }
        const ml = mlTypes[holdKey(h)]
        // 볼륨은 모양(다각형 윤곽)으로만 판정. AI 확률에서 볼륨을 빼고 나머지를 다시 합 1로 맞춰 분포 전체를 넘김
        // (예전: 볼륨이면 2등 하나만 → 큰 저그가 크림프·슬로퍼로 바뀌던 원인)
        if (ml?.probs) {
          const rest = Object.entries(ml.probs).filter(([l]) => l !== 'volume')
          const sum = rest.reduce((a, [, v]) => a + v, 0) || 1
          const probs = Object.fromEntries(rest.map(([l, v]) => [l, v / sum]))
          const [label, prob] = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]
          if (prob >= ML_MIN) return { ...h, type: label, probs, ml: { label, prob, probs } }
        }
        return { ...h, type: estimateHoldType(h, normalSize) }
      }),
    [holds, normalSize, mlTypes],
  )
  // 경로 탐색에 쓰는 자리: 볼륨은 가장자리(위/왼쪽/오른쪽/아래)와 중앙을 손·발 자리로 펼침
  const usable = useMemo(() => {
    const out = []
    typedHolds.forEach((h, i) => {
      const ext = volumeExtent(h)
      if (h.type === 'volume' && ext) {
        for (const pt of [ext.top, ext.left, ext.right, ext.bottom, { x: h.x, y: h.y }]) {
          // 볼륨은 발로 딛는 자리(손으로 잡기는 거의 불가능). 시작·끝으로 직접 지정한 볼륨만 손으로도 씀
          out.push({ x: pt.x, y: pt.y, size: normalSize, type: 'volume', parent: i, role: h.role, footOnly: !h.role })
        }
      } else out.push({ ...h, parent: i })
    })
    return out
  }, [typedHolds, normalSize])

  // 루트 홀드: 클라우드 검출이 있으면 그 상자 중 루트 색인 것, 없으면 색 검출. 여기에 색과 상관없는 볼륨을 더함
  // (실내 암장의 볼륨은 보통 모든 루트에서 쓸 수 있음)
  const routeHolds = (t, cl) => {
    const useCloud = cl.status === 'ok' && cl.holds.length > 0
    const found = useCloud ? filterByTarget(photo.img, cl.holds, t) : detectHolds(photo.img, t)
    setHoldsSrc(useCloud ? 'cloud' : 'color')
    // 클라우드 검출이 있으면 그 상자 안에 중심이 있는 볼륨만 인정(사람·천장·벽 구조물을 볼륨으로 잘못 잡지 않게)
    const inCloudBox = (v) => cl.holds.some((c) => v.x >= c.box.x0 && v.x <= c.box.x1 && v.y >= c.box.y0 && v.y <= c.box.y1)
    const vols = detectVolumes(photo.img).filter((v) => !found.some((f) => Math.hypot((f.x - v.x) * photo.aspect, f.y - v.y) < 0.04) && (!useCloud || inCloudBox(v)))
    return [...found.filter((f) => !vols.some((v) => isVolumeItself(f, v))), ...vols]
  }
  // 사진을 열면 볼트 구멍 격자로 벽 너비를 추정
  useEffect(() => {
    if (!photo) return setScaleEst(null)
    let cancelled = false
    const im = new Image()
    im.onload = () => {
      if (cancelled) return
      const r = estimateScaleFromImage(im)
      setScaleEst(r ? { spacingPx: r.spacingPx, imgW: r.imgW, ok: isReliable(r) } : { ok: false })
    }
    im.src = photo.url
    return () => {
      cancelled = true
    }
  }, [photo])
  // 믿을 만한 추정이 나오면(또는 볼트 간격을 바꾸면) 벽 너비 칸을 자동으로 채움
  useEffect(() => {
    if (autoWall) setR('wall', autoWall.toFixed(1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoWall])
  // 사진을 열면 클라우드 검출을 시작(기다리는 동안에도 색 검출로 바로 쓸 수 있음)
  useEffect(() => {
    if (!photo) return
    if (!import.meta.env.DEV && !rfKey) return setCloud({ status: 'off', holds: [] })
    let cancelled = false
    setCloud({ status: 'loading', holds: [] })
    const im = new Image()
    im.onload = async () => {
      const r = await detectHoldsCloud(im)
      if (!cancelled) setCloud(r.holds ? { status: 'ok', holds: r.holds } : { status: 'fail', holds: [], error: r.error })
    }
    im.src = photo.url
    return () => {
      cancelled = true
    }
  }, [photo, rfKey])
  // 색을 먼저 고른 뒤 클라우드 결과가 도착하면, 아직 색 검출 결과를 쓰고 있을 때 한 번 바꿈(직접 고친 홀드가 없을 때만)
  useEffect(() => {
    if (cloud.status === 'ok' && target && holdsSrc === 'color' && !holds.some((h) => h.type || h.role)) setHolds(routeHolds(target, cloud))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud])

  // 볼륨 직접 지정: 벽 위를 끌어 범위를 그리면 그 범위가 볼륨(발 자리)이 됨. 짧게 누르면 그 자리의 직접 그린 볼륨을 지움
  const normPt = (e) => {
    const r = boxRef.current.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const onVolPointer = (e) => {
    if (mode !== 'volume' || !photo || !target) return
    const p = normPt(e)
    if (e.type === 'pointerdown') {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
    } else if (e.type === 'pointermove' && drag) setDrag({ ...drag, x1: p.x, y1: p.y })
    else if (e.type === 'pointerup' && drag) {
      const b = { x0: Math.min(drag.x0, p.x), y0: Math.min(drag.y0, p.y), x1: Math.max(drag.x0, p.x), y1: Math.max(drag.y0, p.y) }
      setDrag(null)
      setFrameIdx(0)
      // 거의 안 끌었으면: 누른 자리를 덮는 직접 그린 볼륨을 지움
      if ((b.x1 - b.x0) * photo.aspect < 0.02 && b.y1 - b.y0 < 0.02) {
        const hit = holds.findIndex((h) => h.manualVolume && p.x >= h.box.x0 && p.x <= h.box.x1 && p.y >= h.box.y0 && p.y <= h.box.y1)
        if (hit >= 0) setHolds(holds.filter((_, i) => i !== hit))
        return
      }
      const vol = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, size: (b.x1 - b.x0) * (b.y1 - b.y0) * 0.785, box: b, type: 'volume', manualVolume: true }
      // 이 볼륨을 일반 홀드로 잡아 둔 것(볼륨 범위 안에 중심이 있고 볼륨 넓이의 35% 이상인 큰 덩어리)은 같은 물체라 지움
      setHolds([...holds.filter((h) => !isVolumeItself(h, vol)), vol])
    }
  }

  const onTap = (e) => {
    if (!photo) return
    const r = boxRef.current.getBoundingClientRect()
    const nx = (e.clientX - r.left) / r.width
    const ny = (e.clientY - r.top) / r.height
    if (!target) {
      const t = pickTarget(photo.img, nx, ny)
      setTarget(t)
      setHolds(routeHolds(t, cloud))
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
    if (mode === 'volume') return // 볼륨 모드는 끌어서 그리기(onVolPointer)로 처리
    if (mode === 'edit') {
      // 가까운 홀드는 제거, 빈 곳은 홀드 추가
      if (nearest.d < 0.035) setHolds(holds.filter((_, i) => i !== nearest.i))
      else setHolds([...holds, { x: nx, y: ny, size: normalSize }]) // 종류는 AI·크기 규칙으로 정함(예전 기본값 저그 제거)
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
  const allHolds = useMemo(() => (photo ? (cloud.status === 'ok' && cloud.holds.length ? cloud.holds : detectAllHolds(photo.img)) : []), [photo, cloud])
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
  // 경로에 쓰지 않는 다른 색 홀드(미터 단위 위치와 반지름): 벽 밀기 발이 그 위에 놓이지 않게 자세 계산에 넘김
  const obstacles = useMemo(() => {
    if (!photo) return []
    const wallH = wallWidth / photo.aspect
    return allHolds
      .filter((a) => !usable.some((u) => Math.hypot((u.x - a.x) * photo.aspect, u.y - a.y) < 0.03))
      .map((a) => ({ mx: a.x * wallWidth, my: (1 - a.y) * wallH, r: Math.sqrt((a.size * wallWidth * wallH) / Math.PI) }))
  }, [photo, allHolds, usable, wallWidth])
  // 3D 벽 모델(꺾인 면들): 면을 지정했을 때만
  const wall3d = useMemo(() => (photo && wallFaces ? buildWall3D(wallFaces, photo.aspect, wallWidth) : null), [photo, wallFaces, wallWidth])
  // 3D 보기에서 벽 위에 튀어나오게 그릴 홀드: 루트 홀드 + 그 밖에 검출된 모든 홀드. 색은 사진에서, 크기는 검출 상자·넓이로
  const holds3d = useMemo(() => {
    if (!photo) return []
    const wallH = wallWidth / photo.aspect
    const { w, h, data } = photo.img
    const colorAt = (x, y) => {
      const px = Math.min(w - 1, Math.max(0, Math.round(x * w)))
      const py = Math.min(h - 1, Math.max(0, Math.round(y * h)))
      const i = (py * w + px) * 4
      return `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`
    }
    const out = []
    const vols = typedHolds.filter((h) => h.type === 'volume')
    for (const hd of [...typedHolds, ...allHolds]) {
      if (vols.some((v) => isVolumeItself(hd, v))) continue // 볼륨을 홀드로도 잡은 것: 볼륨으로만 그림
      // 같은 홀드를 두 번 그리지 않음: 이미 넣은 (볼륨이 아닌) 홀드의 상자 안에 중심이 있으면 건너뜀
      const isVol = hd.type === 'volume'
      if (out.some((o) => !o.volume && !isVol && (o.box ? hd.x >= o.box.x0 && hd.x <= o.box.x1 && hd.y >= o.box.y0 && hd.y <= o.box.y1 : Math.hypot((o.x - hd.x) * photo.aspect, o.y - hd.y) < 0.02))) continue
      const b = hd.box
      const rw = b ? ((b.x1 - b.x0) / 2) * wallWidth : Math.sqrt((hd.size * wallWidth * wallH) / Math.PI)
      const rh = b ? ((b.y1 - b.y0) / 2) * wallH : rw
      const type = hd.type ?? 'jug'
      // 사진에서 뽑은 실제 윤곽(미터). 못 뽑으면 3D에서 타원으로 그림
      const ol = b ? holdOutline(photo.img, b) : null
      out.push({
        x: hd.x,
        y: hd.y,
        mx: hd.x * wallWidth,
        my: (1 - hd.y) * wallH,
        rx: rw,
        ry: rh,
        type,
        ...holdProfile(type, rw, rh),
        outline: ol?.map(([ox, oy]) => [ox * wallWidth, (1 - oy) * wallH]),
        color: colorAt(hd.x, hd.y),
        volume: isVol,
        box: b,
        base: 0,
      })
    }
    // 볼륨: 실제 윤곽(없으면 상자)을 바닥으로 한 다각뿔. 그 위에 붙은 홀드는 볼륨 표면 높이(base)만큼 띄움
    for (const v of out) {
      if (!v.volume) continue
      const outline = v.outline ?? [[v.mx - v.rx, v.my - v.ry], [v.mx + v.rx, v.my - v.ry], [v.mx + v.rx, v.my + v.ry], [v.mx - v.rx, v.my + v.ry]]
      Object.assign(v, volumeBase(outline), { height: volumeHeight(v.rx, v.ry) })
    }
    for (const hd of out) {
      if (hd.volume) continue
      for (const v of out)
        if (v.volume && insidePoly(hd.mx, hd.my, v.base)) {
          const z = volumeSurfaceZ(v, hd.mx, hd.my)
          // 볼륨 위 홀드: 표면 높이만큼 띄우고, 그 면의 기울기(법선)에 맞춰 기울임
          if (z >= hd.base) (hd.base = z), (hd.normal = volumeNormal(v, hd.mx, hd.my))
        }
    }
    return out
  }, [photo, typedHolds, allHolds, wallWidth])
  const frames = useMemo(() => (plan?.route ? buildSequence(plan.route, plan.m, model, height / 100, { obstacles }) : []), [plan, model, height, obstacles])
  // 강화학습 보상 명세로 채점한 프레임별 점수(자세 고를 때 쓴 것과 같은 채점기)
  const scores = useMemo(() => (frames.length && plan ? scoreFrames(frames, plan.m, height / 100) : null), [frames, plan, height])
  const fi = Math.min(frameIdx, Math.max(0, frames.length - 1))
  const frame = frames[fi] ?? { k: 'start' }
  const idx = frame.k === 'start' ? -1 : frame.i // 현재 보고 있는 동작 번호(0부터)
  const step = idx >= 0 ? plan?.route?.steps[idx] : null
  const hardCount = plan?.route?.steps.filter((s) => s.hard).length ?? 0
  const grade = plan?.route ? estimateGrade(plan.route, plan.m, model) : null
  const stepMl = step ? typedHolds[plan.m[step.to]?.parent]?.ml : null
  const dynoCount = plan?.route?.steps.filter((s) => s.dyno).length ?? 0
  const fig = frame.fig ?? null
  // 두 손이 잡은 홀드의 종류와 입체 크기(손을 홀드 표면의 잡는 자리에 놓는 데 씀)
  const prevFig = fi > 0 ? frames[fi - 1]?.fig : null
  // 손발이 잡고 있는 자리: 이전·지금 자세의 관절 좌표(3D에서 공중에 뜬 손발과 홀드를 잡은 손발을 구분)
  const poseAnchors = useMemo(() => [fig?.p, prevFig?.p].filter(Boolean), [fig, prevFig])
  const handGrips = useMemo(() => {
    if (!fig || !plan?.m) return null
    const at = (pt, fg = fig) => {
      let best = null
      for (const id of fg.hands) {
        const h = plan.m[id]
        const d = Math.hypot(h.mx - pt.x, h.my - pt.y)
        if (!best || d < best.d) best = { d, h }
      }
      if (!best) return null
      const h3 = holds3d.reduce((a, o) => (!a || Math.hypot(o.mx - best.h.mx, o.my - best.h.my) < Math.hypot(a.mx - best.h.mx, a.my - best.h.my) ? o : a), null)
      const near = h3 && Math.hypot(h3.mx - best.h.mx, h3.my - best.h.my) < 0.1
      const type = best.h.type ?? 'jug'
      const rx = near ? h3.rx : 0.05
      const ry = near ? h3.ry : 0.05
      return { type, hold: { mx: best.h.mx, my: best.h.my, rx, ry, depth: holdProfile(type, rx, ry).depth, base: near ? h3.base : 0 } }
    }
    // 이전 자세와 지금 자세에서 잡은 홀드 모두(애니메이션 중 손마다 가까운 것을 씀)
    const list = [at(fig.p.hl), at(fig.p.hr)]
    if (prevFig) list.push(at(prevFig.p.hl, prevFig), at(prevFig.p.hr, prevFig))
    return list.filter(Boolean)
  }, [fig, prevFig, plan, holds3d])
  const isFoot = frame.k === 'foot'
  // 발 홀드 순서: 전체 경로를 따라가며 발이 처음 딛는 홀드에 발1, 발2 … 번호를 붙임
  const footOrder = useMemo(() => {
    if (!plan?.route) return []
    const order = []
    for (const f of frames) for (const id of f.fig.feetOnHolds) if (!order.includes(id)) order.push(id)
    return order
  }, [plan, frames])
  const poseStore = usePoseTween(fig?.p ?? null)
  const [view3d, setView3d] = useState(false)
  // 손이 잡은 홀드의 종류(왼손/오른손): 그림의 손 위치에서 가장 가까운 잡은 홀드
  const handTypes = useMemo(() => {
    if (!fig || !plan?.m) return {}
    const typeAt = (pt) => {
      let best = null
      for (const id of fig.hands) {
        const h = plan.m[id]
        const d = Math.hypot(h.mx - pt.x, h.my - pt.y)
        if (!best || d < best.d) best = { d, t: h.type }
      }
      return best?.t
    }
    return { L: typeAt(fig.p.hl), R: typeAt(fig.p.hr) }
  }, [fig, plan])
  const smearSides = useMemo(() => Object.fromEntries((fig?.feetInfo ?? []).map((f) => [f.side, f.id === null])), [fig])
  const [playing, setPlaying] = useState(false)
  // 재생: 처음부터 마지막 동작까지 자동으로 한 동작씩 넘김
  useEffect(() => {
    if (!playing) return
    if (fi >= frames.length - 1) {
      setPlaying(false)
      return
    }
    const id = setTimeout(() => setFrameIdx(fi + 1), frame.k === 'jump' ? 650 : frame.k === 'foot' ? 950 : frame.together ? 2000 : 1200)
    return () => clearTimeout(id)
  }, [playing, fi, frames.length, frame.k, frame.together])
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
            {photo && scaleEst && (
              <div className="scale-src" title="사진 속 벽 너비(볼트 구멍 격자로 자동 계산, 「내 몸」 탭에서 고칠 수 있어요)">
                📏 {autoWall && Math.abs(wallWidth - autoWall) < 0.06 ? `벽 너비 ${wallWidth.toFixed(1)}m 자동` : `벽 너비 ${wallWidth.toFixed(1)}m (직접 입력)`}
              </div>
            )}
            {photo && (
              <div className={cloud.status === 'ok' ? 'detect-src click' : 'detect-src'} title={cloud.status === 'ok' ? '눌러서 AI가 찾은 상자 보기/숨기기' : '홀드 위치를 찾은 방법'} onClick={() => cloud.status === 'ok' && setShowBoxes(!showBoxes)}>
                {cloud.status === 'loading' ? '☁️ AI 검출 중…' : holdsSrc === 'cloud' || (!target && cloud.status === 'ok') ? `☁️ AI 검출 ${cloud.holds.length}개 ${showBoxes ? '▣' : '□'}` : cloud.status === 'fail' ? `🎨 색 검출 (AI 실패: ${cloud.error})` : '🎨 색 검출'}
              </div>
            )}
            {photo && !view3d && !straight && (
              <button className="straight-btn" onClick={() => setStraight({ faces: wallFaces ?? [defaultFace()], sel: 0, drag: null })} title="벽 면을 지정해 3D로 만들거나 평평하게 펴요">📐 벽 면 지정</button>
            )}
            {photo && (fig || wall3d) && (
              <button className="view-toggle" onClick={() => setView3d(!view3d)}>{view3d ? '🖼 사진' : '🧊 3D'}</button>
            )}
            {!photo ? (
              <div className="empty">
                <div className="big">벽을 보여주세요</div>
                <p>사진을 찍으면 내 몸에 맞는<br />경로와 자세를 알려줘요</p>
                <button className="btn primary wide" onClick={() => fileRef.current.click()}>📷 사진 찍기 / 선택</button>
                <button className="btn wide" onClick={useDemo}>데모 벽으로 체험</button>
              </div>
            ) : view3d && (fig || wall3d) ? (
              <div className="wall wall3d" style={{ width: fit.w, height: fit.h }}>
                <Suspense fallback={<div className="banner">3D 불러오는 중…</div>}>
{fig ? (
                                    <LivePose store={poseStore} feetInfo={fig.feetInfo} heightM={height / 100} grips={handGrips} anchors={poseAnchors} surfaces={holds3d}>
                    {(_, p3) => <View3D photoUrl={photo.url} wallW={wallWidth} wallH={wallWidth / photo.aspect} holds={holds3d} wall3d={wall3d} p3={p3} handTypes={handTypes} smear={smearSides} heightM={height / 100} hard={step?.hard} />}
                  </LivePose>
                  ) : (
                    <View3D photoUrl={photo.url} wallW={wallWidth} wallH={wallWidth / photo.aspect} holds={holds3d} wall3d={wall3d} p3={null} handTypes={handTypes} smear={smearSides} heightM={height / 100} hard={step?.hard} />
                  )}
                </Suspense>
                <div className="hint3d">드래그로 돌리기 · 휠로 확대 · 하늘색 발 = 홀드, 주황 발 = 벽 밀기</div>
              </div>
            ) : (
              <div className={mode === 'volume' || straight ? 'wall drawing' : 'wall'} ref={boxRef} onClick={straight ? undefined : onTap} onPointerDown={straight ? onStraightPointer : onVolPointer} onPointerMove={straight ? onStraightPointer : onVolPointer} onPointerUp={straight ? onStraightPointer : onVolPointer} style={{ width: fit.w, height: fit.h }}>
                <img src={photo.url} alt="벽" draggable="false" />
                {straight && (
                  <svg className="straight" viewBox={`0 0 ${photo.aspect} 1`} preserveAspectRatio="none">
                    {straight.faces.map((f, fi) => (
                      <g key={fi}>
                        <polygon points={f.map((q) => `${q.x * photo.aspect},${q.y}`).join(' ')} fill={fi === straight.sel ? 'rgba(255,212,0,0.18)' : 'rgba(77,208,255,0.15)'} stroke={fi === straight.sel ? '#ffd400' : '#4dd0ff'} strokeWidth={3 * u} />
                        <text x={((f[0].x + f[2].x) / 2) * photo.aspect} y={(f[0].y + f[2].y) / 2} textAnchor="middle" fontSize={18 * u} fontWeight="800" fill="#fff" stroke="#000" strokeWidth={3 * u} paintOrder="stroke">면 {fi + 1}</text>
                        {f.map((q, ci) => <circle key={ci} cx={q.x * photo.aspect} cy={q.y} r={10 * u} fill="#ffd400" stroke="#000" strokeWidth={2 * u} />)}
                      </g>
                    ))}
                  </svg>
                )}
                {straight && (
                  <div className="straight-bar">
                    <span>노란 점을 끌어 면의 네 모서리에 맞추세요 · 면을 눌러 고르고 그 옆에 면을 더해요</span>
                    {['up', 'left', 'right', 'down'].map((d) => (
                      <button key={d} onClick={() => {
                        const faces = [...straight.faces, adjacentFace(straight.faces[straight.sel ?? 0], d)]
                        setStraight({ faces, sel: faces.length - 1, drag: null })
                      }}>
                        {{ up: '↑ 위', left: '← 왼쪽', right: '오른쪽 →', down: '↓ 아래' }[d]} 면
                      </button>
                    ))}
                    {straight.faces.length > 1 && <button onClick={() => setStraight({ faces: straight.faces.filter((_, i) => i !== (straight.sel ?? straight.faces.length - 1)), sel: 0, drag: null })}>고른 면 지우기</button>}
                    <button onClick={() => setStraight(null)}>취소</button>
                    <button onClick={applyStraight} title="면들을 평평하게 펴서 사진을 바꿔요">평평하게 펴기</button>
                    <button className="primary" onClick={apply3D} title="사진은 그대로, 3D 보기에서 꺾인 벽으로 그려요">3D 벽 만들기</button>
                  </div>
                )}
                <svg style={straight ? { display: 'none' } : undefined} viewBox={`0 0 ${photo.aspect} 1`} preserveAspectRatio="none">
                  {drag && (
                    <rect x={Math.min(drag.x0, drag.x1) * photo.aspect} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0) * photo.aspect} height={Math.abs(drag.y1 - drag.y0)} fill="rgba(176,224,255,0.25)" stroke="#b0e0ff" strokeWidth={2.5 * u} />
                  )}
                  {showBoxes && cloud.status === 'ok' && cloud.holds.map((c, i) => (
                    <rect key={'cb' + i} x={c.box.x0 * photo.aspect} y={c.box.y0} width={(c.box.x1 - c.box.x0) * photo.aspect} height={c.box.y1 - c.box.y0} fill="none" stroke="#ff4dff" strokeWidth={1.5 * u} strokeDasharray={`${4 * u} ${3 * u}`} opacity={0.5 + 0.5 * (c.conf ?? 1)} />
                  ))}
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
                  {fig && (
                    <LivePose store={poseStore} feetInfo={fig.feetInfo} heightM={height / 100} grips={handGrips} anchors={poseAnchors} surfaces={holds3d}>
                      {(p2, p3) => (
                        <>
                  {fig.feetInfo.map((f) =>
                    f.kind === 'smear' ? (
                      // 스미어: 홀드 없이 벽을 미는 발. 발바닥이 벽에 닿아 있음을 짧은 선으로 표시
                      <line key={'sm' + f.side} x1={Number(sv(p2[f.side === 'L' ? 'footL' : 'footR']).split(',')[0]) - 10 * u} x2={Number(sv(p2[f.side === 'L' ? 'footL' : 'footR']).split(',')[0]) + 10 * u} y1={Number(sv(p2[f.side === 'L' ? 'footL' : 'footR']).split(',')[1]) + 4 * u} y2={Number(sv(p2[f.side === 'L' ? 'footL' : 'footR']).split(',')[1]) + 4 * u} stroke="#4dd0ff" strokeWidth={4 * u} strokeLinecap="round" />
                    ) : null,
                  )}
                  <Stickman p3={p3} handTypes={handTypes} sv={sv} u={u} heightM={height / 100} headR={0.06 * (height / 100) * k} hard={step?.hard} label={fig.airborne ? '점프!' : null} />
                        </>
                      )}
                    </LivePose>
                  )}
                  {typedHolds.map((h, i) =>
                    h.type === 'volume' && h.box ? (
                      // 볼륨: 범위(상자)를 점선으로 표시
                      <rect key={i} x={h.box.x0 * photo.aspect} y={h.box.y0} width={(h.box.x1 - h.box.x0) * photo.aspect} height={h.box.y1 - h.box.y0} rx={6 * u} fill="none" stroke="#b0e0ff" strokeWidth={2.5 * u} strokeDasharray={`${8 * u} ${5 * u}`} />
                    ) : h.type === 'volume' && h.extent ? (
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
                        {HOLD_TYPES[h.type]?.name}{h.ml ? ` AI ${Math.round(h.ml.prob * 100)}%` : ''}
                      </text>
                    )
                  })}
                </svg>
                {!target && <div className="banner">👆 따라갈 루트의 홀드 색을 눌러주세요</div>}
                {target && mode === 'volume' && <div className="banner">🔷 볼륨을 손가락으로 대각선으로 끌어 감싸세요 · 그린 볼륨을 짧게 누르면 지워요</div>}
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
              <button className={mode === 'volume' ? 'on' : ''} onClick={() => setMode('volume')} title="벽 위를 끌어 볼륨 범위를 그려요. 짧게 누르면 지워요">🔷 볼륨</button>
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
                  {fig && (
                    <LivePose store={poseStore} feetInfo={fig.feetInfo} heightM={height / 100} grips={handGrips} anchors={poseAnchors} surfaces={holds3d}>
                      {(_, p3) => <SideView p3={p3} feetInfo={fig.feetInfo} heightM={height / 100} />}
                    </LivePose>
                  )}
                  <div className="pills">
                    {moveKey && MOVES[moveKey] && (
                      <button className="pill move" onClick={() => openTerm('move', moveKey)}>동작 · {MOVES[moveKey].name}</button>
                    )}
                    {!isFoot && step?.holdType && HOLD_TYPES[step.holdType] && (
                      <button className="pill hold" onClick={() => openTerm('hold', step.holdType)}>홀드 · {HOLD_TYPES[step.holdType].name}{stepMl ? ` · AI ${Math.round(stepMl.prob * 100)}%` : ''}
                        {stepMl?.probs && (() => {
                          // 2등이 15% 이상이면 함께 보여줌(애매한 홀드를 한 종류로 단정하지 않음)
                          const [, second] = Object.entries(stepMl.probs).sort((a, b) => b[1] - a[1])
                          return second && second[1] >= 0.15 ? ` / ${HOLD_TYPES[second[0]]?.name ?? second[0]} ${Math.round(second[1] * 100)}%` : ''
                        })()}</button>
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
                  {scores?.frames[fi] && (() => {
                    const sc = scores.frames[fi]
                    const avg = scores.total / scores.frames.length
                    const items = Object.entries(sc.terms).filter(([, v]) => Math.abs(v) >= 0.05)
                    const good = items.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 2)
                    const bad = items.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]).slice(0, 1)
                    return (
                      <div className="reward" title="강화학습 보상 함수(rl/)로 매긴 점수. 자세 후보 중 이 점수가 가장 높은 것을 골랐어요">
                        <span className={sc.total >= avg ? 'rscore up' : 'rscore'}>AI 점수 {sc.total.toFixed(1)}</span>
                        <small>평균 {avg.toFixed(1)}</small>
                        {good.map(([k, v]) => <span key={k} className="rterm plus">+{v.toFixed(1)} {TERM_NAMES[k] ?? k}</span>)}
                        {bad.map(([k, v]) => <span key={k} className="rterm minus">{v.toFixed(1)} {TERM_NAMES[k] ?? k}</span>)}
                      </div>
                    )
                  })()}
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
              <NumField
                label="사진 속 벽 너비"
                unit="m"
                value={raw.wall}
                onChange={(v) => setR('wall', v)}
                hint={!photo ? '사진을 열면 볼트 구멍으로 자동 계산해요' : autoWall ? `자동 계산 ${autoWall.toFixed(1)}m (볼트 구멍 격자, 직접 고쳐도 돼요)` : scaleEst ? '볼트 구멍 격자를 못 찾았어요. 직접 넣어 주세요' : '계산 중…'}
              />
              <NumField label="볼트 구멍 간격" unit="cm" value={raw.bolt} onChange={(v) => setR('bolt', v)} hint="벽에 뚫린 홀드 볼트 구멍 사이 거리. 암장마다 달라요(보통 약 20cm)" />
              <label className="field">
                <span>Roboflow API 키</span>
                <div className="inp">
                  <input type="password" autoComplete="off" placeholder="없으면 색으로 홀드를 찾아요" value={rfKey} onChange={(e) => { setRfKey(e.target.value.trim()); setRfKeyState(e.target.value.trim()) }} />
                </div>
                <small>홀드 위치를 AI로 찾을 때 써요. 이 기기에만 저장되고 사진은 Roboflow로 보내져요</small>
              </label>
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
