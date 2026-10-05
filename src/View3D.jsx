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

export default function View3D({ photoUrl, wallW, wallH, holds, p3, handTypes, smear, heightM, hard }) {
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

  // 홀드: 벽에서 튀어나온 반쪽 타원체(사진 속 색·크기). 볼륨은 벽에서 솟은 사각뿔
  useEffect(() => {
    const st = ref.current
    if (!st || !holds) return
    if (st.holdGroup) {
      st.scene.remove(st.holdGroup)
      st.holdGroup.traverse((o) => {
        o.geometry?.dispose()
        o.material?.dispose()
      })
    }
    const g = new THREE.Group()
    const sph = new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2) // 반구(+y쪽) → x축으로 돌려 +z(벽 밖)로
    const pyr = new THREE.ConeGeometry(1, 1, 4, 1)
    for (const h of holds) {
      const mat = new THREE.MeshStandardMaterial({ color: h.color, roughness: 0.75 })
      if (h.volume) {
        const depth = Math.min(0.6, Math.max(h.rx, h.ry) * 0.7)
        const m = new THREE.Mesh(pyr, mat)
        m.rotation.x = Math.PI / 2 // 뿔 끝이 벽 밖(+z)
        m.rotation.y = Math.PI / 4
        m.scale.set(h.rx * 1.41, depth, h.ry * 1.41)
        m.position.set(h.mx, h.my, depth / 2)
        g.add(m)
      } else {
        const depth = Math.min(0.12, Math.max(0.02, Math.min(h.rx, h.ry) * 0.8))
        const m = new THREE.Mesh(sph, mat)
        m.rotation.x = Math.PI / 2
        m.scale.set(h.rx, depth, h.ry)
        m.position.set(h.mx, h.my, 0)
        g.add(m)
      }
    }
    st.scene.add(g)
    st.holdGroup = g
  }, [holds, photoUrl, wallW, wallH])

  // 자세가 바뀔 때마다: 메시는 처음 한 번만 만들고(애니메이션 중 매 프레임 새로 만들면 렉) 위치·방향·길이만 갱신
  useEffect(() => {
    const st = ref.current
    if (!st || !p3) return
    const { body, camera, controls } = st
    if (!st.parts) {
      const skin = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.6 })
      const handMat = new THREE.MeshStandardMaterial({ color: '#ffd9b3', roughness: 0.7 })
      const cyl = new THREE.CylinderGeometry(1, 1, 1, 10)
      const sph = new THREE.SphereGeometry(1, 14, 10)
      const mk = (geo, mat) => {
        const m = new THREE.Mesh(geo, mat)
        body.add(m)
        return m
      }
      st.parts = {
        skin,
        bones: BONES.map(() => mk(cyl, skin)),
        torso: mk(cyl, skin),
        joints: ['shL', 'shR', 'elL', 'elR', 'hipL', 'hipR', 'kneeL', 'kneeR'].map((k) => [k, mk(sph, skin)]),
        head: mk(sph, skin),
        hands: ['L', 'R'].map(() => ({ palm: mk(cyl, handMat), segs: Array.from({ length: 14 }, () => mk(cyl, handMat)) })),
        feet: ['L', 'R'].map(() => mk(sph, new THREE.MeshStandardMaterial({ color: '#4dd0ff' }))),
      }
    }
    const P = st.parts
    P.skin.color.set(hard ? '#ff8a6b' : '#f4f4f4')
    const A = new THREE.Vector3()
    const B = new THREE.Vector3()
    const setBone = (m, a, b, r) => {
      A.set(a.x, a.y, a.z)
      B.set(b.x, b.y, b.z)
      const len = Math.max(1e-4, A.distanceTo(B))
      m.position.copy(A).add(B).multiplyScalar(0.5)
      m.quaternion.setFromUnitVectors(UP, B.sub(A).normalize())
      m.scale.set(r, len, r)
    }
    const setBall = (m, p, r) => {
      m.position.set(p.x, p.y, p.z)
      m.scale.setScalar(r)
    }
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 })
    const r = 0.022 * heightM
    BONES.forEach(([a, b], i) => setBone(P.bones[i], p3[a], p3[b], a.startsWith('hip') && b.startsWith('hip') ? r * 1.4 : r))
    setBone(P.torso, mid(p3.shL, p3.shR), mid(p3.hipL, p3.hipR), r * 2.2)
    for (const [k, m] of P.joints) setBall(m, p3[k], r * 1.1)
    setBall(P.head, p3.head, 0.06 * heightM)
    // 손: 홀드 종류별 잡는 모양(손바닥 1 + 손가락 4×3 + 엄지 2 마디)
    ;[['L', 'hl', 'elL'], ['R', 'hr', 'elR']].forEach(([side, hk, ek], i) => {
      const h = handPose(handTypes?.[side], p3[hk], p3[ek], side, heightM)
      const pal = h.palm
      setBone(P.hands[i].palm, mid(pal[0], pal[1]), mid(pal[2], pal[3]), 0.03 * heightM)
      let n = 0
      for (const ch of [...h.fingers, h.thumb]) for (let j = 1; j < ch.length; j++) setBone(P.hands[i].segs[n++], ch[j - 1], ch[j], 0.007 * heightM)
    })
    // 발: 홀드를 딛은 발은 하늘색, 벽을 미는 발은 주황 원판
    ;[['L', 'footL'], ['R', 'footR']].forEach(([side, fk], i) => {
      const m = P.feet[i]
      m.position.set(p3[fk].x, p3[fk].y, p3[fk].z)
      m.scale.set(0.035 * heightM, 0.021 * heightM, 0.056 * heightM)
      m.material.color.set(smear?.[side] ? '#ff9a3c' : '#4dd0ff')
    })
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
