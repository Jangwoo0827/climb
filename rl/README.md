# 클라이밍 강화학습 보상 모듈 (`rl/`)

「클라이밍 AI 보상 함수 설계 명세」를 **시뮬레이터와 상관없이** 구현한 부분이에요.
MuJoCo / Isaac Lab / MyoSuite 환경을 나중에 붙일 때, 환경이 매 스텝 `StepState`를 채워
`RewardComputer.step()`에 넘기면 보상, 종료 여부, 항목별 로그가 나와요.

> PPO+AMP 실제 학습은 GPU와 물리 엔진이 필요해서 여기서는 하지 않았어요. 이 폴더는 학습 루프에 꽂을 **보상·종료·피로·커리큘럼** 부분이에요.

## 실행

```bash
python tests/test_rewards.py   # 23개 검사 (pytest 없이 실행)
python demo.py                 # 손으로 짠 동작 3개 채점: good > arms > hacker
```

numpy만 있으면 돼요. config는 JSON이라 PyYAML도 필요 없어요.

## 구조

| 파일 | 내용 | 명세 |
|---|---|---|
| `config/rewards.json` | 항목 가중치, 그룹 가중치, 파라미터, 종료 페널티, 단계별 override | 0, 8장 |
| `climbing_rl/rewards/task.py` | progress(포텐셜), height_gain, 홀드 보너스, 완등, 시간, 정체 | 1장 |
| `climbing_rl/rewards/stability.py` | 접촉 수, COM-지지 다각형, 골반-벽 거리, barn door, 미끄러짐 | 2장 |
| `climbing_rl/rewards/efficiency.py` | 토크², 기계적 일, 근활성, 다리 하중 비율, 팔 펴고 쉬기, 과악력, 불필요한 다이노 | 3장 |
| `climbing_rl/rewards/joint.py` | ROM 지수 장벽, 과신전, 각속도·토크 한계, 어깨 으쓱, 자기 충돌 | 4장 |
| `climbing_rl/rewards/smooth.py` | action rate, 관절 가속도, jerk, 시선 | 5장 |
| `climbing_rl/rewards/style.py` | AMP 판별기 출력 D → `max(0, 1-0.25(D-1)²)` | 5장 |
| `climbing_rl/rewards/contact.py` | 비허용 부위 하중, 발끝, 그립 방향, 충격 | 6장 |
| `climbing_rl/reward.py` | `RewardComputer`: 가산형/곱셈형 결합, 홀드별 1회 보너스, 루트 진행, 정체, 종료/truncation | 0, 7, 10장 |
| `climbing_rl/types.py` | `Hold`(6-1 구조), `LimbState`, `JointState`, `StepState`, `RouteStep` | 6-1, 9장 |
| `climbing_rl/limits.py` | 관절 한계표(각도·각속도·토크), `clip_torque` | 4-3장 |
| `climbing_rl/fatigue.py` | 부위별 피로 다이내믹스, 토크 배율, 관측 | 4-1장 |
| `climbing_rl/curriculum.py` | 최근 100 에피소드 완등률 70% 이상이면 다음 단계 | 8장 |
| `climbing_rl/logger.py` | 항목별 스텝 CSV 로그, 어떤 항목이 보상을 지배하는지 요약 | 원칙 |

### 항목 함수 규칙

- 항목 하나당 함수 하나예요. `@term('그룹')`으로 등록돼요.
- 반환값은 명세 표의 **수식 그대로**예요. 그래서 config의 가중치 부호도 명세 표와 같아요. 예를 들어 `torque_sq`는 −Στ²를 반환하고 가중치는 +0.001이에요. `slip`은 Σv²를 반환하고 가중치는 −0.5예요.
- 최종 가중치는 `terms[항목] × groups[그룹]`이고, 단계 override는 그룹 가중치에 곱해져요.

### 커리큘럼 단계

