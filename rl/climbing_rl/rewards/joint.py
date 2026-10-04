"""4. 관절 / 생체역학(R_joint)"""
import math

from ..limits import base_name, limit
from .base import term


def rom_fraction(q, lo, hi):
    """가동범위 중앙에서 얼마나 벗어났는지: 0 = 중앙, 1 = 한계, 1 초과 = 한계를 넘음

    명세 식은 |q-q_mid|/q_range 인데, 이 값은 한계에서 0.5 라서 0.9를 넘을 수 없다.
    그래서 반폭(q_range/2)으로 나눠 '가동범위의 90%' 의미가 맞게 했다.
    """
    mid, half = (lo + hi) / 2, (hi - lo) / 2
    return abs(q - mid) / half if half > 0 else 0.0


@term('joint')
def rom_barrier(ctx):
    """-Σ (exp(k·(x - 0.9)) - 1), x = rom_fraction. 0.9 미만이면 0 (−1 은 0.9에서 끊김 없이 이어지게)"""
    k, th = ctx.p['rom_k'], ctx.p['rom_threshold']
    s = 0.0
    for name, j in ctx.cur.joints.items():
        lim = limit(name)
        if lim is None:
            continue
        # 팔꿈치·무릎·손목의 '곧게 편' 끝(0°)은 뼈로 버티는 정상 자세라 장벽을 걸지 않고 과신전 항목이 맡는다.
        # (안 그러면 팔을 펴고 매달릴수록 벌점 → straight_arm_rest 와 정면 충돌)
        if lim[4] and j.q <= (lim[0] + lim[1]) / 2:
            continue
        x = rom_fraction(j.q, lim[0], lim[1])
        if x > th:
            s += math.exp(k * (x - th)) - 1.0
    return -s


@term('joint')
def hyperextension(ctx):
    """무릎/팔꿈치/손목이 신전 한계를 넘은 각도(rad) 제곱 합(가중치 -2.0)"""
    s = 0.0
    for name, j in ctx.cur.joints.items():
        lim = limit(name)
        if lim is None or not lim[4]:
            continue
        s += max(0.0, lim[0] - j.q) ** 2
    return s


@term('joint')
def joint_vel_limit(ctx):
    """인간 최대 각속도 초과분 제곱(가중치 -0.1)"""
    s = 0.0
    for name, j in ctx.cur.joints.items():
        lim = limit(name)
        if lim is not None:
            s += max(0.0, abs(j.qd) - lim[2]) ** 2
    return s


@term('joint')
def torque_limit(ctx):
    """(피로 반영) 최대 토크의 80% 초과분 제곱(정규화, 가중치 -0.1). 하드 클리핑은 환경에서 limits.clip_torque"""
    s = 0.0
    for name, j in ctx.cur.joints.items():
        lim = limit(name)
        if lim is None:
            continue
        tm = lim[3] * ctx.fatigue.torque_scale(base_name(name))
        if tm <= 0:
            continue
        s += max(0.0, abs(j.tau) / tm - ctx.p['torque_soft']) ** 2
    return s


@term('joint')
def shoulder_shrug(ctx):
    """손으로 매달린 상태에서 견갑 거상 정도 0~1(가중치 -0.2)"""
    hanging = any(ctx.cur.limbs[k].hold is not None for k in ('lh', 'rh'))
    return float(ctx.cur.shoulder_elevation) if hanging else 0.0


@term('joint')
def self_collision(ctx):
    """신체 부위끼리 충돌 수(가중치 -1.0)"""
    return float(ctx.cur.self_collisions)
