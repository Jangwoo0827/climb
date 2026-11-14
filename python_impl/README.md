# 클라이밍 도우미 · 파이썬 직접 구현

앱의 핵심 로직을 JavaScript에서 파이썬으로 직접 다시 구현하는 연습 폴더입니다.
`route.py`와 `reward.py`의 `raise NotImplementedError` 부분을 채우고, 테스트를 통과시키면 됩니다.

## 시작

```bash
pip install pytest
cd python_impl
python -m pytest tests -v
```

처음에는 전부 실패(NotImplementedError)하는 게 정상입니다. 아래 순서로 하나씩 초록색으로 바꾸세요.

## 순서

| 단계 | 파일 | 만들 것 | 이 단계에서 배우는 것 |
|---|---|---|---|
| 1 | `route.py` | `body_model`, `dist` | 키·팔 길이로 닿는 거리 계산 |
| 2 | `route.py` | `step_cost` | 동작 하나의 비용 설계, 점프 판정 |
| 3 | `route.py` | `find_route` | 다익스트라(heapq), 상태 = (왼손, 오른손) |
| 4 | `reward.py` | `d2`, `flexion`, `rom_barrier` | 코사인 법칙, 관절 한계 |
| 5 | `reward.py` | `hull`, `seg_dist`, `dist_to_polygon` | 볼록 껍질, 점과 다각형 거리 |
| 6 | `reward.py` | `com_support`, `weighted_total` | 무게중심 안정, 가중치 합 |

한 단계의 테스트만 돌리려면:

```bash
python -m pytest tests/test_route.py -k "body_model or dist" -v
python -m pytest tests/test_route.py -k "cost or dyno" -v
python -m pytest tests/test_route.py -k "route" -v
```

## 막힐 때

1. 함수 위 docstring의 순서를 따라 하나씩 구현합니다. 수식이 거의 다 적혀 있습니다.
2. 그래도 모르겠으면 JavaScript 원본을 읽습니다: `../src/utils/route.js`, `../src/utils/reward.js`
3. 테스트가 왜 실패하는지 모르겠으면 에러 메시지를 저에게 붙여 주세요. 정답 대신 힌트를 드립니다.

## 면접에서 설명할 수 있어야 하는 것

- 왜 상태가 (왼손, 오른손)인가, 왜 다익스트라인가
- 거리가 멀수록 비용이 제곱으로 커지는 이유
- 점프는 왜 기본 비용 30으로 비싼가
- 코사인 법칙으로 팔꿈치 각도를 어떻게 구하는가
- 무게중심이 다각형 안에 있을 때 1이 되는 이유

이 파일들을 직접 짜 보면 위 질문에 코드 기준으로 답할 수 있습니다.
