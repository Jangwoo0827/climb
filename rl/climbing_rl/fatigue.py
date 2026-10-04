"""누적 피로 모델(명세 4-1). 보상이 아니라 다이내믹스: 부위별 최대 토크를 줄이고, 관측에 들어간다.

F += alpha * load * dt  (load = 체중 대비 하중 0~1)
F -= beta * dt          (하중이 rest_threshold 미만이면 휴식)
최대 토크 = tau_max * (1 - F)
"""
from dataclasses import dataclass, field
from typing import Dict

import numpy as np

PARTS = ('fingers', 'forearm', 'shoulder', 'legs')
# 관절이 어느 부위의 피로를 따르는지
JOINT_PART = {
    'finger_flexion': 'fingers',
    'wrist_flexion': 'forearm',
    'elbow_flexion': 'forearm',
    'shoulder_flexion': 'shoulder',
    'shoulder_abduction': 'shoulder',
    'hip_flexion': 'legs',
    'hip_abduction': 'legs',
    'hip_external_rotation': 'legs',
    'knee_flexion': 'legs',
    'ankle_dorsiflexion': 'legs',
}


@dataclass
class FatigueModel:
    alpha: Dict[str, float] = field(default_factory=lambda: {'fingers': 0.06, 'forearm': 0.05, 'shoulder': 0.03, 'legs': 0.01})
    beta: Dict[str, float] = field(default_factory=lambda: {'fingers': 0.02, 'forearm': 0.02, 'shoulder': 0.03, 'legs': 0.05})
    rest_threshold: float = 0.05
    max_fatigue: float = 0.9  # 완전히 힘이 빠지지는 않게
    F: Dict[str, float] = field(default_factory=lambda: {p: 0.0 for p in PARTS})
    enabled: bool = True

    def reset(self):
        self.F = {p: 0.0 for p in PARTS}

    def step(self, loads: Dict[str, float], dt: float):
        """loads: 부위별 체중 대비 하중(0~1)"""
        if not self.enabled:
            return
        for p in PARTS:
            load = max(0.0, loads.get(p, 0.0))
            if load < self.rest_threshold:
                self.F[p] -= self.beta[p] * dt
            else:
                self.F[p] += self.alpha[p] * load * dt
            self.F[p] = min(self.max_fatigue, max(0.0, self.F[p]))

    def torque_scale(self, joint_base: str) -> float:
        """관절의 최대 토크 배율(1 - F)"""
        if not self.enabled:
            return 1.0
        return 1.0 - self.F.get(JOINT_PART.get(joint_base, ''), 0.0)

    def observation(self) -> np.ndarray:
        return np.array([self.F[p] for p in PARTS])


def part_loads(state) -> Dict[str, float]:
    """스텝 상태로 부위별 하중 비율을 어림: 손 하중은 손가락·전완·어깨, 발 하중은 다리"""
    w = max(1e-6, state.body_weight)
    hand = sum(state.limbs[k].load for k in ('lh', 'rh') if k in state.limbs) / w
    foot = sum(state.limbs[k].load for k in ('lf', 'rf') if k in state.limbs) / w
    return {'fingers': hand, 'forearm': hand, 'shoulder': hand, 'legs': foot}
