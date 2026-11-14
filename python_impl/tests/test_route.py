"""코스 탐색 테스트. 기준 구현: src/utils/route.js

실행:  python -m pytest tests/test_route.py -v   (python_impl 폴더에서)
위에서부터 차례로 통과시키세요. 앞 테스트가 안 되면 뒤 테스트도 안 됩니다.
"""
import pytest

from route import body_model, dist, find_route, step_cost


def H(x, y, size=1.0, **kw):
    """홀드 하나. mx, my는 미터(y는 위쪽이 +), size는 상대 크기."""
    return dict(mx=x, my=y, size=size, **kw)


@pytest.fixture
def body():
    return body_model(170, 1.0, "intermediate")


# ---------- 1단계: 몸 모델 ----------

def test_body_model_intermediate(body):
    # span = 키 × 팔 비율 = 1.7
    assert body["span"] == pytest.approx(1.7)
    # max_reach = min(span × 0.9, span × 0.92) = 1.53
    assert body["max_reach"] == pytest.approx(1.53)
    # comfort = span × 0.6
    assert body["comfort"] == pytest.approx(1.02)
    # jump_reach = max_reach + span × 0.32
    assert body["jump_reach"] == pytest.approx(2.074)
    assert body["max_vertical"] == pytest.approx(1.094865)


def test_body_model_beginner_reaches_less():
    b = body_model(170, 1.0, "beginner")
    assert b["max_reach"] == pytest.approx(1.7 * 0.78)


def test_body_model_reach_is_capped_at_92_percent_of_span():
    # 상급은 reach_ratio가 1.0이지만 몸의 한계 92%를 넘지 못함
    b = body_model(170, 1.0, "advanced")
    assert b["max_reach"] == pytest.approx(1.7 * 0.92)


def test_dist():
    assert dist(H(0, 0), H(3, 4)) == pytest.approx(5)


# ---------- 2단계: 동작 하나의 비용 ----------
# step_cost(holds, body, hand, l, r, t, max_size) -> (비용, 점프여부) 또는 None(불가능한 이동)
# hand: 옮기는 손('L'/'R'), l/r: 지금 두 손이 잡은 홀드 번호, t: 옮겨 갈 홀드 번호

def test_cannot_move_to_the_hold_you_already_hold(body):
    holds = [H(0, 1.0), H(0.3, 1.0), H(0.3, 1.5)]
    assert step_cost(holds, body, "R", 0, 1, 1, 1.0) is None


def test_foot_only_holds_are_skipped(body):
    holds = [H(0, 1.0), H(0.3, 1.0), H(0.3, 1.5, foot_only=True)]
    assert step_cost(holds, body, "R", 0, 1, 2, 1.0) is None


def test_plain_reach_cost(body):
    # 오른손을 (0.3, 1.0) → (0.3, 1.5)로. 계산 과정:
    #   기본 0.6 + (이동거리 0.5 / comfort 1.02)² × 1.2
    #   두 손 높이 차 0.5 → (0.5 − 0.35) × 6 = +0.9
    #   위로 0.5 가면 −0.5 × 0.6 = −0.3
    holds = [H(0, 1.0), H(0.3, 1.0), H(0.3, 1.5)]
    cost, dyno = step_cost(holds, body, "R", 0, 1, 2, 1.0)
    assert dyno is False
    assert cost == pytest.approx(1.48835, abs=1e-4)


def test_far_move_becomes_dyno(body):
    # 반대 손(0번)과 1.92m 떨어짐: 팔이 안 닿지만 점프로는 닿음
    holds = [H(0, 1.0), H(0.3, 1.0), H(0.3, 2.9)]
    cost, dyno = step_cost(holds, body, "R", 0, 1, 2, 1.0)
    assert dyno is True
    # 점프 비용 = 30 + (거리 − max_reach) × 20
    assert cost == pytest.approx(30 + (dist(holds[2], holds[0]) - body["max_reach"]) * 20)


def test_too_far_even_for_a_jump(body):
    holds = [H(0, 1.0), H(0.3, 1.0), H(0.3, 5.0)]
    assert step_cost(holds, body, "R", 0, 1, 2, 1.0) is None


