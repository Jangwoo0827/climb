// 홀드 종류별 손 모양(3D 점). 사진 위 그림(투영)과 3D 보기에서 같이 쓴다.
// 손 좌표계: f = 아래팔 방향(팔꿈치→손목, 손가락이 뻗는 쪽), n = 손등이 향하는 쪽(기본은 벽 바깥 +z), s = f × n(엄지 쪽 기준)
// 손가락은 마디마다 n의 반대(손바닥 쪽, 홀드 쪽)로 굽힌다.

// curl: [첫째, 둘째, 셋째 마디] 굽힘(도). roll: 아래팔 축으로 손을 돌린 각도(도). thumb: 엄지 모양
// fingers: 쓰는 손가락(검지~새끼 0~3). 안 쓰는 손가락은 주먹처럼 말아 둠
export const GRIPS = {
  jug: { name: '저그', curl: [60, 80, 40], roll: 0, thumb: 'side', fingers: [0, 1, 2, 3], tip: '손가락 전체를 걸어 감싸 쥐어요' },
  crimp: { name: '크림프', curl: [20, 100, -10], roll: 0, thumb: 'lock', fingers: [0, 1, 2, 3], tip: '둘째 마디를 세우고 엄지로 검지를 눌러 잠가요' },
  sloper: { name: '슬로퍼', curl: [15, 10, 5], roll: 0, thumb: 'flat', fingers: [0, 1, 2, 3], tip: '손바닥을 넓게 펴서 마찰로 눌러요' },
  pinch: { name: '핀치', curl: [45, 40, 20], roll: 90, thumb: 'oppose', fingers: [0, 1, 2, 3], tip: '엄지와 네 손가락으로 양옆에서 집어요' },
  pocket: { name: '포켓', curl: [10, 20, 30], roll: 0, thumb: 'tuck', fingers: [1, 2], tip: '구멍에 중지·약지만 넣어요' },
  sidepull: { name: '사이드풀', curl: [55, 75, 35], roll: 90, thumb: 'side', fingers: [0, 1, 2, 3], tip: '손을 세워 옆으로 당겨요' },
  undercling: { name: '언더클링', curl: [55, 75, 35], roll: 180, thumb: 'side', fingers: [0, 1, 2, 3], tip: '손바닥이 위를 보게 아래에서 걸어 올려요' },
  volume: { name: '볼륨', curl: [10, 5, 0], roll: 0, thumb: 'flat', fingers: [0, 1, 2, 3], tip: '손바닥으로 면을 눌러요' },
}

const v = (x, y, z) => ({ x, y, z })
const add = (a, b, s = 1) => v(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s)
const scale = (a, s) => v(a.x * s, a.y * s, a.z * s)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const norm = (a) => scale(a, 1 / (Math.sqrt(dot(a, a)) || 1))
// 축 k(단위)를 중심으로 a를 t(라디안) 회전
const rot = (a, k, t) => add(add(scale(a, Math.cos(t)), cross(k, a), Math.sin(t)), k, dot(k, a) * (1 - Math.cos(t)))
const D = Math.PI / 180

// wrist: 손목(홀드 위치, 3D), elbow: 팔꿈치(3D), side: 'L' | 'R', heightM: 키(손 크기 비례)
// 반환: { palm: [점 4개], fingers: [[점...] x4], thumb: [점...] }
export function handPose(type, wrist, elbow, side, heightM = 1.7) {
  const g = GRIPS[type] ?? GRIPS.jug
  const k = heightM / 1.7
  let f = norm(v(wrist.x - elbow.x, wrist.y - elbow.y, wrist.z - elbow.z))
  let n = v(0, 0, 1)
  n = norm(add(n, f, -dot(n, f))) // 아래팔에 수직이 되게
  if (!isFinite(n.x)) n = v(0, 0, 1)
  // 손 돌리기: 왼손·오른손이 서로 반대 방향으로 돌아 엄지가 몸 쪽/위쪽으로 감
  const sgn = side === 'L' ? 1 : -1
  n = rot(n, f, g.roll * D * sgn)
  const s = scale(cross(f, n), sgn) // 엄지 쪽
  // 손바닥: 손목에서 f로 9cm, 폭 8cm. 홀드를 쥐는 곳이 손가락 뿌리 근처가 되도록 손목을 살짝 뒤로
  const base = add(wrist, f, -0.05 * k)
  const knuckle = add(base, f, 0.09 * k)
  const palm = [add(base, s, 0.035 * k), add(base, s, -0.035 * k), add(knuckle, s, -0.04 * k), add(knuckle, s, 0.04 * k)]
  const lens = [[0.042, 0.026, 0.02], [0.046, 0.029, 0.021], [0.043, 0.027, 0.02], [0.034, 0.02, 0.018]]
  const curlAxis = norm(cross(f, n)) // 이 축으로 -각도 회전하면 손가락이 손바닥 쪽(-n)으로 굽음
  const fingers = lens.map((L, i) => {
    const used = g.fingers.includes(i)
    const curl = used ? g.curl : [85, 100, 60] // 안 쓰는 손가락은 말아 쥠
    let p = add(knuckle, s, (0.03 - i * 0.02) * k)
    let dir = f
    const out = [p]
    L.forEach((l, j) => {
      dir = rot(dir, curlAxis, -curl[j] * D) // 손바닥 쪽(-n)으로 굽힘
      p = add(p, dir, l * k)
      out.push(p)
    })
    return out
  })
  // 엄지
  const tb = add(base, s, 0.035 * k)
  let thumb
  if (g.thumb === 'oppose') {
    // 핀치: 엄지를 손바닥 반대편으로 돌려 네 손가락과 마주 보게
    const a = add(tb, add(f, scale(n, -1)), 0.035 * k)
    thumb = [tb, a, add(a, add(scale(f, 0.6), scale(s, -1)), 0.04 * k)]
  } else if (g.thumb === 'lock') {
    // 크림프: 엄지로 검지 끝을 덮어 누름
    const a = add(tb, add(f, scale(n, -0.5)), 0.035 * k)
    thumb = [tb, a, fingers[0][2]]
  } else if (g.thumb === 'flat') {
    const a = add(tb, add(f, s), 0.03 * k)
    thumb = [tb, a, add(a, add(f, scale(s, 0.4)), 0.035 * k)]
  } else if (g.thumb === 'tuck') {
    const a = add(tb, add(f, scale(n, -1)), 0.03 * k)
    thumb = [tb, a, add(a, scale(s, -1), 0.03 * k)]
  } else {
    const a = add(tb, add(f, scale(s, 0.5)), 0.035 * k)
    thumb = [tb, a, add(a, add(f, scale(n, -0.8)), 0.03 * k)]
  }
  return { palm, fingers, thumb }
}
