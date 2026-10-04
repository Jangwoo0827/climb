"""지지 다각형 계산(벽면 x-y 평면에 투영)"""
import numpy as np


def convex_hull(pts):
    """Andrew monotone chain. pts: (N,2) → 반시계 방향 꼭짓점 목록"""
    pts = sorted({(float(x), float(y)) for x, y in pts})
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _seg_dist(p, a, b):
    p, a, b = np.asarray(p), np.asarray(a), np.asarray(b)
    ab = b - a
    L = float(ab @ ab)
    t = 0.0 if L == 0 else max(0.0, min(1.0, float((p - a) @ ab) / L))
    return float(np.linalg.norm(p - (a + t * ab)))


def dist_to_polygon(p, pts) -> float:
    """점 p에서 pts가 이루는 볼록 다각형까지의 거리(안이면 0). 접촉 1개면 점, 2개면 선분"""
    if len(pts) == 0:
        return float('inf')
    hull = convex_hull(pts)
    if len(hull) == 1:
        return float(np.linalg.norm(np.asarray(p) - np.asarray(hull[0])))
    if len(hull) == 2:
        return _seg_dist(p, hull[0], hull[1])
    inside = True
    for i in range(len(hull)):
        a, b = hull[i], hull[(i + 1) % len(hull)]
        if (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0:
            inside = False
            break
    if inside:
        return 0.0
    return min(_seg_dist(p, hull[i], hull[(i + 1) % len(hull)]) for i in range(len(hull)))
