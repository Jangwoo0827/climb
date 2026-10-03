"""홀드 색 인식 테스트용 합성 클라이밍 벽 이미지를 만든다. (정답 좌표 JSON 포함)

실행: python make_synthetic.py
결과: 이 폴더에 s1_*.jpg ... 와 truth.json 이 만들어진다.
truth.json 형식: { "이미지 파일명": { "groups": { "색이름": [[x, y, 반지름], ...] }, "volumes": [[x, y, 크기, 종류, 색], ...], "note": "설명" } }
좌표는 픽셀이고, 앱의 테스트 뷰어(/test.html)가 이 정답과 비교해 재현율/오검출을 계산한다.
"""
import json
import os
import random

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 640, 720


def rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def wall(color_top, color_bottom):
    """위아래로 조명이 달라지는 벽 배경"""
    t = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    return (rgb(color_top) * (1 - t) + rgb(color_bottom) * t) * np.ones((H, W, 3), np.float32)


def blob_mask(cx, cy, rx, ry, ang, wobble=0.12, seed=0):
    """살짝 울퉁불퉁한 타원 마스크와 그 안의 정규화 좌표(u, v)"""
    rnd = random.Random(seed)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    dx, dy = xx - cx, yy - cy
    c, s = np.cos(ang), np.sin(ang)
    u = (dx * c + dy * s) / rx
    v = (-dx * s + dy * c) / ry
    theta = np.arctan2(v, u)
    k1, k2 = rnd.uniform(0, 6.28), rnd.uniform(0, 6.28)
    r = 1 + wobble * np.sin(2 * theta + k1) + wobble * 0.6 * np.sin(3 * theta + k2)
    dist = np.hypot(u, v)
    return dist <= r, u, v, dist / r


