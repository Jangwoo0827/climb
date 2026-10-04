"""보상 해킹 대응(명세 10장) 등 검증. pytest 없이 `python tests/test_rewards.py` 로 실행."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402

from climbing_rl import (Curriculum, FatigueModel, Hold, JointState, LimbState, RewardComputer,  # noqa: E402
                         RewardLogger, StepState, apply_stage, load_config, route_from)
from climbing_rl.rewards.joint import rom_fraction  # noqa: E402

DT = 0.05
BW = 700.0
HOLDS = [
    Hold('S1', [-0.2, 1.9, 0], is_start=True),
    Hold('S2', [0.2, 1.9, 0], is_start=True),
    Hold('A', [-0.2, 2.3, 0]),  # 왼손 목표
    Hold('B', [0.2, 2.6, 0]),  # 오른손 목표
    Hold('T', [0.0, 2.9, 0], is_top=True),
    Hold('F1', [-0.2, 0.6, 0]),
    Hold('F2', [0.2, 0.6, 0]),
    Hold('F3', [-0.2, 1.0, 0]),
]
ROUTE = route_from([('lh', 'A'), ('rh', 'B'), ('lh', 'T'), ('rh', 'T')])
H = {h.id: h for h in HOLDS}


def limbs(lh='S1', rh='S2', lf='F1', rf='F2', pos=None, loads=None):
    out = {}
    pos = pos or {}
    loads = loads or {}
    for k, hid in (('lh', lh), ('rh', rh), ('lf', lf), ('rf', rf)):
        p = pos.get(k, H[hid].position if hid else np.zeros(3) + [0, 1.5, 0.2])
        default = BW * (0.3 if k in ('lf', 'rf') else 0.2) if hid else 0.0
        out[k] = LimbState(pos=p, hold=hid, load=loads.get(k, default), contact_region='toe' if k in ('lf', 'rf') else None)
    return out


def state(t, ls, pelvis=(0, 1.2, 0.25), **kw):
    return StepState(t=t, dt=DT, pelvis_pos=pelvis, com=pelvis, limbs=ls, body_weight=BW, **kw)


def make(cfg=None, **kw):
    cfg = cfg or load_config(stage=3)
    rc = RewardComputer(cfg, HOLDS, ROUTE, **kw)
    rc.reset(state(0.0, limbs()))
    return rc


def run(rc, states):
    return [rc.step(s) for s in states]


# ---------------------------------------------------------------------------

def test_registry_and_config_weights():
    from climbing_rl.rewards import REGISTRY
    cfg = load_config()
    missing = set(REGISTRY) - set(cfg['terms'])
    extra = set(cfg['terms']) - set(REGISTRY)
    assert not missing and not extra, (missing, extra)
    assert len(REGISTRY) == 34


def test_progress_oscillation_sums_to_zero():
    """목표 근처 왕복으로 progress 반복 획득 불가(포텐셜 기반)"""
    rc = make()
    tot, t = 0.0, 0.0
    near, far = H['A'].position + [0, -0.05, 0.05], H['A'].position + [0, -0.3, 0.1]
    for i in range(40):
        t += DT
        p = near if i % 2 == 0 else far
        r = rc.step(state(t, limbs(lh=None, pos={'lh': p})))
        tot += r.log['progress']
    # 왕복 마지막이 far 이므로 출발점(S1 근처)보다 약간 가까운 만큼만 남는다
    start = -np.linalg.norm(H['S1'].position - H['A'].position)
    expect = -np.linalg.norm(far - H['A'].position) - start
    assert abs(tot - expect) < 1e-9, (tot, expect)


def test_bonus_only_after_t_hold_and_once():
    """홀드에 손 대고 진동해도 보너스 없음, T_hold 안정 접촉 후 홀드별 1회만"""
    rc = make()
    t, bonus = 0.0, 0.0
    seq = (['A'] * 2 + [None] * 2) * 5  # 0.1초씩 스치기
    seq += ['A'] * 10  # 0.5초 안정
    seq += [None] * 3 + ['A'] * 10  # 놓았다가 다시 잡기
    for h in seq:
        t += DT
        ls = limbs(lh=h, pos=None if h else {'lh': H['A'].position + [0, -0.1, 0.1]})
        r = rc.step(state(t, ls))
        bonus += r.log['hand_hold_reached']
    assert bonus == 5.0, bonus  # 정확히 1회 × 5.0


def test_sliding_contact_not_stable():
    """접촉은 유지해도 미끄러지는 중이면 안정 접촉 시간이 쌓이지 않음"""
    rc = make()
    t, bonus = 0.0, 0.0
    for _ in range(20):
        t += DT
        ls = limbs(lh='A')
        ls['lh'].tangent_vel = np.array([0.3, 0, 0])
        bonus += rc.step(state(t, ls)).log['hand_hold_reached']
    assert bonus == 0.0


def test_target_advances_and_top_success():
    rc = make()
    t = 0.0
    plan = [('A', 'S2')] * 8 + [('A', 'B')] * 8 + [('T', 'B')] * 8 + [('T', 'T')] * 8
    total, res = 0.0, None
    for lh, rh in plan:
        t += DT
        res = rc.step(state(t, limbs(lh=lh, rh=rh), pelvis=(0, 1.6, 0.25)))
        total += res.reward
        if res.terminated:
            break
    assert res.terminated and not res.truncated and res.reason == 'top', res.reason
    assert res.log['top_reached'] == 50.0
    assert rc.ep.target_idx == 4


def test_foot_bonus_needs_load():
    rc = make()
    t, bonus = 0.0, 0.0
    for _ in range(10):  # F3 디뎠지만 하중 거의 없음
        t += DT
        bonus += rc.step(state(t, limbs(lf='F3', loads={'lf': 10.0}))).log['foot_hold_secured']
    assert bonus == 0.0
    for _ in range(10):
        t += DT
        bonus += rc.step(state(t, limbs(lf='F3', loads={'lf': 0.3 * BW}))).log['foot_hold_secured']
    assert bonus == 2.0, bonus


def test_rom_barrier():
    """가동범위 90% 미만이면 0, 넘으면 지수적으로 증가, 0.9에서 끊김 없음"""
    rc = make()
    lo, hi = 0.0, 145 * math.pi / 180  # 팔꿈치
    vals = []
    for frac in (0.5, 0.89, 0.9, 0.95, 1.0):
        q = (lo + hi) / 2 + frac * (hi - lo) / 2
        assert abs(rom_fraction(q, lo, hi) - frac) < 1e-9
        rc2 = make()
        r = rc2.step(state(DT, limbs(), joints={'l_elbow_flexion': JointState(q=q)}))
        vals.append(r.log['rom_barrier'])
    assert vals[0] == 0.0 and vals[1] == 0.0 and abs(vals[2]) < 1e-12
    assert vals[2] > vals[3] > vals[4]  # 음수로 점점 커짐
    assert (vals[4] - vals[3]) < (vals[3] - vals[2])  # 지수 증가


def test_rom_barrier_ignores_straight_end():
    """팔을 곧게 편 0°는 벌점 없음(과신전 항목이 따로 담당), 끝까지 굽힌 쪽만 장벽"""
    rc = make()
    r = rc.step(state(DT, limbs(), joints={'l_elbow_flexion': JointState(q=0.0), 'r_knee_flexion': JointState(q=0.0)}))
    assert r.log['rom_barrier'] == 0.0 and r.log['hyperextension'] == 0.0
    rc = make()
    r = rc.step(state(DT, limbs(), joints={'l_elbow_flexion': JointState(q=144 * math.pi / 180)}))
    assert r.log['rom_barrier'] < 0


def test_hyperextension_and_velocity():
    rc = make()
    r = rc.step(state(DT, limbs(), joints={'r_knee_flexion': JointState(q=-0.2, qd=30.0)}))
    assert abs(r.log['hyperextension'] - (-2.0 * 0.04)) < 1e-9
    assert r.log['joint_vel_limit'] < 0


def test_unnecessary_dyno():
    rc = make()
    # 목표 A(골반에서 static_reach 1.2m 안) → 전부 놓고 뜨면 페널티
    r = rc.step(state(DT, limbs(lh=None, rh=None, lf=None, rf=None), pelvis=(0, 1.3, 0.3)))
    assert r.log['unnecessary_dyno'] == -1.0
    # 다음 스텝(계속 공중)에는 다시 주지 않음
    r = rc.step(state(2 * DT, limbs(lh=None, rh=None, lf=None, rf=None), pelvis=(0, 1.35, 0.3)))
    assert r.log['unnecessary_dyno'] == 0.0

    # 목표가 멀면(정적으로 못 닿음) 다이노 허용
    far = [Hold(h.id, h.position, is_start=h.is_start, is_top=h.is_top) for h in HOLDS]
    far[2] = Hold('A', [-0.2, 3.2, 0])
    rc = RewardComputer(load_config(stage=3), far, ROUTE)
    rc.reset(state(0.0, limbs(), pelvis=(0, 1.2, 0.25)))
    r = rc.step(state(DT, limbs(lh=None, rh=None, lf=None, rf=None), pelvis=(0, 1.3, 0.3)))
    assert r.log['unnecessary_dyno'] == 0.0


def test_precise_dyno_uses_callback():
    cfg = load_config(stage=4)
    assert cfg['params']['precise_dyno']
    rc = RewardComputer(cfg, HOLDS, ROUTE, static_reachable=lambda s, h: False)
    rc.reset(state(0.0, limbs()))
    r = rc.step(state(DT, limbs(lh=None, rh=None, lf=None, rf=None), pelvis=(0, 1.3, 0.3)))
    assert r.log['unnecessary_dyno'] == 0.0


def test_illegal_contact_penalty_and_termination():
    """몸통/무릎으로 버티기 → 매 스텝 페널티, illegal_time 넘으면 -5 종료"""
    rc = make()
    t, res = 0.0, None
    for i in range(40):
        t += DT
        res = rc.step(state(t, limbs(), illegal_load={'torso': 200.0}))
        assert res.log['illegal_contact'] == -1.0
        if res.terminated:
            break
    assert res.reason == 'illegal_contact' and res.log['termination'] == -5.0
    assert abs(t - 1.0) < 1e-6

    # 니바 허용이면 무릎 하중은 반칙 아님
    cfg = load_config(stage=3)
    cfg['params']['illegal_allowed'] = ['knee']
    rc = make(cfg)
    r = rc.step(state(DT, limbs(), illegal_load={'knee': 200.0}))
    assert r.log['illegal_contact'] == 0.0


def test_stagnation():
    """한 자세로 버티기 → stagnation_time 이후 매 스텝 페널티"""
    rc = make()
    t, first = 0.0, None
    for i in range(140):
        t += DT
        r = rc.step(state(t, limbs()))
        if r.log['stagnation'] < 0 and first is None:
            first = t
    assert first is not None and abs(first - 5.0) < DT + 1e-9, first


def test_stagnation_gates_positive_shaping():
    """정체 중엔 자세 보너스(com_support 등)가 0 → 버티기가 '생존 보상'이 되지 않음"""
    rc = make()
    t, before, after = 0.0, None, None
    for i in range(140):
        t += DT
        r = rc.step(state(t, limbs()))
        if i == 10:
            before = r.log['com_support']
        after = r.log
    assert before > 0 and after['com_support'] == 0.0 and after['contact_count'] == 0.0
    nontask = sum(v for k, v in after.items() if k.startswith('group/') and k != 'group/task')
    assert nontask <= 0 and after['reward'] < 0


def test_fall_and_ground():
    rc = make()
    t = DT
    rc.step(state(t, limbs(lh=None, rh=None, lf=None, rf=None), pelvis=(0, 1.2, 0.3)))
    res = None
    for y in (1.1, 0.9, 0.6):
        t += DT
        res = rc.step(state(t, limbs(lh=None, rh=None, lf=None, rf=None), pelvis=(0, y, 0.3)))
        if res.terminated:
            break
    assert res.reason == 'fall' and res.log['termination'] == -20.0

    rc = make()
    r = rc.step(state(DT, limbs(), ground_contact=True))
    assert r.reason == 'fall'


def test_timeout_is_truncation():
    cfg = load_config(stage=3)
    cfg['termination']['max_time'] = 0.2
    rc = make(cfg)
    t, r = 0.0, None
    while True:
        t += DT
        r = rc.step(state(t, limbs()))
        if r.terminated or r.truncated:
            break
    assert r.truncated and not r.terminated and r.reason == 'timeout' and r.log['termination'] == 0.0


def test_stage_overrides():
    base = load_config()
    s1, s2, s3 = (apply_stage(base, s) for s in (1, 2, 3))
    assert abs(s1['groups']['efficiency'] - 0.1) < 1e-12 and abs(s1['groups']['joint'] - 0.1) < 1e-12
    assert s1['groups']['contact'] == 0.0 and not s1['fatigue']
    assert s2['groups']['smooth'] == 0.5 and s2['groups']['contact'] == 1.0
    assert s3['groups']['efficiency'] == 1.0 and s3['fatigue']
    # 단계 1에서는 반칙 페널티 항은 꺼져도 종료 조건은 그대로
    rc = make(s1)
    r = rc.step(state(DT, limbs(), illegal_load={'torso': 200.0}))
    assert r.log['illegal_contact'] == 0.0 and rc.ep.illegal_time > 0


def test_multiplicative_mode():
    cfg = load_config(stage=3)
    cfg['mode'] = 'multiplicative'
    rc = make(cfg)
    r_clean = rc.step(state(DT, limbs(lh=None, pos={'lh': H['A'].position + [0, -0.2, 0.1]})))
    rc = make(cfg)
    r_bad = rc.step(state(DT, limbs(lh=None, pos={'lh': H['A'].position + [0, -0.2, 0.1]}),
                          joints={'r_knee_flexion': JointState(q=-0.3)}))
    assert r_bad.log['mult_factor'] < r_clean.log['mult_factor'] <= 1.0
    assert r_bad.reward < r_clean.reward
    # task가 음수일 때(가만히 있음) 페널티가 늘면 보상이 커지면 안 됨
    rc = make(cfg)
    a = rc.step(state(DT, limbs())).reward
    rc = make(cfg)
    b = rc.step(state(DT, limbs(), joints={'r_knee_flexion': JointState(q=-0.3)})).reward
    assert b <= a


def test_fatigue_dynamics():
    f = FatigueModel()
    for _ in range(100):
        f.step({'fingers': 0.8, 'legs': 0.0}, 0.1)
    assert f.F['fingers'] > 0.4 and f.F['legs'] == 0.0
    tired = f.torque_scale('finger_flexion')
    assert abs(tired - (1 - f.F['fingers'])) < 1e-12
    for _ in range(100):
        f.step({'fingers': 0.0}, 0.1)
    assert f.F['fingers'] < 0.3 and f.torque_scale('finger_flexion') > tired
    assert f.observation().shape == (4,)


def test_fatigue_lowers_torque_limit():
    cfg = load_config(stage=3)
    rc = make(cfg)
    rc.fatigue.F['fingers'] = 0.5
    r = rc.step(state(DT, limbs(), joints={'l_finger_flexion': JointState(q=0.5, tau=10.0)}))
    assert r.log['torque_limit'] < 0  # 10 N·m 은 15의 67%지만 피로 50%면 7.5 기준으로 초과
    rc = make(cfg)
    r = rc.step(state(DT, limbs(), joints={'l_finger_flexion': JointState(q=0.5, tau=10.0)}))
    assert r.log['torque_limit'] == 0.0


def test_stability_terms():
    rc = make()
    r = rc.step(state(DT, limbs(), pelvis=(0, 1.2, 0.25)))
    assert abs(r.log['com_support'] - 0.3) < 1e-9  # COM이 4점 지지 다각형 안
    assert r.log['contact_count'] == 0.2
    rc = make()
    r = rc.step(state(DT, limbs(), pelvis=(1.5, 1.2, 0.25)))
    assert r.log['com_support'] < 0.3 * 0.01


def test_leg_load_and_logger(tmp=os.path.join(os.path.dirname(__file__), '_tmp_log.csv')):
    rc = make()
    lg = RewardLogger(tmp)
    t = 0.0
    for i in range(30):
        t += DT
        r = rc.step(state(t, limbs(loads={'lf': 300, 'rf': 300, 'lh': 50, 'rh': 50})))
        lg.log(0, i, r.log)
    lg.close()
    assert abs(r.log['leg_load_ratio'] - 0.3 * 600 / 700) < 1e-9
    dom = lg.dominance(3)
    assert dom[0][1] >= dom[1][1]
    assert os.path.getsize(tmp) > 0
    os.remove(tmp)


def test_curriculum():
    cfg = load_config()
    c = Curriculum(cfg)
    for _ in range(99):
        assert not c.record(True)
    assert c.record(True) and c.stage == 2
    for _ in range(100):
        c.record(False)
    assert c.stage == 2
    assert c.config()['groups']['smooth'] == 0.5


def test_target_observation():
    rc = make()
    o = rc.target_observation(state(0, limbs()), n=3)
    assert o.shape == (3 * 14,)


if __name__ == '__main__':
    fails = 0
    tests = [(k, v) for k, v in list(globals().items()) if k.startswith('test_')]
    for name, fn in tests:
        try:
            fn()
            print('ok  ', name)
        except Exception as e:  # noqa: BLE001
            fails += 1
            import traceback
            print('FAIL', name)
            traceback.print_exc()
    print(f'{len(tests) - fails}/{len(tests)} 통과')
    sys.exit(1 if fails else 0)
