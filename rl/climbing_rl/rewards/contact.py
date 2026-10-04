"""6. 접촉 품질(R_contact)"""
import numpy as np

from ..types import FEET, HANDS
from .base import term


def illegal_load(state, p) -> float:
    """허용 예외(params.illegal_allowed, 예: 니바 허용 시 'knee')를 뺀 비허용 부위 하중 합"""
    allowed = set(p['illegal_allowed'])
    return float(sum(v for k, v in state.illegal_load.items() if k not in allowed))


@term('contact')
def illegal_contact(ctx):
    """손/발 외 부위가 하중을 지지하면 매 스텝 1(가중치 -1.0)"""
    return 1.0 if illegal_load(ctx.cur, ctx.p) > ctx.p['illegal_min_load'] else 0.0


@term('contact')
def toe_precision(ctx):
    """홀드를 디딘 발: 발끝 +1, 발 중간 -0.3(약한 -), 뒤꿈치(힐훅)는 0"""
    s = 0.0
    for k in FEET:
        l = ctx.cur.limbs.get(k)
        if l is None or l.hold is None:
            continue
        s += {'toe': 1.0, 'mid': -ctx.p['toe_mid_penalty']}.get(l.contact_region, 0.0)
    return s


@term('contact')
def grip_alignment(ctx):
    """손 하중 방향과 홀드 유효 그립 방향의 코사인 유사도 평균"""
    vals = []
    for k in HANDS:
        l = ctx.cur.limbs.get(k)
        if l is None or l.hold is None or l.force_dir is None:
            continue
        g = ctx.holds[l.hold].grip_direction
        n = np.linalg.norm(l.force_dir) * np.linalg.norm(g)
        if n > 0:
            vals.append(float(l.force_dir @ g / n))
    return float(np.mean(vals)) if vals else 0.0


@term('contact')
def impact(ctx):
    """접촉 충격력이 체중×impact_ratio를 넘는 초과분(체중 정규화) 제곱(가중치 -0.01)"""
    w = ctx.cur.body_weight
    th = ctx.p['impact_ratio'] * w
    return float(sum(max(0.0, (l.impact - th) / w) ** 2 for l in ctx.cur.limbs.values()))
