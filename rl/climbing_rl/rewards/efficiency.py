"""3. 효율 / 에너지(R_efficiency)"""
import numpy as np

from ..limits import base_name, limit
from ..types import FEET, HANDS
from .base import term


def _tau_max(ctx, name):
    lim = limit(name)
    if lim is None:
        return None
    return lim[3] * ctx.fatigue.torque_scale(base_name(name))


@term('efficiency')
def torque_sq(ctx):
    """-Σ(τ/τ_max)² (관절별 최대 토크로 정규화)"""
    s = 0.0
    for name, j in ctx.cur.joints.items():
        tm = _tau_max(ctx, name)
        if tm:
            s += (j.tau / tm) ** 2
    return -s


@term('efficiency')
def mech_work(ctx):
    """-Σ|τ·ω|"""
    return -float(sum(abs(j.tau * j.qd) for j in ctx.cur.joints.values()))


@term('efficiency')
def muscle_effort(ctx):
    """-Σ a² (또는 a³, params.muscle_power) — 근골격 모델일 때만"""
    a = ctx.cur.muscle_act
    if a is None:
        return 0.0
    return -float(np.sum(np.abs(np.asarray(a)) ** ctx.p['muscle_power']))


@term('efficiency')
def leg_load_ratio(ctx):
    """다리 지지 하중 / 전체 지지 하중"""
    legs = sum(ctx.cur.limbs[k].load for k in FEET if k in ctx.cur.limbs)
    total = legs + sum(ctx.cur.limbs[k].load for k in HANDS if k in ctx.cur.limbs)
    return legs / total if total > 1e-6 else 0.0


@term('efficiency')
def straight_arm_rest(ctx):
    """정적 매달림(골반이 거의 정지)일 때 잡고 있는 팔의 팔꿈치가 펴졌을수록 +. 1 = 완전히 폄"""
    if ctx.prev is None or ctx.cur.dt <= 0:
        return 0.0
    speed = np.linalg.norm(ctx.cur.pelvis_pos - ctx.prev.pelvis_pos) / ctx.cur.dt
    if speed > ctx.p['static_speed']:
        return 0.0
    vals = []
    for side, hand in (('l', 'lh'), ('r', 'rh')):
        j = ctx.cur.joints.get(f'{side}_elbow_flexion')
        if j is None or ctx.cur.limbs[hand].hold is None:
            continue
        hi = limit('elbow_flexion')[1]
        vals.append(1.0 - min(1.0, max(0.0, j.q) / hi))
    return float(np.mean(vals)) if vals else 0.0


@term('efficiency')
def grip_excess(ctx):
    """필요 악력을 넘는 초과분 제곱(체중으로 정규화, 가중치 -0.05)"""
    w = ctx.cur.body_weight
    return float(sum(max(0.0, (ctx.cur.limbs[k].grip_force - ctx.cur.limbs[k].grip_required) / w) ** 2 for k in HANDS if k in ctx.cur.limbs))


@term('efficiency')
def unnecessary_dyno(ctx):
    """정적으로 닿는 목표인데 모든 접촉을 놓고 뜬 순간 1회(가중치 -1.0)"""
    return 1.0 if ctx.events['unnecessary_dyno'] else 0.0
