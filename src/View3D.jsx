// 대각선에서 보는 3D 보기: 벽 사진을 붙인 벽면 앞에 졸라맨(관절은 depth.js의 3D 좌표)과 홀드 종류별 손을 그린다.
// 드래그로 돌리고, 휠로 확대. three.js는 이 화면을 열 때만 불러온다(App에서 lazy import).
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { handPose } from './utils/hand.js'

const BONES = [
  ['shL', 'shR'], ['shL', 'hipL'], ['shR', 'hipR'], ['hipL', 'hipR'],
  ['shL', 'elL'], ['elL', 'hl'], ['shR', 'elR'], ['elR', 'hr'],
  ['hipL', 'kneeL'], ['kneeL', 'footL'], ['hipR', 'kneeR'], ['kneeR', 'footR'],
]
const UP = new THREE.Vector3(0, 1, 0)

// a→b 원기둥(뼈)
function bone(a, b, r, mat) {
  const A = new THREE.Vector3(a.x, a.y, a.z)
  const B = new THREE.Vector3(b.x, b.y, b.z)
  const d = B.clone().sub(A)
  const len = d.length() || 1e-4
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat)
  m.position.copy(A).add(d.multiplyScalar(0.5))
  m.quaternion.setFromUnitVectors(UP, B.clone().sub(A).normalize())
  return m
}
function ball(p, r, mat) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat)
  m.position.set(p.x, p.y, p.z)
  return m
}

export default function View3D({ photoUrl, wallW, wallH, p3, handTypes, smear, heightM, hard }) {
  const hostRef = useRef(null)
  const ref = useRef(null) // { renderer, scene, camera, controls, body }

  // 한 번만: 장면, 벽, 바닥, 조명, 카메라
  useEffect(() => {
    const host = hostRef.current
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    host.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#14171f')
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 50)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    scene.add(new THREE.AmbientLight(0xffffff, 0.75))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(-2, 4, 3)
    scene.add(sun)
    // 벽: 사진을 벽면(z=0)에 그대로 붙임(가로 wallW m, 세로 wallH m, 왼쪽 아래가 원점)
    const tex = new THREE.TextureLoader().load(photoUrl)
    tex.colorSpace = THREE.SRGBColorSpace
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(wallW, wallH), new THREE.MeshBasicMaterial({ map: tex }))
    wall.position.set(wallW / 2, wallH / 2, 0)
    scene.add(wall)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(wallW + 2, 3), new THREE.MeshLambertMaterial({ color: '#3a4152' }))
    floor.rotation.x = -Math.PI / 2
    floor.position.set(wallW / 2, 0, 1.5)
    scene.add(floor)
    const body = new THREE.Group()
    scene.add(body)
    ref.current = { renderer, scene, camera, controls, body, placed: false }

    const resize = () => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    let raf
    const loop = () => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      tex.dispose()
      host.removeChild(renderer.domElement)
    }
  }, [photoUrl, wallW, wallH])

  // 자세가 바뀔 때마다 몸을 다시 만듦
  useEffect(() => {
    const st = ref.current
    if (!st || !p3) return
    const { body, camera, controls } = st
    for (const c of [...body.children]) {
      body.remove(c)
      c.geometry?.dispose()
      c.material?.dispose()
    }
    const skin = new THREE.MeshStandardMaterial({ color: hard ? '#ff8a6b' : '#f4f4f4', roughness: 0.6 })
    const handMat = new THREE.MeshStandardMaterial({ color: '#ffd9b3', roughness: 0.7 })
    const r = 0.022 * heightM
    for (const [a, b] of BONES) body.add(bone(p3[a], p3[b], a.startsWith('hip') && b.startsWith('hip') ? r * 1.4 : r, skin))
    body.add(bone({ x: (p3.shL.x + p3.shR.x) / 2, y: (p3.shL.y + p3.shR.y) / 2, z: p3.shL.z }, { x: (p3.hipL.x + p3.hipR.x) / 2, y: (p3.hipL.y + p3.hipR.y) / 2, z: p3.hipL.z }, r * 2.2, skin))
    for (const k of ['shL', 'shR', 'elL', 'elR', 'hipL', 'hipR', 'kneeL', 'kneeR']) body.add(ball(p3[k], r * 1.1, skin))
    body.add(ball(p3.head, 0.06 * heightM, skin))
    // 손: 홀드 종류별 잡는 모양
    for (const [side, hk, ek] of [['L', 'hl', 'elL'], ['R', 'hr', 'elR']]) {
      const h = handPose(handTypes?.[side], p3[hk], p3[ek], side, heightM)
      const fr = 0.007 * heightM
      const pal = h.palm
      body.add(bone({ x: (pal[0].x + pal[1].x) / 2, y: (pal[0].y + pal[1].y) / 2, z: (pal[0].z + pal[1].z) / 2 }, { x: (pal[2].x + pal[3].x) / 2, y: (pal[2].y + pal[3].y) / 2, z: (pal[2].z + pal[3].z) / 2 }, 0.03 * heightM, handMat))
      for (const ch of [...h.fingers, h.thumb]) for (let i = 1; i < ch.length; i++) body.add(bone(ch[i - 1], ch[i], fr, handMat))
    }
    // 발: 홀드를 딛은 발은 하늘색, 벽을 미는 발은 주황 원판
    for (const [side, fk] of [['L', 'footL'], ['R', 'footR']]) {
      const m = ball(p3[fk], 0.035 * heightM, new THREE.MeshStandardMaterial({ color: smear?.[side] ? '#ff9a3c' : '#4dd0ff' }))
      m.scale.set(1, 0.6, 1.6)
      body.add(m)
    }
    // 처음 한 번: 몸을 대각선 앞(왼쪽 아래)에서 보도록 카메라 배치. 이후로는 바라보는 점만 몸을 따라감
    const hip = new THREE.Vector3(p3.hip.x, p3.hip.y + 0.2, 0.15)
    if (!st.placed) {
      camera.position.copy(hip).add(new THREE.Vector3(-2.4, 0.9, 2.9)) // 왼쪽 앞 위에서 약 40° 비스듬히
      controls.target.copy(hip)
      st.placed = true
    } else {
      const d = hip.clone().sub(controls.target)
      controls.target.add(d)
      camera.position.add(d)
    }
  }, [p3, handTypes, smear, heightM, hard])

  return <div ref={hostRef} className="view3d" />
}
