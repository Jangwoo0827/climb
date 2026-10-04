"""5. 자연스러움(R_style) — AMP 판별기 보상

판별기 자체(모션캡처 데이터, gradient penalty 학습)는 학습 루프 쪽 몫이다.
여기서는 환경/학습기가 계산한 D(s, s')를 받아 보상으로 바꾼다. D가 없으면 0.
"""
from .base import term


def amp_reward(d: float) -> float:
    """r = max(0, 1 - 0.25·(D - 1)²) — 최소제곱 판별기(진짜 +1, 가짜 -1) 기준"""
    return max(0.0, 1.0 - 0.25 * (d - 1.0) ** 2)


@term('style')
def amp_style(ctx):
    return 0.0 if ctx.amp_d is None else amp_reward(ctx.amp_d)
