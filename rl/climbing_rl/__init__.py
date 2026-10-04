"""클라이밍 강화학습 보상 모듈(시뮬레이터 독립). 명세: rl/README.md"""
from .config import apply_stage, load_config
from .curriculum import Curriculum
from .fatigue import FatigueModel
from .limits import JOINT_LIMITS, clip_torque
from .logger import RewardLogger
from .reward import RewardComputer, StepResult
from .types import Hold, JointState, LimbState, RouteStep, StepState, route_from

__all__ = [
    'apply_stage', 'load_config', 'Curriculum', 'FatigueModel', 'JOINT_LIMITS', 'clip_torque', 'RewardLogger',
    'RewardComputer', 'StepResult', 'Hold', 'JointState', 'LimbState', 'RouteStep', 'StepState', 'route_from',
]
