"""커리큘럼: 최근 window 에피소드 완등률이 기준 이상이면 다음 단계"""
from collections import deque

from .config import apply_stage


class Curriculum:
    def __init__(self, cfg: dict, stage: int = 1):
        self.base = cfg
        self.stage = stage
        c = cfg['curriculum']
        self.window, self.rate = c['window'], c['advance_success_rate']
        self.hist = deque(maxlen=self.window)
        self.max_stage = max(int(s) for s in cfg['stages'])

    def config(self) -> dict:
        return apply_stage(self.base, self.stage)

    def record(self, success: bool) -> bool:
        """에피소드 결과 기록. 단계가 올라가면 True"""
        self.hist.append(bool(success))
        if self.stage < self.max_stage and len(self.hist) == self.window and sum(self.hist) / self.window >= self.rate:
            self.stage += 1
            self.hist.clear()
            return True
        return False
