# 홀드 분류 실험 비교

테스트: dataset/holds_public/test (capstone 55, extra 7, holdclassificatore 1,258) — 출처별·원본 사진 단위 분할, 누수 0

| 실험 | 학습 데이터 | 실제 사진(capstone) 정확도 | macro F1 | 공개 데이터 정확도 |
|---|---|---|---|---|
| experiment_002 | A: 기존만(종류별 ≤60) | 69.1% | 0.68 | 23.0% |
| experiment_003 | B: 기존+HoldClassificatore(종류별 ≤400) | 58.2% | 0.59 | 66.9% |

- experiment_000/001은 예전 분할(누수 있음)로 학습한 모델이라 비교에서 제외
- 결론: 공개 데이터(합성 배경 제품 사진)를 섞으면 공개 데이터 점수는 오르지만 실제 벽 사진 점수는 떨어짐(p=0.24, 표본 55장)
