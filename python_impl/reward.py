"""자세 점수(보상 함수)의 핵심 계산들.

기준 구현(JavaScript): ../src/utils/reward.js
점은 (x, y) 튜플. 강화학습으로 학습하는 게 아니라, 이미 정해진 보상 항목으로 자세를 채점하는 코드입니다.
테스트: python -m pytest tests/test_reward.py -v
"""
import math

# 보상 항목별 가중치 (reward.js의 WEIGHTS와 같은 값)
WEIGHTS = {
    "height_gain": 0.5,
    "hand_hold_reached": 5.0,
    "foot_hold_secured": 2.0,
    "time_penalty": -0.01,
    "contact_count": 0.2,
    "com_support": 0.3,
    "leg_load_ratio": 0.3,
    "straight_arm_rest": 0.1,
    "rom_barrier": 0.5,
    "grip_alignment": 0.2,
    "toe_precision": 0.1,
}
COM_K = 5.0          # 무게중심 안정: exp(−COM_K × 거리)
ROM_K = 20.0         # 관절 한계 장벽의 지수 기울기
ROM_THRESHOLD = 0.9  # 관절 가동 범위의 90%를 넘으면 장벽 시작


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def d2(a, b):
    """두 점 사이 거리."""
    raise NotImplementedError


def flexion(root, mid, end, z=0.0):
    """관절(mid)의 굽힘 각도(라디안). 0 = 곧게 폄, π = 완전히 접힘.

    l1 = |root-mid|, l2 = |mid-end|, d = √(|root-end|² + z²)   (z: 벽에서 떨어진 깊이)
    d >= l1 + l2 면 곧게 편 상태이므로 0
    아니면 코사인 법칙: cos(관절 안쪽 각) = (l1² + l2² − d²) / (2·l1·l2)
         굽힘 = π − acos(그 값)       (acos 인자는 clamp(−1, 1)로 오차 방지)
    """
    raise NotImplementedError


def rom_barrier(q, lo, hi):
    """관절 한계 장벽(벌점). q = 굽힘 각도, [lo, hi] = 가동 범위.

    mid = (lo + hi) / 2,  q <= mid 이면 0 (곧게 펴는 쪽은 정상 자세이므로)
    x = |q − mid| / ((hi − lo) / 2)
    x > ROM_THRESHOLD 이면 exp(ROM_K × (x − ROM_THRESHOLD)) − 1, 아니면 0
    """
    raise NotImplementedError


def hull(points):
    """볼록 껍질(monotone chain). 점들을 감싸는 가장 작은 볼록 다각형의 꼭짓점을 돌려준다.

    1. 점을 정렬하고 중복을 없앤다. 2개 이하면 그대로 반환
    2. cross(o, a, b) = (a.x−o.x)(b.y−o.y) − (a.y−o.y)(b.x−o.x)
    3. 아래 껍질: 정렬된 순서로 점을 넣으며, 마지막 두 점과 새 점이 시계 방향(cross <= 0)이면 마지막 점을 뺀다
    4. 위 껍질: 같은 일을 거꾸로 정렬된 순서로
    5. 아래[:-1] + 위[:-1]
    """
    raise NotImplementedError


def seg_dist(p, a, b):
    """점 p에서 선분 ab까지의 최단 거리. (선분 위로 사영한 비율 t를 0~1로 자른다)"""
    raise NotImplementedError


def dist_to_polygon(p, points):
    """점 p에서 points의 볼록 껍질까지 거리. 안쪽이면 0.

    껍질이 점 1개면 그 점까지, 2개면 선분까지.
    3개 이상이면: 모든 변에 대해 p가 같은 쪽(cross >= 0)에 있으면 안쪽(0),
    아니면 각 변까지 거리(seg_dist)의 최솟값.
    """
    raise NotImplementedError


def com_support(com, contacts):
    """무게중심 안정 항목: 무게중심 com이 접촉점(손발)들이 만드는 다각형에서 얼마나 가까운가.
    exp(−COM_K × 다각형까지 거리). 안쪽이면 1.
    """
    raise NotImplementedError


def weighted_total(terms):
    """항목별 값(dict)에 WEIGHTS를 곱해 합한다. WEIGHTS에 없는 항목은 무시(0)."""
    raise NotImplementedError
