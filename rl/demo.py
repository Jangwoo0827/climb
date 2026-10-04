"""물리 엔진 없이 손으로 짠 상태 시퀀스 3개를 채점해 보는 데모.

- good:   발에 체중 싣고 팔 편 채로 한 손씩 이동 → 완등
- arms:   발 안 쓰고 팔만으로(팔 굽힘, 어깨 으쓱) 이동 → 완등
- hacker: 목표 홀드 근처에서 손을 왕복하며 버티기 → 시간 초과

실행: python demo.py   (로그: demo_log_<이름>.csv)
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from climbing_rl import Hold, JointState, LimbState, RewardComputer, RewardLogger, StepState, load_config, route_from  # noqa: E402

DT, BW = 0.05, 700.0
HOLDS = [
    Hold('S1', [-0.2, 1.9, 0], is_start=True), Hold('S2', [0.2, 1.9, 0], is_start=True),
    Hold('A', [-0.25, 2.3, 0]), Hold('B', [0.25, 2.6, 0]), Hold('T', [0.0, 2.9, 0], is_top=True),
    Hold('F1', [-0.2, 0.6, 0]), Hold('F2', [0.2, 0.6, 0]), Hold('F3', [-0.2, 1.0, 0]), Hold('F4', [0.2, 1.3, 0]),
]
H = {h.id: h for h in HOLDS}
ROUTE = route_from([('lh', 'A'), ('rh', 'B'), ('lh', 'T'), ('rh', 'T')])


def lerp(a, b, s):
    return np.asarray(a, float) + (np.asarray(b, float) - np.asarray(a, float)) * s


def scripted(kind):
    """(손발 홀드/위치, 골반, 관절, 하중) 키프레임 사이를 보간해 StepState 목록 생성"""
    if kind == 'hacker':
        out, t = [], 0.0
        for i in range(400):
            t += DT
            p = H['A'].position + ([0, -0.05, 0.05] if (i // 3) % 2 == 0 else [0, -0.25, 0.1])
            ls = {'lh': LimbState(p), 'rh': LimbState(H['S2'].position, 'S2', load=300),
                  'lf': LimbState(H['F1'].position, 'F1', load=200, contact_region='mid'),
                  'rf': LimbState(H['F2'].position, 'F2', load=200, contact_region='mid')}
            out.append(StepState(t, DT, [0, 1.2, 0.4], [0, 1.2, 0.4], ls, body_weight=BW, shoulder_elevation=0.6,
                                 joints={'l_elbow_flexion': JointState(1.6), 'r_elbow_flexion': JointState(1.6)}))
        return out

    legs = kind == 'good'
    # 각 단계: (lh, rh, lf, rf, 골반 y)
    if legs:
        keys = [('S1', 'S2', 'F1', 'F2', 1.15), ('S1', 'S2', 'F3', 'F2', 1.3), ('A', 'S2', 'F3', 'F2', 1.35),
                ('A', 'S2', 'F3', 'F4', 1.55), ('A', 'B', 'F3', 'F4', 1.6), ('T', 'B', 'F3', 'F4', 1.75), ('T', 'T', 'F3', 'F4', 1.8)]
    else:
        keys = [('S1', 'S2', 'F1', 'F2', 1.15), ('A', 'S2', None, None, 1.35), ('A', 'B', None, None, 1.6),
                ('T', 'B', None, None, 1.75), ('T', 'T', None, None, 1.8)]
    keys.append(keys[-1])  # 마지막 자세를 T_hold 이상 유지
    out, t = [], 0.0
    prev_qdd = 0.0
    for a, b in zip(keys, keys[1:]):
        moving = [k for k, i in zip(('lh', 'rh', 'lf', 'rf'), range(4)) if a[i] != b[i]]
        for f in range(16):
            s = (f + 1) / 16
            t += DT
            ls = {}
            for i, k in enumerate(('lh', 'rh', 'lf', 'rf')):
                if k in moving and s < 0.75:  # 이동 중인 손발은 공중
                    src = H[a[i]].position if a[i] else H['F1'].position + [0, 0, 0.3]
                    dst = H[b[i]].position if b[i] else src
                    ls[k] = LimbState(lerp(src, dst, s / 0.75) + [0, 0, 0.05])
                else:
                    hid = b[i] if k in moving else a[i]
                    if hid is None:
                        ls[k] = LimbState(lerp(H['F1'].position, H['F2'].position, 0.5) + [0, 0.3, 0.3])
                        continue
                    is_foot = k in ('lf', 'rf')
                    load = (230 if legs else 0) if is_foot else (120 if legs else 350)
                    ls[k] = LimbState(H[hid].position, hid, load=load, contact_region='toe' if is_foot else None,
                                      force_dir=[0, -1, 0] if not is_foot else None)
            y = lerp(a[4], b[4], s)[()]
            elbow = 0.3 if legs else 1.5
            qdd = (8.0 if legs else 25.0) * np.sin(s * np.pi * 2)
            joints = {f'{sd}_elbow_flexion': JointState(elbow, qd=0.5, qdd=qdd, prev_qdd=prev_qdd, tau=20 if legs else 55)
                      for sd in 'lr'}
            joints.update({f'{sd}_knee_flexion': JointState(1.2 if legs else 0.2, tau=80 if legs else 5) for sd in 'lr'})
            prev_qdd = qdd
            pel = [0, y, 0.22 if legs else 0.45]
            out.append(StepState(t, DT, pel, pel, ls, joints=joints, body_weight=BW, shoulder_elevation=0.1 if legs else 0.7,
                                 head_pos=[0, y + 0.6, 0.3], head_forward=[0, 0.5, -1]))
    return out


def run(kind, stage=3):
    seq = scripted(kind)
    rc = RewardComputer(load_config(stage=stage), HOLDS, ROUTE)
    rc.reset(seq[0])
    lg = RewardLogger(os.path.join(os.path.dirname(os.path.abspath(__file__)), f'demo_log_{kind}.csv'))
    total, res = 0.0, None
    for i, s in enumerate(seq[1:]):
        res = rc.step(s)
        lg.log(0, i, res.log)
        total += res.reward
        if res.terminated or res.truncated:
            break
    lg.close()
    print(f'\n[{kind}] 총 보상 {total:8.2f}  종료: {res.reason}  스텝 {i + 1}  목표 진행 {rc.ep.target_idx}/{len(ROUTE)}')
    for k, share, s in lg.dominance(6):
        print(f'   {k:18s} 비중 {share:5.1%}  합 {s:8.2f}')
    return total


if __name__ == '__main__':
    r = {k: run(k) for k in ('good', 'arms', 'hacker')}
    assert r['good'] > r['arms'] > r['hacker'], r
    print('\n순위 good > arms > hacker  ✓')
