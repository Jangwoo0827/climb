"""항목별 스텝 로깅(CSV) + 어떤 항목이 보상을 지배하는지 요약. tensorboard/wandb가 있으면 log 딕셔너리를 그대로 넘기면 된다."""
import csv
from collections import defaultdict
from typing import Dict


class RewardLogger:
    def __init__(self, path: str = None):
        self.path = path
        self._f = None
        self._w = None
        self.abs_sum: Dict[str, float] = defaultdict(float)
        self.sum: Dict[str, float] = defaultdict(float)
        self.steps = 0

    def log(self, episode: int, step: int, log: Dict[str, float]):
        row = {'episode': episode, 'step': step, **log}
        if self.path:
            if self._w is None:
                self._f = open(self.path, 'w', newline='', encoding='utf-8')
                self._w = csv.DictWriter(self._f, fieldnames=list(row.keys()), extrasaction='ignore')
                self._w.writeheader()
            self._w.writerow(row)
        for k, v in log.items():
            if k in ('reward', 'target_idx', 'mult_factor') or k.startswith('group/'):
                continue
            self.abs_sum[k] += abs(v)
            self.sum[k] += v
        self.steps += 1

    def dominance(self, top: int = 10):
        """|기여| 비중이 큰 항목 순서: [(항목, 비중, 누적 합)]"""
        total = sum(self.abs_sum.values()) or 1.0
        items = sorted(self.abs_sum.items(), key=lambda kv: -kv[1])[:top]
        return [(k, v / total, self.sum[k]) for k, v in items]

    def close(self):
        if self._f:
            self._f.close()
