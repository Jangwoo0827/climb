"""1. 과제 진행 보상(R_task)

홀드 보너스/완등/정체 판정은 RewardComputer가 스텝마다 ctx.events 에 미리 계산해 둔다
(홀드별 1회 지급, T_hold 안정 접촉 같은 상태 추적이 필요해서).
"""
from .base import term


@term('task')
def progress(ctx):
    """Φ(s') - Φ(s), Φ = -dist(대상 손/발, 다음 목표 홀드). 같은 목표 기준으로 두 상태를 비교하므로 왕복하면 합이 0"""
    if ctx.phi_prev is None or ctx.phi_cur is None:
        return 0.0
    return ctx.phi_cur - ctx.phi_prev


@term('task')
def height_gain(ctx):
    """γ·h(s') - h(s), h = 골반 높이(포텐셜 기반)"""
    if ctx.prev is None:
        return 0.0
    return ctx.p['gamma'] * ctx.cur.pelvis_pos[1] - ctx.prev.pelvis_pos[1]


@term('task')
def hand_hold_reached(ctx):
    """손이 목표 홀드를 T_hold 이상 안정 접촉하면 홀드별 1회"""
    return float(len(ctx.events['hand_reached']))


@term('task')
def foot_hold_secured(ctx):
    """발이 홀드에 체중의 foot_load_ratio 이상 실으면 홀드별 1회"""
    return float(len(ctx.events['foot_secured']))


@term('task')
def top_reached(ctx):
    """탑 홀드 양손 매칭(T_hold 안정) → 성공 종료"""
    return 1.0 if ctx.events['top'] else 0.0


@term('task')
def time_penalty(ctx):
    """매 스텝 상수(가중치 -0.01)"""
    return 1.0


@term('task')
def stagnation(ctx):
    """stagnation_time 초 동안 진행이 없으면 매 스텝(가중치 -0.1)"""
    return 1.0 if ctx.events['stagnating'] else 0.0
