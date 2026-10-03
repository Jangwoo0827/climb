"""Roboflow에서 받은 홀드 데이터셋(YOLO 형식)을 Teachable Machine용 종류별 폴더로 만든다.

데이터: "hold classification" by Capstone, Roboflow Universe, CC BY 4.0
        https://universe.roboflow.com/capstone-kz2o9/hold-classification

사용법:
  1) 위 페이지에서 로그인 → Download Dataset → 형식 "YOLOv8" → zip 다운로드
  2) zip을 풀어 climb/dataset/raw/ 에 넣기 (안에 data.yaml, train/, valid/, test/ 가 있어야 함)
  3) (선택) 직접 찍은 사진은 climb/dataset/extra/<종류>/ 에 넣기. 예: extra/volume/ 에 볼륨 사진
     사진 한 장에 홀드(볼륨) 하나가 가운데 오게 찍거나 잘라 두면 됨
  4) python scripts/make_hold_dataset.py
     종류별 학습 사진 수를 맞추려면: python scripts/make_hold_dataset.py --max-train 60
     (많은 종류만 무작위로 줄임. 테스트 사진은 그대로라 이전 모델과 같은 기준으로 비교 가능)

결과: climb/dataset/holds/
  train/<종류>/*.jpg   ← Teachable Machine 각 클래스에 이 폴더 사진을 업로드
  test/<종류>/*.jpg    ← 학습에 넣지 말고 정확도 확인용으로만 사용
  ATTRIBUTION.txt      ← 출처·라이선스 표기(CC BY 4.0은 출처 표기 필수)
"""
import os
import random
from collections import Counter
import shutil
import sys

from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, 'dataset', 'raw')
EXTRA = os.path.join(ROOT, 'dataset', 'extra')  # 직접 찍은 사진: extra/<종류>/*.jpg (예: extra/volume/)
OUT = os.path.join(ROOT, 'dataset', 'holds')
SIZE = 224  # Teachable Machine 입력 크기
PAD = 0.05  # 상자 바깥 여유 5%: 옆 홀드가 섞이지 않게 상자 그대로 자르고 빈 곳은 회색으로 채움
GRAY = (128, 128, 128)
MIN_PX = 24  # 이보다 작은 상자는 너무 흐려서 버림
TEST_RATIO = 0.15
MAX_TRAIN = int(sys.argv[sys.argv.index('--max-train') + 1]) if '--max-train' in sys.argv else 0  # 종류별 학습 사진 상한(0이면 제한 없음)
KEEP = {'jug', 'crimp', 'sloper', 'pinch', 'pocket', 'volume'}  # 'foot'(발 홀드)은 모양 종류가 아니라 제외


def letterbox(box):
    """상자 비율을 유지한 채 SIZE x SIZE 회색 바탕 가운데에 놓음(정사각형으로 넓혀 옆 홀드가 들어오지 않게)"""
    w, h = box.size
    k = SIZE / max(w, h)
    small = box.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    out = Image.new('RGB', (SIZE, SIZE), GRAY)
    out.paste(small, ((SIZE - small.width) // 2, (SIZE - small.height) // 2))
    return out


def wall_patches(n, rand):
    """원본 벽 사진에서 무작위로 정사각형 조각을 잘라 배경으로 씀"""
    paths = []
    for split in ('train', 'valid', 'test'):
        d = os.path.join(RAW, split, 'images')
        if os.path.isdir(d):
            paths += [os.path.join(d, f) for f in os.listdir(d)]
    out = []
    for _ in range(n):
        if not paths:
            break
        im = Image.open(rand.choice(paths)).convert('RGB')
        w, h = im.size
        side = rand.randint(min(w, h) // 4, min(w, h) // 2)
        x, y = rand.randint(0, w - side), rand.randint(0, h - side)
        out.append(im.crop((x, y, x + side, y + side)).resize((SIZE, SIZE), Image.LANCZOS))
    return out


def has_plain_bg(im):
    """가장자리 대부분이 흰색에 가까우면 제품 사진처럼 배경이 비어 있는 사진"""
    px = im.load()
    w, h = im.size
    edge = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)] + [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    light = sum(1 for r, g, b in edge if min(r, g, b) > 215 and max(r, g, b) - min(r, g, b) < 25)
    return light / len(edge) > 0.6


def swap_bg(im, bg):
    """가장자리와 이어진 흰 배경을 벽 사진 조각으로 바꿈(물체 안쪽의 흰 부분은 그대로)"""
    w, h = im.size
    px = im.load()
    is_bg = lambda c: min(c) > 238 and max(c) - min(c) < 15  # 거의 순백색만 배경(연회색 볼륨 면은 남김)
    mask = Image.new('L', (w, h), 0)
    mp = mask.load()
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    seen = set()
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h) or not is_bg(px[x, y]):
            continue
        seen.add((x, y))
        mp[x, y] = 255
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    from PIL import ImageFilter
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))
    obj = Image.new('L', (w, h), 255)
    obj.paste(0, mask=mask.point(lambda v: 255 if v > 127 else 0))
    return Image.composite(bg, im, mask), len(seen) / (w * h), obj.getbbox()


