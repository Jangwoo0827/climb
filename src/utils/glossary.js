// 클라이밍 용어집: 홀드 종류, 동작, 발 기술. 용어 탭에 보여주고, 경로 추천과 졸라맨 자세를 만들 때도 쓴다.

// 홀드 종류. icon은 48x32 viewBox의 SVG path (evenodd)
export const HOLD_TYPES = {
  jug: {
    name: '점보',
    en: 'Jug',
    look: '크고 깊어서 손 전체로 감싸 쥘 수 있는 손잡이 모양',
    desc: '가장 잡기 쉬운 홀드예요. 손이 통째로 들어가서 쉬어가기 좋아요.',
    grip: '손 전체로 깊게 감싸 쥐고 팔은 곧게 펴서 쉬어요',
    penalty: -0.2,
    icon: 'M6 22 Q6 8 24 8 Q42 8 42 22 Q42 28 34 26 Q24 20 14 26 Q6 28 6 22Z',
  },
  crimp: {
    name: '크림프',
    en: 'Crimp',
    look: '손가락 한두 마디만 걸리는 얇은 모서리',
    desc: '작고 얇은 홀드예요. 손가락 힘이 많이 들고, 무리하면 손가락 관절을 다칠 수 있어요.',
    grip: '손가락 끝 마디로 모서리를 잡고 몸을 벽에 붙여 팔 힘을 아껴요',
    penalty: 0.5,
    icon: 'M4 13 h40 a2 2 0 0 1 2 2 v3 a2 2 0 0 1 -2 2 h-40 a2 2 0 0 1 -2 -2 v-3 a2 2 0 0 1 2 -2z',
  },
  sloper: {
    name: '슬로퍼',
    en: 'Sloper',
    look: '모서리가 없이 둥글고 매끈한 경사면',
    desc: '손가락이 걸리지 않아 마찰로 버텨요. 몸이 벽에서 멀어질수록 미끄러져서 어려워요.',
    grip: '손바닥을 넓게 펴서 붙이고, 엉덩이를 벽 쪽으로 붙여 아래로 당겨요',
    penalty: 0.9,
    icon: 'M4 26 Q24 -2 44 26 Z',
  },
  pinch: {
    name: '핀치',
    en: 'Pinch',
    look: '양옆을 엄지와 나머지 손가락으로 집는 두툼한 블록',
    desc: '엄지와 손가락으로 양쪽에서 눌러 집는 홀드예요. 악력이 필요해요.',
    grip: '엄지를 반대편에 대고 꽉 집되, 팔은 곧게 펴요',
    penalty: 0.4,
    icon: 'M15 4 Q10 16 15 28 H33 Q38 16 33 4 Z',
  },
  pocket: {
    name: '포켓',
    en: 'Pocket',
    look: '손가락 한두 개만 들어가는 구멍',
    desc: '구멍에 손가락을 넣어 잡아요. 손가락 하나에 힘이 몰려 다치기 쉬우니 조심하세요.',
    grip: '들어가는 손가락(중지 등)을 깊게 넣고, 무리해서 당기지 마요',
    penalty: 0.8,
    icon: 'M24 4 a18 13 0 1 0 0.01 0z M24 12 a7 5 0 1 1 -0.01 0z',
  },
  sidepull: {
    name: '사이드풀',
    en: 'Side pull',
    look: '세로로 길쭉해서 옆에서 당겨 잡는 홀드',
    desc: '옆으로 몸을 기대어 반대 방향으로 당겨야 힘이 실려요. 몸을 홀드 옆에 두면 편해요.',
    grip: '엄지가 위로 오게 세로로 잡고, 몸을 홀드 반대 방향으로 기울여 당겨요',
    penalty: 0.3,
    icon: 'M20 2 h8 a2 2 0 0 1 2 2 v24 a2 2 0 0 1 -2 2 h-8 a2 2 0 0 1 -2 -2 v-24 a2 2 0 0 1 2 -2z',
  },
  undercling: {
    name: '언더클링',
    en: 'Undercling',
    look: '아래에서 위로 들어 올려 잡는 홀드(손바닥이 위를 향함)',
    desc: '홀드 밑면을 위로 당겨 잡아요. 팔을 굽히고 발을 높이 올려 몸을 밀어야 해요.',
    grip: '손바닥이 위를 향하게 걸고, 발을 밀어 엉덩이를 벽에 붙이며 당겨요',
    penalty: 0.4,
    icon: 'M6 28 V16 Q6 4 24 4 Q42 4 42 16 V28 H34 V17 Q34 12 24 12 Q14 12 14 17 V28 Z',
  },
  volume: {
    name: '볼륨',
    en: 'Volume',
    look: '벽에 붙은 삼각뿔·반구 같은 큰 구조물(화면에서 아주 큰 덩어리)',
    desc: '손잡이가 없는 큰 구조물이에요. 모서리와 면을 손과 발로 자유롭게 쓸 수 있고, 넓은 발판으로도 좋아요. 위로 올라서는 맨틀링에도 쓰여요.',
    grip: '면은 미끄러우니 모서리나 홈을 찾고, 손바닥으로 눌러 마찰로 버텨요',
    penalty: 0.5,
    icon: 'M4 28 L24 4 L44 28 Z',
  },
}

