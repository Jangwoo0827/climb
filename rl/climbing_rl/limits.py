"""관절별 인간 한계표(명세 4-3, 성인 평균값 — 튜닝 필요).

관절 이름은 좌우 접두사 없이 적고(예: 'elbow_flexion'), 상태에서는 'l_' / 'r_' 를 붙여 쓴다.
각도 기준: 0 = 해부학적 기본자세(곧게 편 상태), 굴곡이 +. 음수 범위는 반대 방향(신전 등).
"""
import math

DEG = math.pi / 180

# 이름: (최소 각도°, 최대 각도°, 최대 각속도 rad/s, 최대 토크 N·m, 과신전 검사 여부)
JOINT_LIMITS = {
    'shoulder_flexion': (-60, 180, 15.0, 80.0, False),  # 신전 0~60, 굴곡 0~180
    'shoulder_abduction': (0, 180, 15.0, 70.0, False),
    'elbow_flexion': (0, 145, 20.0, 70.0, True),  # 과신전 금지
    'wrist_flexion': (-70, 80, 25.0, 20.0, True),  # 신전 0~70, 굴곡 0~80
    'finger_flexion': (0, 90, 20.0, 15.0, False),  # 손가락은 약함
    'hip_flexion': (-20, 120, 12.0, 200.0, False),
    'hip_abduction': (0, 45, 10.0, 150.0, False),
    'hip_external_rotation': (0, 45, 10.0, 80.0, False),
    'knee_flexion': (0, 140, 15.0, 250.0, True),  # 과신전 금지, 다리는 강함
    'ankle_dorsiflexion': (-50, 20, 15.0, 150.0, False),  # 저측굴곡 0~50(음수), 배측굴곡 0~20
}


def base_name(joint: str) -> str:
    for p in ('l_', 'r_'):
        if joint.startswith(p):
            return joint[len(p):]
    return joint


def limit(joint: str):
    """(최소 rad, 최대 rad, 최대 각속도, 최대 토크, 과신전 검사) — 표에 없으면 None"""
    v = JOINT_LIMITS.get(base_name(joint))
    if v is None:
        return None
    lo, hi, qd_max, tau_max, hyper = v
    return lo * DEG, hi * DEG, qd_max, tau_max, hyper


def clip_torque(joint: str, tau: float, fatigue_scale: float = 1.0) -> float:
    """인간 기준 최대 토크(피로 반영)로 하드 클리핑. 환경이 액션을 토크로 바꿀 때 사용"""
    lim = limit(joint)
    if lim is None:
        return tau
    t_max = lim[3] * max(0.0, fatigue_scale)
    return max(-t_max, min(t_max, tau))