def read_names(path):
    """data.yaml에서 클래스 이름 목록을 읽음(yaml 라이브러리 없이)."""
    text = open(path, encoding='utf-8').read()
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('names:') and '[' in line:
            inner = line.split('[', 1)[1].rsplit(']', 1)[0]
            return [n.strip().strip("'\"") for n in inner.split(',')]
    # 여러 줄 형식: names:\n  0: jug  또는  - jug
    names, on = [], False
    for line in text.splitlines():
        if line.strip().startswith('names:'):
            on = True
            continue
        if on:
            s = line.strip()
            if not s or (not s.startswith('-') and ':' not in s):
                break
            names.append(s.split(':', 1)[1].strip().strip("'\"") if ':' in s else s[1:].strip().strip("'\""))
    return names


def main():
    yaml = os.path.join(RAW, 'data.yaml')
    if not os.path.exists(yaml):
        sys.exit(f'data.yaml이 없어요. Roboflow에서 YOLOv8 형식으로 받아 {RAW} 에 풀어 주세요.')
    names = read_names(yaml)
    print('클래스:', names)

    crops = {n: [] for n in names}
    for split in ('train', 'valid', 'test'):
        img_dir = os.path.join(RAW, split, 'images')
        lbl_dir = os.path.join(RAW, split, 'labels')
        if not os.path.isdir(img_dir):
            continue
        for fn in sorted(os.listdir(img_dir)):
            stem = os.path.splitext(fn)[0]
            lbl = os.path.join(lbl_dir, stem + '.txt')
            if not os.path.exists(lbl):
                continue
            im = ImageOps.exif_transpose(Image.open(os.path.join(img_dir, fn))).convert('RGB')
            W, H = im.size
            for k, line in enumerate(open(lbl, encoding='utf-8')):
                parts = line.split()
                if len(parts) < 5:
                    continue
                cls = names[int(parts[0])]
                vals = [float(v) for v in parts[1:]]
                if len(vals) == 4:  # 상자: cx cy w h (0~1)
                    cx, cy, bw, bh = vals
                else:  # 다각형(분할) 형식이면 꼭짓점을 감싸는 상자로
                    xs, ys = vals[0::2], vals[1::2]
                    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
                    bw, bh = max(xs) - min(xs), max(ys) - min(ys)
                pw, ph = bw * W * (1 + 2 * PAD), bh * H * (1 + 2 * PAD)
                if max(pw, ph) < MIN_PX:
                    continue
                box = im.crop((round(cx * W - pw / 2), round(cy * H - ph / 2), round(cx * W + pw / 2), round(cy * H + ph / 2)))
                crop = letterbox(box)
                crops[cls].append((f'{split}_{stem}_{k}.jpg', crop))

    # 직접 찍은 사진(extra/<종류>/): 가운데를 정사각형으로 잘라 같은 크기로
    bg_rand = random.Random(7)
    swapped, kept = [], []
    if os.path.isdir(EXTRA):
        for cls in sorted(os.listdir(EXTRA)):
            d = os.path.join(EXTRA, cls)
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d)):
                if not fn.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                    continue
                im = ImageOps.exif_transpose(Image.open(os.path.join(d, fn))).convert('RGB')
                im = ImageOps.fit(im, (SIZE, SIZE), Image.LANCZOS)
                stem = os.path.splitext(fn)[0]
                if has_plain_bg(im):
                    # 흰 배경 제품 사진: 배경을 벽 사진 조각으로 바꾼 두 장으로(모델이 '흰 배경'을 외우지 않게)
                    made = []
                    for j, bg in enumerate(wall_patches(2, bg_rand)):
                        out, frac, bbox = swap_bg(im, bg)
                        if bbox:
                            # 홀드 데이터와 같게: 물체 상자(여유 5%)만 잘라 회색 바탕에 놓음
                            x0, y0, x1, y1 = bbox
                            mx, my = (x1 - x0) * PAD, (y1 - y0) * PAD
                            out = letterbox(out.crop((max(0, x0 - mx), max(0, y0 - my), min(SIZE, x1 + mx), min(SIZE, y1 + my))))
                        made.append((f'extra_{stem}_bg{j}.jpg', out, frac))
                    frac = made[0][2] if made else 0
                    # 배경으로 바뀐 부분이 너무 적거나(배경을 못 찾음) 너무 많으면(물체까지 지움) 원본을 그대로 씀
                    if 0.15 <= frac <= 0.92:
                        for name, out, _ in made:
                            crops.setdefault(cls, []).append((name, out))
                        swapped.append((stem, frac))
                    else:
                        crops.setdefault(cls, []).append((f'extra_{stem}.jpg', im))
                        kept.append((stem, frac))
                else:
                    crops.setdefault(cls, []).append((f'extra_{stem}.jpg', im))

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    # 원본 사진 단위로 학습/테스트를 나눔: 같은 원본에서 나온 사진(같은 벽 사진의 다른 홀드, 같은 볼륨의 배경만 바꾼 사진)이
    # 학습과 테스트에 함께 들어가면 테스트 점수가 실제보다 높게 나옴(누수). 완전히 같은 사진(SHA256)은 하나만 남김
    import hashlib
    import re

    def source_of(name):
        stem = os.path.splitext(name)[0]
        if stem.startswith('extra_'):
            return re.sub(r'_bg\d+$', '', stem)
        m = re.match(r'(train|valid|test)_(.+)_\d+$', stem)
        return m.group(2) if m else stem

    seen_hash = set()
    dup = 0
    by_src = {}
    for cls, items in crops.items():
        if cls not in KEEP:
            continue
        for name, img in items:
            h = hashlib.sha256(img.tobytes()).hexdigest()
            if h in seen_hash:
                dup += 1
                continue
            seen_hash.add(h)
            by_src.setdefault(source_of(name), []).append((cls, name, img))
    sources = sorted(by_src)
    random.Random(42).shuffle(sources)
    # 종류별로 테스트가 약 15%가 될 때까지 원본 사진을 통째로 테스트에 넣음
    want = Counter(c for v in by_src.values() for c, _, _ in v)
    got = Counter()
    test_src = set()
    for src in sources:
        cls_here = Counter(c for c, _, _ in by_src[src])
        if any(got[c] + n > max(1, round(want[c] * TEST_RATIO)) for c, n in cls_here.items()):
            continue
        test_src.add(src)
        got.update(cls_here)
    split = {'train': {}, 'test': {}}
    for src in sources:
        part = 'test' if src in test_src else 'train'
        for cls, name, img in by_src[src]:
            split[part].setdefault(cls, []).append((name, img))
    rnd = random.Random(42)
    total = {}
    for cls in sorted(want):
        train = split['train'].get(cls, [])
        rnd.shuffle(train)
        if MAX_TRAIN and len(train) > MAX_TRAIN:
            train = train[:MAX_TRAIN]
        test = split['test'].get(cls, [])
        for part, chunk in (('test', test), ('train', train)):
            d = os.path.join(OUT, part, cls)
            os.makedirs(d, exist_ok=True)
            for name, img in chunk:
                img.save(os.path.join(d, name), quality=90)
        total[cls] = (len(train), len(test))
    print(f'완전 중복으로 뺀 사진 {dup}장 · 테스트에 넣은 원본 사진 {len(test_src)}개(원본 단위로 나눠 누수 없음)')

    with open(os.path.join(OUT, 'ATTRIBUTION.txt'), 'w', encoding='utf-8') as f:
        f.write('이 폴더의 사진은 다음 데이터셋의 홀드 상자를 잘라 만든 것입니다.\n')
        f.write('"hold classification" by Capstone, Roboflow Universe\n')
        f.write('https://universe.roboflow.com/capstone-kz2o9/hold-classification\n')
        f.write('License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)\n')
        f.write('변경 사항: 상자 영역(여유 5%)만 잘라 비율을 유지한 채 224x224 회색 바탕에 놓음, 종류별 폴더로 분류, 학습/테스트로 나눔\n')
        f.write('파일 이름이 extra_ 로 시작하는 사진은 따로 넣은 사진입니다(위 라이선스와 무관). 이름이 _bg0, _bg1 로 끝나면 흰 배경을 위 데이터셋의 벽 사진 조각으로 바꾼 것입니다.\n')

    print('\n종류별 사진 수 (학습 / 테스트):')
    for cls, (tr, te) in sorted(total.items(), key=lambda x: -sum(x[1])):
        print(f'  {cls:8s} {tr:5d} / {te:4d}')
    if swapped or kept:
        print(f'\n흰 배경을 벽으로 바꾼 사진 {len(swapped)}장, 배경을 못 나눠 원본 그대로 둔 사진 {len(kept)}장')
        for stem, frac in kept:
            print(f'  원본 유지: {stem} (배경 비율 {frac:.0%})')
    print('\n결과 폴더:', OUT)


if __name__ == '__main__':
    main()