export const HOLD_ORDER = ['jug', 'crimp', 'sloper', 'pinch', 'pocket', 'sidepull', 'undercling', 'volume']

// 동작. auto = 앱이 코스에서 자동으로 추천하는 동작, pose = 졸라맨이 어떻게 그려지는지
export const MOVES = {
  reach: {
    name: '리치',
    en: 'Static reach',
    desc: '몸을 흔들지 않고 천천히 팔을 뻗어 다음 홀드를 잡는 가장 기본 동작이에요.',
    tips: ['팔을 곧게 펴고 뼈로 매달려 힘을 아껴요', '발 위에 엉덩이를 올려 다리로 체중을 받쳐요'],
    auto: true,
    pose: '두 팔을 곧게 펴고 엉덩이가 발 위에 실려요',
  },
  lockoff: {
    name: '락오프',
    en: 'Lock-off',
    desc: '한 팔을 굽혀 몸을 끌어올린 채 고정하고, 다른 손으로 높은 홀드를 잡는 동작이에요.',
    tips: ['한 팔을 굽혀 고정한 채 다리로 밀어 올라가요', '고정한 팔은 어깨 쪽에 붙이고, 반대 손을 위로 뻗어요'],
    auto: true,
    pose: '잡고 있는 팔은 굽혀 고정하고, 움직이는 팔은 쭉 뻗어요',
  },
  deadpoint: {
    name: '데드포인트',
    en: 'Deadpoint',
    desc: '다리로 밀어 올라 몸이 가장 높이 올라간 순간(무중력 순간)에 홀드를 정확히 잡는 동작이에요. 점프보다 조절이 쉬워요.',
    tips: ['무릎을 굽혔다가 다리를 펴며 몸을 끌어올려요', '몸이 가장 높이 올라간 순간에 홀드를 잡고 바로 몸을 고정해요'],
    auto: true,
    pose: '몸을 길게 펴고, 움직이는 팔이 끝까지 뻗어요',
  },
  dyno: {
    name: '다이노',
    en: 'Dyno',
    desc: '두 발이 벽에서 떨어질 만큼 점프해서 먼 홀드를 잡는 동작이에요. 실패하면 떨어지니 안전 확인이 먼저예요.',
    tips: ['무릎을 깊게 굽혔다가 두 발로 강하게 밀어 올라가요', '발이 떨어지는 순간 목표 홀드를 향해 팔을 쭉 뻗고, 잡으면 바로 발을 벽에 붙여요', '실패해도 안전하게 떨어질 수 있는 매트와 높이인지 먼저 확인하세요'],
    auto: true,
    pose: '점프 순간에는 발이 벽에서 떨어지고 몸을 쭉 펴서 두 팔을 목표로 뻗어요',
  },
  flag: {
    name: '플래깅',
    en: 'Flagging',
    desc: '한 다리를 벽에서 떼어 옆으로 뻗어 균형을 잡는 동작이에요. 옆으로 이동할 때 몸이 문짝처럼 벌어지는 걸 막아줘요.',
    tips: ['한 발만 딛고 다른 다리를 이동 반대쪽으로 쭉 뻗어 균형을 잡아요', '엉덩이를 벽에 붙이고 손을 옮겨요'],
    auto: false,
    pose: '참고용 용어예요. 다리를 허공에 두는 자세라 자동 추천에서는 쓰지 않고, 발은 항상 홀드를 딛게 해요',
  },
  dropknee: {
    name: '드롭니',
    en: 'Drop knee',
    desc: '골반을 벽 쪽으로 틀고 한쪽 무릎을 안쪽으로 떨어뜨려 몸을 벽에 붙이는 동작이에요. 옆으로 멀리 뻗을 때 팔이 덜 힘들어요.',
    tips: ['이동하는 쪽 골반을 벽으로 틀고 무릎을 안쪽으로 떨어뜨려요', '두 발은 벽 쪽 바깥 모서리(아웃사이드 엣지)로 딛고, 엉덩이를 벽에 붙여요'],
    auto: true,
    pose: '이동하는 쪽 다리의 무릎이 몸 안쪽으로 꺾여요',
  },
  downclimb: {
    name: '다운클라임',
    en: 'Down-climb',
    desc: '위로 가기 위한 준비로 한 칸 내려와 자세를 정리하는 동작이에요.',
    tips: ['내려가는 동작이에요. 다음 위쪽 홀드를 위한 준비 자세입니다', '팔을 곧게 펴고 발을 먼저 옮긴 뒤 손을 옮겨요'],
    auto: true,
    pose: '두 팔을 곧게 펴고 발 위에서 균형을 잡아요',
  },
  crossover: {
    name: '크로스오버',
    en: 'Cross-through',
    desc: '한 손을 다른 손 위로 교차해서 반대편 홀드를 잡는 동작이에요.',
    tips: ['몸을 비틀지 말고 골반을 벽 쪽으로 돌려 교차한 팔이 걸리지 않게 해요'],
    auto: false,
    pose: '참고용 용어예요. 자동 추천에는 쓰이지 않아요',
  },
  match: {
    name: '매칭',
    en: 'Matching',
    desc: '반대 손이 잡고 있는 홀드에 다른 손을 함께 올려 두 손으로 잡는 동작이에요. 다음 홀드가 멀 때 손을 바꾸거나 쉬어가요.',
    tips: ['먼저 잡은 손의 손가락을 조금 비켜 자리를 만들고 다른 손을 올려요', '두 손으로 잡은 뒤 발을 먼저 올리고 다음 홀드로 손을 뻗어요'],
    auto: true,
    pose: '두 손이 한 홀드에 모이고, 몸은 그 아래 중앙에 와요',
  },
  mantle: {
    name: '맨틀링',
    en: 'Mantling',
    desc: '수영장 턱을 짚고 올라오듯, 홀드를 아래로 눌러 몸을 밀어 올려 마무리하는 동작이에요.',
    tips: ['손바닥으로 홀드를 아래로 누르며 발을 끌어올려 몸을 올려요', '팔을 굽혀 몸을 홀드 위로 밀어 올리고, 발을 높이 올려 올라서요'],
    auto: true,
    pose: '움직이는 팔을 굽혀 볼륨을 아래로 누르며 몸을 밀어 올려요',
  },
  stemming: {
    name: '스테밍',
    en: 'Stemming',
    desc: '마주 보는 두 면에 손과 발(또는 양발)을 벌려 밀어 체중을 버티는 동작이에요.',
    tips: ['양쪽 면을 힘껏 밀어 몸을 고정하고 쉬어요'],
    auto: false,
    pose: '참고용 용어예요. 자동 추천에는 쓰이지 않아요',
  },
}