| 단계 | 바뀌는 것 |
|---|---|
| 1 | efficiency·joint·smooth ×0.1, contact 0, 피로 꺼짐 |
| 2 | efficiency·smooth·joint ×0.5, contact 켜짐 |
| 3 | 전부 ×1.0, 피로 켜짐 |
| 4 | 단계 3과 같음 + `precise_dyno`(환경이 넘긴 IK 판정 함수 사용) + 도메인 랜덤화 플래그 |

명세는 단계 2의 joint 배율을 정하지 않았어요. 단계 1과 3 사이 값인 0.5로 정했어요.

## 명세와 다르게 한 부분

1. **ROM 장벽 식을 바꿨어요.** 명세의 `|q-q_mid|/q_range`는 한계에서 값이 0.5라서 0.9를 넘을 수 없어요. 그래서 반폭으로 나눴어요. 또 0.9에서 0→1로 값이 뛰지 않도록 `exp(k(x-0.9)) - 1`을 써요.
2. **곱셈형 결합은 양수 부분에만 곱해요.** 음수 보상(시간 페널티 등)에 감쇠 계수를 곱하면, 자세를 망칠수록 페널티가 줄어드는 역효과가 생겨요.
3. **정체 중에는 과제 외 양수 보상을 막아요.** 데모에서 실제로 발견된 해킹이에요. 명세의 초기 가중치를 그대로 쓰면 com_support, contact_count, leg_load_ratio처럼 매 스텝 들어오는 + 보상이 사실상 **생존 보상**이 돼요. 그래서 홀드 근처에서 버티기만 하는 hacker가 완등한 good보다 높은 점수를 받았어요(198 vs 133). 정체 판정(5초간 진행 없음) 중에는 이 + 값들을 0으로 만들어요(`stagnation_gates_shaping`). 이후 hacker는 −32점이 됐어요.
4. **루트를 건너뛰어도 진행돼요.** 뒤쪽 목표 홀드를 먼저 확보하면 목표가 그 다음 단계로 넘어가요.
5. **발 보너스에도 T_hold를 적용해요.** 발도 안정 접촉 T_hold와 하중 조건을 같이 만족해야 보너스를 줘요. 발로 진동하는 해킹을 막기 위해서예요.

## 해킹 대응 검사 (`tests/test_rewards.py`)

| 해킹 | 검사 |
|---|---|
| 홀드에 손 대고 진동 | 0.1초씩 스치기 5번 → 보너스 0, 0.5초 잡기 → 1회, 놓았다 다시 잡기 → 추가 없음 |
| 미끄러지며 접촉 유지 | 접선 속도가 있으면 안정 접촉 시간이 쌓이지 않음 |
| 목표 근처 왕복 | progress 합 = 처음과 끝 포텐셜 차이(왕복분 0) |
| 버티기 | 5초 후 stagnation 페널티, 자세 보너스 0 |
| 관절 끝까지 꺾기 | ROM 90% 미만 0, 넘으면 지수 증가 / 한계를 넘은 상태가 30스텝 이어지면 종료 |
| 몸통·무릎으로 버티기 | 매 스텝 −1, 1초 지속 시 −5 종료(니바 허용 옵션) |
| 무의미한 점프 | 정적으로 닿는 목표인데 전부 놓으면 이륙 순간 1회 −1 |

## 환경을 붙일 때 할 일

- 매 스텝 `StepState`를 채워요: 손발 접촉 홀드와 하중, 접선 속도, 충격, 관절 q/qd/qdd/τ, 비허용 부위 하중, 자기 충돌 수.
- 액션을 토크로 바꿀 때 `limits.clip_torque(joint, tau, rc.fatigue.torque_scale(...))`로 하드 클리핑해요.
- 관측에는 `rc.fatigue_observation()`과 `rc.target_observation(state)`를 넣어요.
- `terminated`이면 부트스트랩하지 않고, `truncated`(시간 초과)이면 부트스트랩을 유지해요.
- `res.log`를 tensorboard/wandb에 그대로 보내요.
- AMP 판별기와 모션 데이터 로더, 롤아웃 영상 저장은 학습 쪽 구현이 필요해요(체크리스트 남은 항목).
