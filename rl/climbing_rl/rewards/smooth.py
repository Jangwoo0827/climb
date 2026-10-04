"""5. 부드러움(R_smooth)"""
import numpy as np

from .base import term


@term('smooth')
def action_rate(ctx):
    """-‖a_t - a_{t-1}‖²"""
    a, b = ctx.cur.action, ctx.cur.prev_action
    if a is None or b is None:
        return 0.0
    d = np.asarray(a) - np.asarray(b)
    return -float(d @ d)


@term('smooth')
def joint_acc(ctx):
    """-Σ q̈²"""
    return -float(sum(j.qdd ** 2 for j in ctx.cur.joints.values()))


@term('smooth')
def jerk(ctx):
    """-Σ (q̈_t - q̈_{t-1})²"""
    return -float(sum((j.qdd - j.prev_qdd) ** 2 for j in ctx.cur.joints.values()))


@term('smooth')
def gaze(ctx):
    """머리 전방 벡터와 다음 목표 홀드 방향의 코사인 유사도(선택)"""
    h, f, hold = ctx.cur.head_pos, ctx.cur.head_forward, ctx.target_hold
    if h is None or f is None or hold is None:
        return 0.0
    v = hold.position - np.asarray(h)
    n = np.linalg.norm(v) * np.linalg.norm(f)
    return float(v @ np.asarray(f) / n) if n > 0 else 0.0