// 발 기술
export const FEET = {
  volume: {
    name: '볼륨 딛기',
    en: 'Volume foot',
    desc: '볼륨의 넓은 면이나 모서리에 발을 올려 서는 발 기술이에요. 발판이 넓어 안정적이에요.',
    tip: '넓은 면에 발바닥을 붙여 마찰로 서거나, 모서리에 발끝을 걸어요',
    auto: true,
  },
  footmatch: {
    name: '발 매칭',
    en: 'Foot match',
    desc: '한 홀드에 두 발을 함께 올리는 거예요. 발 닿는 홀드가 하나뿐일 때 발을 허공에 두지 않고 안정적으로 서요.',
    tip: '먼저 올린 발을 홀드 한쪽으로 비켜 자리를 만들고 다른 발을 나란히 올려요',
    auto: true,
  },
  edging: {
    name: '엣징',
    en: 'Edging',
    desc: '신발 안쪽(엄지 쪽) 모서리를 작은 발 홀드에 올려 서는 기본 발 기술이에요.',
    tip: '발끝 안쪽 모서리를 홀드에 정확히 올리고 발목을 세워 발끝에 체중을 실어요',
    auto: true,
  },
  smear: {
    name: '스미어',
    en: 'Smearing',
    desc: '홀드가 없는 벽면에 신발 밑창 고무를 넓게 눌러 마찰로 버티는 발 기술이에요.',
    tip: '뒤꿈치를 살짝 낮추고 발바닥 전체를 벽에 눌러 체중을 발에 실어요',
    auto: true,
  },
  heelhook: {
    name: '힐훅',
    en: 'Heel hook',
    desc: '엉덩이 높이 근처의 홀드에 뒤꿈치를 걸고 다리 뒤쪽 힘으로 몸을 끌어당기는 발 기술이에요.',
    tip: '뒤꿈치를 홀드에 걸고 무릎을 굽혀 햄스트링으로 몸을 당겨요',
    auto: true,
  },
  toehook: {
    name: '토훅',
    en: 'Toe hook',
    desc: '발등을 홀드에 걸어 몸이 벽에서 벌어지는 걸 막는 발 기술이에요.',
    tip: '발등으로 홀드를 걸고 다리를 당겨 몸을 안쪽으로 붙여요',
    auto: false,
  },
  flag: {
    name: '플래그 다리',
    en: 'Flag leg',
    desc: '균형을 위해 벽에서 떼어 옆으로 뻗은 다리예요.',
    tip: '뻗은 다리로 무게중심을 반대쪽에 두고 몸이 벌어지는 걸 막아요',
    auto: true,
  },
  air: {
    name: '공중',
    en: 'Airborne',
    desc: '점프하는 동안 두 발이 벽에서 떨어져 있는 상태예요.',
    tip: '착지하면 바로 발을 벽에 붙여 체중을 발에 실어요',
    auto: true,
  },
}

// 홀드 모양(크기 대비 비율, 길쭉함, 방향)으로 종류를 추정한다. 정확한 판별이 아니라 어림값이라 「종류」 모드에서 고칠 수 있음.
export function estimateHoldType(h, medianSize) {
  const ratio = medianSize ? h.size / medianSize : 1
  const elong = h.elong ?? 1
  const a = Math.abs(h.angle ?? 0)
  const vertical = a > Math.PI / 3 // 세로에 가까움
  const horizontal = a < Math.PI / 6
  if (elong >= 1.7) {
    if (vertical) return ratio > 1.6 ? 'pinch' : 'sidepull'
    if (horizontal) return ratio > 1.3 ? 'jug' : 'crimp'
    return ratio > 1.4 ? 'undercling' : 'sidepull'
  }
  if (ratio < 0.55) return 'pocket'
  if (ratio < 0.9) return 'crimp'
  if (ratio >= 1.6) return 'jug'
  return 'sloper'
}
