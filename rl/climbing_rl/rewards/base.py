"""보상 항목 등록부. 항목마다 독립 함수 f(ctx) -> float 이고, 가중치는 config에서 곱한다.

반환값은 명세 표의 '수식'을 그대로 따른다. 예) torque_sq 는 -Στ² 를 반환하고 가중치 +0.001,
slip 은 Σv² 를 반환하고 가중치 -0.5. 그래서 config의 가중치 부호도 명세 표와 같다.
"""
from typing import Callable, Dict, Tuple

GROUPS = ('task', 'style', 'efficiency', 'stability', 'joint', 'smooth', 'contact')
REGISTRY: Dict[str, Tuple[str, Callable]] = {}


def term(group: str):
    assert group in GROUPS, group

    def deco(fn):
        REGISTRY[fn.__name__] = (group, fn)
        return fn

    return deco