def draw_hold(img, cx, cy, rx, ry, ang, color, seed=0, light=(-0.6, -0.8), shadow_k=0.35, shadow_blur=4, shadow_off=(0.28, 0.38)):
    """음영(하이라이트+그림자)이 있는 홀드와 벽에 드리우는 그림자를 그린다."""
    # 그림자
    sm, *_ = blob_mask(cx + shadow_off[0] * rx, cy + shadow_off[1] * ry, rx * 1.1, ry * 1.1, ang, seed=seed)
    sh = Image.fromarray((sm * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(shadow_blur))
    shadow = np.asarray(sh, np.float32)[..., None] / 255.0
    img[:] = img * (1 - shadow_k * shadow)
    # 홀드 본체
    m, u, v, d = blob_mask(cx, cy, rx, ry, ang, seed=seed)
    shade = 1.0 + 0.35 * (-(u * light[0] + v * light[1])) * 0.9 - 0.45 * np.clip(d - 0.55, 0, 1)
    shade = np.clip(shade, 0.35, 1.45)[..., None]
    base = rgb(color) * shade
    # 흰색 분필 가루 느낌
    chalk = np.random.default_rng(seed).random((H, W, 1)).astype(np.float32) * 0.0
    body = np.clip(base + chalk, 0, 255)
    img[m] = body[m]


def draw_volume(img, kind, color, cx, cy, size):
    """볼륨(벽에 붙은 큰 삼각뿔/반구). 면마다 밝기가 달라 색조는 같고 밝기만 다른 여러 면으로 그린다."""
    from PIL import ImageDraw
    pil = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(pil)
    base = rgb(color)

    def col(k):
        return tuple(int(v) for v in np.clip(base * k, 0, 255))

    if kind == 'pyramid':
        apex = (cx, cy - size)
        b0, b1, b2 = (cx - size * 1.05, cy + size * 0.75), (cx + size * 1.05, cy + size * 0.75), (cx + size * 0.15, cy + size * 1.0)
        d.polygon([apex, b0, b2], fill=col(1.12))
        d.polygon([apex, b2, b1], fill=col(0.72))
        d.polygon([apex, b0, b1], fill=col(0.92))
        d.line([apex, b2], fill=col(0.5), width=2)
    else:  # dome: 반구
        m, u, v, dd = blob_mask(cx, cy, size * 1.3, size * 0.9, 0.0, wobble=0.02)
        m &= (np.mgrid[0:H, 0:W][0] <= cy + size * 0.2)
        shade = np.clip(1.15 + 0.4 * (-(u * -0.5 + v * -0.8)) - 0.5 * np.clip(dd - 0.5, 0, 1), 0.4, 1.5)[..., None]
        arr = np.asarray(pil, np.float32).copy()
        arr[m] = np.clip(base * shade, 0, 255)[m]
        pil = Image.fromarray(arr.astype(np.uint8))
    img[:] = np.asarray(pil, np.float32)


def finish(img, name, noise=6, blur=0.8, vignette=0.0, quality=82, dark=1.0):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    if vignette:
        r = np.hypot((xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2))
        img *= (1 - vignette * np.clip(r - 0.3, 0, 1))[..., None]
    img *= dark
    img += np.random.default_rng(1).normal(0, noise, img.shape).astype(np.float32)
    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    if blur:
        out = out.filter(ImageFilter.GaussianBlur(blur))
    out.save(os.path.join(HERE, name), quality=quality)


def scatter(n, margin=50, avoid=None, seed=0, min_gap=70):
    rnd = random.Random(seed)
    pts = []
    tries = 0
    while len(pts) < n and tries < 5000:
        tries += 1
        x, y = rnd.randint(margin, W - margin), rnd.randint(margin, H - margin)
        if avoid and avoid(x, y):
            continue
        if all(np.hypot(x - a, y - b) > min_gap for a, b in pts):
            pts.append((x, y))
    return pts


truth = {}


def build(name, bg, groups, note, extra=None, volumes=(), shadow=None, **fin):
    """groups: {색이름: (hex색, 개수)}. 다른 색 홀드(방해물)도 함께 그림."""
    random.seed(hash(name) % 1000)
    img = wall(*bg)
    if extra:
        extra(img)
    user_avoid = fin.pop('avoid', None)
    zones = [(cx, cy, size * 1.9) for _, _, cx, cy, size in volumes]  # 볼륨이 놓일 자리에는 홀드를 두지 않음

    def avoid(x, y):
        return any(np.hypot(x - zx, y - zy) < zr for zx, zy, zr in zones) or bool(user_avoid and user_avoid(x, y))

    pts = scatter(sum(n for _, n in groups.values()), seed=len(name) * 7, avoid=avoid)
    random.Random(3).shuffle(pts)
    t = {}
    i = 0
    for gname, (col, n) in groups.items():
        t[gname] = []
        for _ in range(n):
            x, y = pts[i]
            i += 1
            rx = random.uniform(14, 34)
            ry = rx * random.uniform(0.55, 1.0)
            ang = random.uniform(0, 3.14)
            draw_hold(img, x, y, rx, ry, ang, col, seed=i * 13, **(shadow or {}))
            t[gname].append([x, y, round(max(rx, ry))])
    vt = []
    for kind, col, cx, cy, size in volumes:
        draw_volume(img, kind, col, cx, cy, size)
        vt.append([cx, cy, size, kind, col])
    finish(img, name, **fin)
    truth[name] = {'groups': t, 'volumes': vt, 'note': note}


# 1) 청록 벽 + 파란 홀드 + 어두운 남색 구조물 + 분홍 띠 (사용자가 겪은 실패 상황)
def s1_extra(img):
    img[:70] = rgb('#15335c')
    for i in range(7):
        x0 = i * 100
        for k in range(14):
            xs = x0 + k
            ys = np.arange(0, 70)
            xx = np.clip(xs + ys // 2, 0, W - 1)
            img[ys, xx] = rgb('#8fa0b5')
    img[70:100] = rgb('#d989c6')
    img[H - 90:] = rgb('#d98ac6')
    # 오른쪽 면은 더 밝은 청록
    for y in range(110, H - 100):
        img[y, int(W * 0.55) + y // 9:] = rgb('#9fdde2')


build(
    's1_teal_wall_blue_holds.jpg', ('#5bc6d0', '#3fa5b4'),
    {'blue': ('#2a63d8', 6), 'red': ('#d63a3a', 3), 'black': ('#161616', 3), 'yellow': ('#e6c02e', 3)},
    '청록 벽 + 파란 홀드 + 어두운 남색 구조물 + 분홍 띠(오검출 유발) + 파란 삼각뿔 볼륨', extra=s1_extra,
    volumes=[('pyramid', '#2a63d8', 470, 300, 70)],
    avoid=lambda x, y: y < 110 or y > H - 100,
)

# 2) 흰/회백색 벽 + 여러 색 홀드
build(
    's2_white_wall_colorful.jpg', ('#ece9e2', '#cfcac0'),
    {'yellow': ('#e8c21a', 5), 'red': ('#d03434', 4), 'blue': ('#2f6fd0', 4), 'green': ('#2fa04a', 3), 'black': ('#181818', 3), 'purple': ('#7a3fc0', 3)},
    '흰 벽 + 여러 색 홀드(가장 쉬운 경우) + 파란 삼각뿔·빨간 반구 볼륨',
    volumes=[('pyramid', '#2f6fd0', 470, 200, 62), ('dome', '#d03434', 180, 560, 60)],
)

# 3) 합판(베이지/주황) 벽 + 노랑·빨강·주황 홀드 (벽 색과 가까운 어려운 경우)
build(
    's3_plywood_wall.jpg', ('#e0b57c', '#c99a62'),
    {'yellow': ('#f0d020', 4), 'red': ('#c02b32', 4), 'blue': ('#2456b8', 3), 'green': ('#2b7a3c', 3), 'orange': ('#e8681c', 3)},
    '합판 벽(베이지/주황)에서 노랑·주황 홀드는 벽과 색이 가까움',
)

# 4) 어두운 회색 벽 + 밝은 홀드
build(
    's4_dark_wall_bright_holds.jpg', ('#4b4f57', '#33363d'),
    {'green': ('#39e05a', 4), 'pink': ('#ff4fa0', 4), 'yellow': ('#ffe62e', 4), 'white': ('#f2f2f2', 3), 'blue': ('#3d8bff', 3)},
    '어두운 벽 + 형광에 가까운 밝은 홀드',
)

# 5) 파란 벽 + 파란 홀드 (같은 계열)
build(
    's5_blue_wall_blue_holds.jpg', ('#4a86c8', '#356ab0'),
    {'darkblue': ('#1c3f8e', 5), 'yellow': ('#f0cf25', 4), 'red': ('#d03a3a', 3), 'white': ('#f0f0f0', 3)},
    '벽과 같은 계열(파랑)의 홀드(어려움)',
)

# 6) 저조도 + 강한 비네팅
build(
    's6_low_light.jpg', ('#7d7a72', '#55524b'),
    {'yellow': ('#d9b425', 4), 'red': ('#b02c30', 4), 'blue': ('#2860bd', 4), 'green': ('#2b8a44', 3)},
    '어두운 조명 + 가장자리가 어두워지는 사진', vignette=0.55, dark=0.62, noise=9,
)

# 7) 홀드가 많고 작은 벽
build(
    's7_dense_small_holds.jpg', ('#e9e6df', '#d2cec4'),
    {'blue': ('#2f6fd0', 12), 'yellow': ('#e8c21a', 10), 'red': ('#d03434', 10), 'black': ('#181818', 8)},
    '작은 홀드가 빽빽한 벽 + 노란 삼각뿔 볼륨',
    volumes=[('pyramid', '#e8c21a', 320, 380, 66)],
)

# 8) 회색 홀드 + 강하고 긴 그림자 (그림자가 홀드로 잡히면 안 됨)
build(
    's8_strong_shadows_gray_holds.jpg', ('#efede8', '#d8d4cb'),
    {'gray': ('#6f7278', 6), 'yellow': ('#e8c21a', 4), 'red': ('#d03434', 3)},
    '흰 벽 + 회색 홀드 + 진하고 긴 그림자(회색 홀드를 누르면 그림자가 같이 잡히기 쉬움)',
    shadow={'shadow_k': 0.6, 'shadow_blur': 8, 'shadow_off': (0.9, 1.1)},
)

# 9) 합판 벽 + 어두운 홀드 + 강한 그림자
build(
    's9_plywood_dark_holds_shadows.jpg', ('#e0b57c', '#c99a62'),
    {'black': ('#2a2a2e', 5), 'darkgray': ('#54565c', 4), 'yellow': ('#f0d020', 3)},
    '합판 벽 + 어두운 홀드 + 진한 그림자(벽 색이 어두워진 그림자는 벽과 같은 색조)',
    shadow={'shadow_k': 0.62, 'shadow_blur': 7, 'shadow_off': (0.8, 1.0)},
)

with open(os.path.join(HERE, 'truth.json'), 'w', encoding='utf-8') as f:
    json.dump(truth, f, ensure_ascii=False, indent=1)
print('만든 이미지:', len(truth))
for k, v in truth.items():
    print(' ', k, {g: len(p) for g, p in v['groups'].items()})
