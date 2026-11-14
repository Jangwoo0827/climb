"""자세 점수(보상 함수) 테스트. 기준 구현: src/utils/reward.js

실행:  python -m pytest tests/test_reward.py -v   (python_impl 폴더에서)
점은 (x, y) 튜플입니다.
"""
import math

import pytest

from reward import com_support, dist_to_polygon, flexion, hull, rom_barrier, weighted_total

SQUARE = [(0, 0), (1, 0), (1, 1), (0, 1)]


# ---------- 1단계: 관절 굽힘 각도 (코사인 법칙) ----------
# flexion(root, mid, end, z=0): 0 = 곧게 폄, π = 완전히 접힘

def test_straight_arm_has_zero_flexion():
    assert flexion((0, 0), (1, 0), (2, 0)) == pytest.approx(0)


def test_right_angle_elbow():
    # 두 뼈 길이 1, 끝점 거리 √2 → 코사인 법칙으로 cos(안쪽 각) = 0, 안쪽 각 90도 = 90도 굽힘
    assert flexion((0, 0), (1, 0), (1, 1)) == pytest.approx(math.pi / 2)


def test_fully_folded():
    assert flexion((0, 0), (1, 0), (0.5, 0)) == pytest.approx(math.pi)


def test_depth_z_makes_the_limb_look_straighter_in_3d():
    # 2D로는 굽혀 보여도 벽에서 떨어진 깊이 z를 더하면 끝점 거리가 길어져 덜 굽음
    flat = flexion((0, 0), (1, 0), (1, 1), z=0)
    deep = flexion((0, 0), (1, 0), (1, 1), z=0.5)
    assert deep < flat


# ---------- 2단계: 관절 한계 장벽 ----------
# rom_barrier(q, lo, hi): 굽히는 쪽 끝(한계의 90% 넘는 곳)에서만 지수로 커지는 벌점

def test_no_penalty_in_the_comfortable_range():
    assert rom_barrier(0.4, 0, 1) == 0
    assert rom_barrier(0.5, 0, 1) == 0
    assert rom_barrier(0.7, 0, 1) == 0


def test_no_penalty_exactly_at_threshold():
    assert rom_barrier(0.95, 0, 1) == pytest.approx(0)


def test_penalty_grows_exponentially_at_the_limit():
    # x = |q − mid| / ((hi − lo) / 2) = 1.0 → exp(20 × (1.0 − 0.9)) − 1 = e² − 1
    assert rom_barrier(1.0, 0, 1) == pytest.approx(math.e ** 2 - 1)


# ---------- 3단계: 볼록 껍질과 다각형까지의 거리 ----------

def test_hull_drops_interior_points():
    h = hull(SQUARE + [(0.5, 0.5)])
    assert sorted(h) == sorted(SQUARE)


def test_hull_of_two_points_is_those_points():
    assert sorted(hull([(0, 0), (1, 1)])) == [(0, 0), (1, 1)]


def test_distance_inside_is_zero():
    assert dist_to_polygon((0.5, 0.5), SQUARE) == pytest.approx(0)


def test_distance_outside_edge_and_corner():
    assert dist_to_polygon((2, 0.5), SQUARE) == pytest.approx(1)
    assert dist_to_polygon((2, 2), SQUARE) == pytest.approx(math.sqrt(2))


def test_distance_to_a_segment_when_only_two_contacts():
    assert dist_to_polygon((0.5, 1), [(0, 0), (1, 0)]) == pytest.approx(1)


# ---------- 4단계: 무게중심 안정 + 총점 ----------

def test_com_support_is_one_inside_the_contact_polygon():
    assert com_support((0.5, 0.5), SQUARE) == pytest.approx(1)


def test_com_support_decays_with_distance():
    # exp(−5 × 거리)
    assert com_support((1.2, 0.5), SQUARE) == pytest.approx(math.exp(-1))


def test_weighted_total():
    # 손 홀드 확보 +5.0 × 1, 시간 −0.01 × 20
    assert weighted_total({"hand_hold_reached": 1, "time_penalty": 20}) == pytest.approx(4.8)


def test_weighted_total_ignores_unknown_terms():
    assert weighted_total({"nonsense": 100}) == 0
