"""2. 안정성 / 균형(R_stability)"""
import math

import numpy as np

from ..geometry import dist_to_polygon
from .base import term


@term('stability')
def contact_count(ctx):
    """지지 접촉 3~4점: +1, 2점: 0, 1점: -1. 목표 손/발이 이동 중이면 그 손발도 지지점으로 쳐 준다(전이 구간 예외)"""
    n = len(ctx.cur.contacts)
    t = ctx.target
    if t is not None and not ctx.cur.limbs[t.limb].in_contact:
        n += 1
    if n >= 3:
        return 1.0
    if n == 1:
        return -1.0
    return 0.0


@term('stability')
def com_support(ctx):
    """COM을 벽면에 투영 → 지지 다각형까지 거리 d → exp(-k·d). 안이면 1"""
    pts = [l.pos[:2] for l in ctx.cur.contacts.values()]
    if not pts:
        return 0.0
    d = dist_to_polygon(ctx.cur.com[:2], pts)
    return math.exp(-ctx.p['com_k'] * d)


@term('stability')
def hip_to_wall(ctx):
    """골반-벽 거리 d → exp(-k·d)"""
    d = max(0.0, ctx.wall_distance(ctx.cur.pelvis_pos))
    return math.exp(-ctx.p['hip_wall_k'] * d)


@term('stability')
def barn_door(ctx):
    """몸통의 수직축(y) 회전 각속도 제곱(가중치 -0.05)"""
    return float(ctx.cur.pelvis_ang_vel[1] ** 2)


@term('stability')
def slip(ctx):
    """접촉 중인 손/발의 홀드 대비 접선 속도 제곱 합(가중치 -0.5)"""
    return float(sum(np.dot(l.tangent_vel, l.tangent_vel) for l in ctx.cur.contacts.values()))
