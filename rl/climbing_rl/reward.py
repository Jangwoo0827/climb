"""보상 계산기: 항목 함수 + config 가중치 + 에피소드 상태 추적(홀드별 1회 보너스, 정체, 종료 조건).

사용(환경 쪽):
    rc = RewardComputer(load_config(stage=1), holds, route)
    rc.reset(state0)
    for ...:
        res = rc.step(state, amp_d=D)   # res.reward, res.terminated, res.truncated, res.log
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence

import numpy as np

from .fatigue import FatigueModel, part_loads
from .limits import limit
from .rewards import GROUPS, REGISTRY
from .rewards.contact import illegal_load
from .rewards.joint import rom_fraction
from .types import FEET, HANDS, Hold, RouteStep, StepState

HOLD_TYPES = ('jug', 'crimp', 'sloper', 'pinch', 'pocket', 'sidepull', 'undercling', 'volume')


@dataclass
class StepResult:
    reward: float
    terminated: bool  # 진짜 끝(완등/추락/반칙) → 부트스트랩 안 함
    truncated: bool  # 시간 초과 → 부트스트랩 유지
    reason: Optional[str]
    log: Dict[str, float]  # 항목별 가중 기여, 그룹 합, 종료 페널티, 총합


@dataclass
class Episode:
    target_idx: int = 0
    timers: Dict[str, float] = field(default_factory=dict)  # 손발별 같은 홀드 안정 접촉 시간
    rewarded_hand: set = field(default_factory=set)
    rewarded_foot: set = field(default_factory=set)
    best: tuple = (0, -np.inf)
    last_progress_t: float = 0.0
    left_ground: bool = False
    takeoff_height: Optional[float] = None
    illegal_time: float = 0.0
    violation_steps: int = 0
    done: bool = False


class Ctx:
    """항목 함수가 보는 정보 묶음"""

    def __init__(self, rc: 'RewardComputer', prev, cur, target, events, phi_prev, phi_cur, amp_d):
        self.prev, self.cur = prev, cur
        self.holds = rc.holds
        self.p = rc.cfg['params']
        self.fatigue = rc.fatigue
        self.wall_distance = rc.wall_distance
        self.target = target
        self.target_hold = rc.holds[target.hold] if target else None
        self.events = events
        self.phi_prev, self.phi_cur = phi_prev, phi_cur
        self.amp_d = amp_d


class RewardComputer:
    def __init__(self, cfg: dict, holds: Sequence[Hold], route: Sequence[RouteStep],
                 wall_distance: Callable[[np.ndarray], float] = None,
                 static_reachable: Callable[[StepState, Hold], bool] = None):
        self.cfg = cfg
        self.holds: Dict[str, Hold] = {h.id: h for h in holds}
        self.route: List[RouteStep] = list(route)
        for s in self.route:
            assert s.hold in self.holds, f'루트에 없는 홀드 {s.hold}'
            assert s.limb in self.holds[s.hold].allowed_limbs, f'{s.limb}는 {s.hold}를 쓸 수 없음'
        # 기본 벽: z = 0 평면(오버행 등은 환경이 함수로 넘긴다)
        self.wall_distance = wall_distance or (lambda p: float(p[2]))
        self.static_reachable = static_reachable
        self.fatigue = FatigueModel(enabled=bool(cfg.get('fatigue', False)))
        self.route_hand_holds = {s.hold for s in self.route if s.limb in HANDS}
        self.prev: Optional[StepState] = None
        self.ep = Episode()

    # ---------- 에피소드 ----------
    def reset(self, state: StepState):
        self.ep = Episode(last_progress_t=state.t)
        self.fatigue.reset()
        for k, l in state.limbs.items():
            self.ep.timers[k] = 0.0
            # 시작부터 잡고 있는 홀드는 보너스 대상이 아님
            if l.hold is not None:
                (self.ep.rewarded_hand if k in HANDS else self.ep.rewarded_foot).add(l.hold)
        self.ep.left_ground = not state.ground_contact
        phi = self.phi(state, self.target)
        self.ep.best = (0, phi if phi is not None else 0.0)
        self.prev = state

    @property
    def target(self) -> Optional[RouteStep]:
        i = self.ep.target_idx
        return self.route[i] if i < len(self.route) else None

    def phi(self, state: StepState, target: Optional[RouteStep]) -> Optional[float]:
        if target is None:
            return None
        return -float(np.linalg.norm(state.limbs[target.limb].pos - self.holds[target.hold].position))

    def fatigue_observation(self):
        return self.fatigue.observation()

    def target_observation(self, state: StepState, n: int = 3) -> np.ndarray:
        """다음 n개 목표 홀드: 골반 기준 상대 위치(3) + 타입 원핫(8) + 그립 방향(3). 모자라면 0"""
        out = []
        for i in range(self.ep.target_idx, self.ep.target_idx + n):
            if i < len(self.route):
                h = self.holds[self.route[i].hold]
                onehot = [1.0 if h.type == t else 0.0 for t in HOLD_TYPES]
                out += list(h.position - state.pelvis_pos) + onehot + list(h.grip_direction)
            else:
                out += [0.0] * (3 + len(HOLD_TYPES) + 3)
        return np.array(out)

    # ---------- 상태 추적 ----------
    def _update_timers(self, prev: StepState, cur: StepState):
        v_max = self.cfg['params']['stable_slip_speed']
        for k, l in cur.limbs.items():
            same = l.hold is not None and prev.limbs[k].hold == l.hold
            stable = np.linalg.norm(l.tangent_vel) <= v_max
            self.ep.timers[k] = self.ep.timers.get(k, 0.0) + cur.dt if (same and stable) else 0.0

    def _held(self, cur: StepState, limb: str, hold: str) -> bool:
        """limb이 hold를 '확보'했나: 손 = T_hold 안정 접촉, 발 = 거기에 더해 체중의 일정 비율 하중"""
        l = cur.limbs[limb]
        if l.hold != hold or self.ep.timers.get(limb, 0.0) < self.cfg['params']['t_hold']:
            return False
        if limb in FEET:
            return l.load >= self.cfg['params']['foot_load_ratio'] * cur.body_weight
        return True

    def _events(self, prev: StepState, cur: StepState) -> dict:
        p, ep = self.cfg['params'], self.ep
        ev = {'hand_reached': [], 'foot_secured': [], 'top': False, 'stagnating': False, 'unnecessary_dyno': False}
        for k in HANDS:
            h = cur.limbs[k].hold
            if h in self.route_hand_holds and h not in ep.rewarded_hand and self._held(cur, k, h):
                ep.rewarded_hand.add(h)
                ev['hand_reached'].append(h)
        for k in FEET:
            h = cur.limbs[k].hold
            if h is not None and h not in ep.rewarded_foot and self._held(cur, k, h):
                ep.rewarded_foot.add(h)
                ev['foot_secured'].append(h)
        ev['top'] = all(cur.limbs[k].hold is not None and self.holds[cur.limbs[k].hold].is_top and self._held(cur, k, cur.limbs[k].hold) for k in HANDS)

        # 정적으로 닿는데 전부 놓고 뜸 → 쓸데없는 다이노(이륙 순간 1회)
        tgt = self.target
        if tgt is not None and not prev.airborne and cur.airborne:
            hold = self.holds[tgt.hold]
            if p.get('precise_dyno') and self.static_reachable is not None:
                reach = self.static_reachable(prev, hold)
            else:
                reach = np.linalg.norm(hold.position - prev.pelvis_pos) <= p['static_reach']
            ev['unnecessary_dyno'] = bool(reach)
        return ev

    def _advance(self, cur: StepState):
        """현재 목표 이후 루트 단계 중 이미 확보된 가장 뒤 단계 다음으로(홀드 건너뛰기 허용)"""
        for j in range(len(self.route) - 1, self.ep.target_idx - 1, -1):
            s = self.route[j]
            if self._held(cur, s.limb, s.hold):
                self.ep.target_idx = j + 1
                return

    def _stagnation(self, cur: StepState) -> bool:
        p, ep = self.cfg['params'], self.ep
        phi = self.phi(cur, self.target)
        score = (ep.target_idx, phi if phi is not None else 0.0)
        if score[0] > ep.best[0] or score[1] > ep.best[1] + p['stagnation_eps']:
            ep.best = score
            ep.last_progress_t = cur.t
        return cur.t - ep.last_progress_t >= p['stagnation_time'] - 1e-9

    def _termination(self, cur: StepState, ev) -> tuple:
        tc, ep = self.cfg['termination'], self.ep
        if not cur.ground_contact:
            ep.left_ground = True
        # 추락 높이 기준: 공중에 뜬 순간의 골반 높이
        if cur.airborne:
            if ep.takeoff_height is None:
                ep.takeoff_height = float(self.prev.pelvis_pos[1])
        else:
            ep.takeoff_height = None
        ep.illegal_time = ep.illegal_time + cur.dt if illegal_load(cur, self.cfg['params']) > self.cfg['params']['illegal_min_load'] else 0.0
        over = any(
            rom_fraction(j.q, *limit(n)[:2]) > 1.0
            for n, j in cur.joints.items() if limit(n) is not None
        )
        ep.violation_steps = ep.violation_steps + 1 if over else 0

        if ev['top']:
            return 0.0, True, False, 'top'
        if (ep.left_ground and cur.ground_contact) or (
                ep.takeoff_height is not None and ep.takeoff_height - cur.pelvis_pos[1] > tc['fall_drop']):
            return tc['fall'], True, False, 'fall'
        if ep.illegal_time >= tc['illegal_time']:
            return tc['illegal_contact'], True, False, 'illegal_contact'
        if ep.violation_steps >= tc['joint_violation_steps']:
            return tc['joint_violation'], True, False, 'joint_violation'
        if cur.t >= tc['max_time']:
            return tc['timeout'], False, True, 'timeout'
        return 0.0, False, False, None

    # ---------- 한 스텝 ----------
    def step(self, cur: StepState, amp_d: float = None) -> StepResult:
        assert self.prev is not None, 'reset() 먼저'
        assert not self.ep.done, '끝난 에피소드'
        prev = self.prev
        self.fatigue.step(part_loads(cur), cur.dt)
        self._update_timers(prev, cur)

        target = self.target  # 이번 스텝 시작 시점의 목표(포텐셜은 같은 목표로 두 상태 비교)
        phi_prev, phi_cur = self.phi(prev, target), self.phi(cur, target)
        ev = self._events(prev, cur)
        self._advance(cur)
        ev['stagnating'] = self._stagnation(cur)

        ctx = Ctx(self, prev, cur, target, ev, phi_prev, phi_cur, amp_d)
        gw, tw = self.cfg['groups'], self.cfg['terms']
        log: Dict[str, float] = {}
        group_sum = {g: 0.0 for g in GROUPS}
        # 정체 중에는 과제 외 항목의 양수 보상(자세 좋음 등)을 막는다: 안 그러면 매 스텝 들어오는
        # 안정성/효율 보너스가 '생존 보상'이 되어 한 자세로 버티는 게 오르는 것보다 이득이 된다(명세 10장)
        gate = ev['stagnating'] and self.cfg['params'].get('stagnation_gates_shaping', True)
        for name, (g, fn) in REGISTRY.items():
            w = tw.get(name, 0.0) * gw.get(g, 0.0)
            v = w * fn(ctx) if w != 0.0 else 0.0
            if gate and g != 'task' and v > 0:
                v = 0.0
            log[name] = v
            group_sum[g] += v

        if self.cfg.get('mode', 'additive') == 'multiplicative':
            base = group_sum['task'] + group_sum['style']
            ks = self.cfg['multiplicative']['k']
            factor = float(np.prod([np.exp(-ks[g] * max(0.0, -group_sum[g])) for g in ks]))
            # 음수(시간 페널티 등)에 곱하면 나쁜 행동이 오히려 페널티를 줄이므로 양수부에만 곱한다
            reward = max(0.0, base) * factor + min(0.0, base)
            log['mult_factor'] = factor
        else:
            reward = sum(group_sum.values())

        pen, terminated, truncated, reason = self._termination(cur, ev)
        reward += pen
        for g in GROUPS:
            log['group/' + g] = group_sum[g]
        log['termination'] = pen
        log['reward'] = reward
        log['target_idx'] = self.ep.target_idx
        self.ep.done = terminated or truncated
        self.prev = cur
        return StepResult(reward, terminated, truncated, reason, log)
