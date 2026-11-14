"""코스 탐색: 다익스트라로 두 손이 시작 홀드에서 끝 홀드까지 가는 가장 싼 경로를 찾는다.

기준 구현(JavaScript): ../src/utils/route.js  (막히면 findRoute, bodyModel 부분을 읽어 보세요)

홀드는 dict: {"mx": 가로(m), "my": 세로(m, 위쪽이 +), "size": 상대 크기,
              "foot_only": 발 전용이면 True(선택), "penalty": 종류별 난이도 감점(선택)}
테스트: python -m pytest tests/test_route.py -v
"""
import heapq  # 우선순위 큐(최소 힙). 다익스트라에서 "지금까지 비용이 가장 작은 상태"를 꺼내는 데 씁니다
import math

LEVELS = {
    "beginner": {"reach_ratio": 0.78, "comfort": 0.5, "down_penalty": 6, "jug_bonus": 1.6, "jump": 0.2, "grip": 1.0},
    "intermediate": {"reach_ratio": 0.9, "comfort": 0.6, "down_penalty": 3, "jug_bonus": 1.0, "jump": 0.32, "grip": 0.6},
    "advanced": {"reach_ratio": 1.0, "comfort": 0.7, "down_penalty": 1.5, "jug_bonus": 0.5, "jump": 0.45, "grip": 0.3},
}


def body_model(height_cm, ape_index, level):
    """몸 치수를 미터 단위로 계산해 dict로 돌려준다.

    키: span, max_reach, max_vertical, comfort, jump_reach, level(= LEVELS[level])
      span         = 키(m) × ape_index                      (팔 벌린 길이)
      max_reach    = min(span × reach_ratio, span × 0.92)    (한 손을 옮길 때 다른 손과의 최대 거리)
      comfort      = span × comfort                          (이 이하면 편한 움직임)
      jump_reach   = max_reach + span × jump                 (점프하면 닿는 최대 거리)
      max_vertical = arm × 0.97 + 0.3 × 키(m) − 0.05
                     (arm = max(0.3, (span − 0.23 × 키(m)) / 2), 손이 허리 위에 있게 하는 두 손 높이 차 한계)
    힌트: tests/test_route.py 위쪽 테스트의 숫자로 손계산해 보세요.
    """
    raise NotImplementedError


def dist(a, b):
    """두 홀드 사이 거리(m)."""
    raise NotImplementedError


def step_cost(holds, body, hand, l, r, t, max_size, hold_penalty=None):
    """한 손을 홀드 t로 옮기는 동작 하나의 비용.

    hand: 옮기는 손 'L' 또는 'R', l / r: 지금 왼손·오른손이 잡은 홀드 번호, t: 옮겨 갈 홀드 번호
    반환: (비용, 점프여부)  또는  이동할 수 없으면 None

    순서(JS의 안쪽 for문):
      1. 이미 잡은 홀드이거나 발 전용 홀드면 None
      2. fixed = 안 움직이는 손의 홀드. d = t와 fixed 사이 거리. d > jump_reach 면 None
      3. match = (t == fixed)  → 두 손을 한 홀드로 모으는 동작
      4. dyno(점프) = (매칭이 아니고 d > max_reach) 또는 (t와 fixed의 높이 차 > max_vertical)
         점프인데 아래로(dy < −0.05) 가면 None
      5. 점프 비용 = 30 + (d − max_reach) × 20
         일반 비용 = 0.6 + (travel / comfort)² × 1.2 에 아래를 더하고 뺀다
            + (max(0, d − comfort × 0.8) / comfort)² × 12     두 손이 벌어질수록
            + 0.4                                              매칭이면
            − 0.5                                              움직이는 손이 반대 손보다 50cm 이상 아래일 때(cur.my < fixed.my − 0.05)
            + max(0, gap − 0.35) × 6                           gap = 이동 뒤 두 손 높이 차
            + (−dy) × down_penalty                             내려가면(dy < 0)
            − min(dy, 0.5) × 0.6                               올라가면(dy > 0)
            + 2                                                손이 너무 교차하면(cross > 0.25)
            + (1 − size / max_size) × jug_bonus                큰 홀드 선호
            + penalty × grip                                   잡기 어려운 종류 감점(홀드의 "penalty" 키, 없으면 0)
         일반 비용은 최소 0.2로 자른다(max(0.2, cost))
      6. 마지막에 hold_penalty.get(t, 0)을 더한다(점프에도 적용)
    cross: 왼손이면 t.mx − fixed.mx, 오른손이면 fixed.mx − t.mx
    """
    raise NotImplementedError


def find_route(holds, body, start_ids, finish_ids, hold_penalty=None):
    """다익스트라. 상태 = (왼손 홀드, 오른손 홀드).

    반환: {"start": (l, r), "steps": [{"hand": 'L'/'R', "to": 홀드번호, "dyno": bool}, ...], "cost": 총비용}
          경로가 없으면 None

    흐름:
      - 시작 상태: start_ids의 모든 (a, b) 쌍. 시작 홀드가 둘 이상이면 a == b 는 제외.
        두 홀드 사이 거리가 max_reach 이하이고 높이 차가 max_vertical 이하일 때만 비용 0으로 시작
      - heapq에서 비용이 가장 작은 상태를 꺼낸다. 이미 더 싸게 도착한 기록이 있으면 건너뛴다
      - 두 손이 모두 finish_ids 안에 있으면 끝(goal)
      - 아니면 두 손(L, R) × 모든 홀드 t 에 step_cost를 구해 다음 상태로 간다
        점프면 두 손 모두 t로 이동. 아니면 움직인 손만 t로
      - 더 싼 길을 찾으면 dp(최소 비용)와 prev(어디서 왔나)를 갱신하고 힙에 넣는다
      - goal에서 prev를 거꾸로 따라가 steps를 만들고 뒤집는다
    힌트: 상태 (l, r)를 튜플로 dict의 키에 쓰면 편합니다.
    """
    raise NotImplementedError