def test_dyno_downward_is_not_allowed(body):
    # 두 손이 위에 있고 아래 홀드로 점프하려 함
    holds = [H(0, 2.5), H(0.3, 2.5), H(0.3, 1.2)]
    # 높이 차(1.3m)가 max_vertical을 넘어 점프로 분류되지만, 점프는 위나 옆으로만
    assert step_cost(holds, body, "R", 0, 1, 2, 1.0) is None


def test_hold_penalty_is_added(body):
    holds = [H(0, 1.0), H(0.3, 1.0), H(0.3, 1.5)]
    base, _ = step_cost(holds, body, "R", 0, 1, 2, 1.0)
    pen, _ = step_cost(holds, body, "R", 0, 1, 2, 1.0, hold_penalty={2: 5})
    assert pen == pytest.approx(base + 5)


def test_cost_has_a_floor_of_point_two(body):
    # 아주 가까운 이동은 보상 때문에 음수가 될 수 있어서 0.2에서 잘림
    holds = [H(0, 1.0), H(0.0, 1.0), H(0.01, 1.05)]
    cost, _ = step_cost(holds, body, "R", 0, 1, 2, 1.0)
    assert cost >= 0.2


# ---------- 3단계: 다익스트라 ----------
# find_route(holds, body, start_ids, finish_ids, hold_penalty=None)
#   -> {"start": (왼손, 오른손), "steps": [{"hand","to","dyno"}...], "cost": 총비용} 또는 None

LADDER = [H(0.0, 0.8), H(0.4, 0.8), H(0.0, 1.3), H(0.4, 1.3), H(0.0, 1.8), H(0.4, 1.8), H(0.0, 2.3), H(0.4, 2.3)]


def test_route_reaches_both_finish_holds(body):
    r = find_route(LADDER, body, [0, 1], [6, 7])
    assert r is not None
    assert set(r["start"]) == {0, 1}
    # 단계를 따라가 보면 끝에서 두 손이 모두 끝 홀드를 잡고 있어야 함
    l, rr = r["start"]
    for s in r["steps"]:
        if s["dyno"]:
            l = rr = s["to"]
        elif s["hand"] == "L":
            l = s["to"]
        else:
            rr = s["to"]
    assert {l, rr} == {6, 7}


def test_route_goes_up_without_dyno_on_an_easy_wall(body):
    r = find_route(LADDER, body, [0, 1], [6, 7])
    assert not any(s["dyno"] for s in r["steps"])
    assert len(r["steps"]) == 6
    assert r["cost"] == pytest.approx(5.065052, abs=1e-4)


def test_unreachable_finish_returns_none(body):
    far = [H(0, 0.8), H(0.4, 0.8), H(0, 5.0), H(0.4, 5.0)]
    assert find_route(far, body, [0, 1], [2, 3]) is None


def test_empty_inputs_return_none(body):
    assert find_route([], body, [0], [1]) is None
    assert find_route(LADDER, body, [], [6, 7]) is None
    assert find_route(LADDER, body, [0, 1], []) is None


WALL = [
    H(0, 0.8), H(0.4, 0.8),          # 0, 1 시작
    H(-0.3, 1.3), H(0.7, 1.3),       # 2, 3 바깥쪽
    H(-0.3, 1.8), H(0.7, 1.8),       # 4, 5 바깥쪽
    H(0, 2.3), H(0.4, 2.3),          # 6, 7 끝
    H(0.1, 1.3), H(0.3, 1.8),        # 8, 9 안쪽
]


def test_hold_penalty_changes_the_route(body):
    # 바깥쪽 홀드(2~5)에 큰 비용을 주면 안쪽(8, 9)으로만 올라가야 함
    free = find_route(WALL, body, [0, 1], [6, 7])
    avoid = find_route(WALL, body, [0, 1], [6, 7], hold_penalty={2: 50, 3: 50, 4: 50, 5: 50})
    used = {s["to"] for s in avoid["steps"]}
    assert not used & {2, 3, 4, 5}
    assert {8, 9} <= used
    assert avoid["cost"] >= free["cost"]
