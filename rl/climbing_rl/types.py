"""보상 계산에 쓰는 자료구조. 시뮬레이터(MuJoCo/Isaac 등)와 무관하게, 환경이 매 스텝 이 형태로 상태를 채워 넘긴다.

좌표계: 벽면 = x(오른쪽)-y(위쪽) 평면, z = 벽에서 바깥쪽 거리. 단위는 m, s, rad, N, N·m.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional, Sequence, Tuple

import numpy as np

LIMBS = ('lh', 'rh', 'lf', 'rf')  # 왼손, 오른손, 왼발, 오른발
HANDS = ('lh', 'rh')
FEET = ('lf', 'rf')


def vec(v) -> np.ndarray:
    return np.asarray(v, dtype=float)


@dataclass
class Hold:
    """홀드 메타데이터(명세 6-1)"""
    id: str
    position: np.ndarray
    type: str = 'jug'  # jug / crimp / sloper / pinch / pocket / sidepull / undercling / volume
    grip_direction: np.ndarray = field(default_factory=lambda: vec([0, -1, 0]))  # 손이 당기는 힘의 유효 방향(단위 벡터)
    friction: float = 1.0
    size: float = 0.1
    is_start: bool = False
    is_top: bool = False
    allowed_limbs: Tuple[str, ...] = LIMBS

    def __post_init__(self):
        self.position = vec(self.position)
        g = vec(self.grip_direction)
        n = np.linalg.norm(g)
        self.grip_direction = g / n if n > 0 else g


@dataclass
class LimbState:
    """손/발 끝단 상태"""
    pos: np.ndarray
    hold: Optional[str] = None  # 접촉 중인 홀드 id (없으면 None)
    wall_contact: bool = False  # 홀드가 아닌 벽면 접촉(발 스미어 등)
    load: float = 0.0  # 이 끝단이 지지하는 하중(N)
    force_dir: Optional[np.ndarray] = None  # 손이 홀드에 가하는 힘 방향
    tangent_vel: np.ndarray = field(default_factory=lambda: np.zeros(3))  # 접촉 중 홀드 대비 접선 속도
    impact: float = 0.0  # 이번 스텝 접촉 순간 충격력(N)
    contact_region: Optional[str] = None  # 발: 'toe' / 'mid' / 'heel'
    grip_force: float = 0.0  # 손: 실제 악력
    grip_required: float = 0.0  # 손: 하중으로 계산한 필요 악력

    def __post_init__(self):
        self.pos = vec(self.pos)
        self.tangent_vel = vec(self.tangent_vel)
        if self.force_dir is not None:
            self.force_dir = vec(self.force_dir)

    @property
    def in_contact(self) -> bool:
        return self.hold is not None or self.wall_contact


@dataclass
class JointState:
    """관절 하나(1자유도). q는 관절 한계표의 기준(굴곡 +, 0 = 곧게 편 상태)을 따른다."""
    q: float
    qd: float = 0.0
    qdd: float = 0.0
    tau: float = 0.0
    prev_qdd: float = 0.0


@dataclass
class StepState:
    """한 스텝의 전체 상태"""
    t: float
    dt: float
    pelvis_pos: np.ndarray
    com: np.ndarray
    limbs: Dict[str, LimbState]
    joints: Dict[str, JointState] = field(default_factory=dict)
    pelvis_ang_vel: np.ndarray = field(default_factory=lambda: np.zeros(3))
    action: Optional[np.ndarray] = None
    prev_action: Optional[np.ndarray] = None
    muscle_act: Optional[np.ndarray] = None  # 근골격 모델 사용 시 근육 활성도
    shoulder_elevation: float = 0.0  # 견갑 거상 정도 0~1 (어깨가 귀 쪽으로 올라감)
    head_pos: Optional[np.ndarray] = None
    head_forward: Optional[np.ndarray] = None
    illegal_load: Dict[str, float] = field(default_factory=dict)  # 손발 외 부위(무릎, 정강이, 몸통, 머리)가 지지하는 하중
    self_collisions: int = 0
    ground_contact: bool = False
    body_weight: float = 700.0  # N

    def __post_init__(self):
        self.pelvis_pos = vec(self.pelvis_pos)
        self.com = vec(self.com)
        self.pelvis_ang_vel = vec(self.pelvis_ang_vel)

    @property
    def contacts(self) -> Dict[str, LimbState]:
        return {k: v for k, v in self.limbs.items() if v.in_contact}

    @property
    def airborne(self) -> bool:
        return not any(v.in_contact for v in self.limbs.values())


@dataclass
class RouteStep:
    """루트의 다음 목표: 어느 손/발을 어느 홀드로"""
    limb: str
    hold: str


def route_from(seq: Sequence[Tuple[str, str]]):
    return [RouteStep(l, h) for l, h in seq]
