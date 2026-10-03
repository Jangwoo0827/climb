"""Roboflow에서 받은 홀드 데이터셋(YOLO 형식)을 Teachable Machine용 종류별 폴더로 만든다.

데이터: "hold classification" by Capstone, Roboflow Universe, CC BY 4.0
        https://universe.roboflow.com/capstone-kz2o9/hold-classification

사용법:
  1) 위 페이지에서 로그인 → Download Dataset → 형식 "YOLOv8" → zip 다운로드
  2) zip을 풀어 climb/dataset/raw/ 에 넣기 (안에 data.yaml, train/, valid/, test/ 가 있어야 함)
  3) (선택) 직접 찍은 사진은 climb/dataset/extra/<종류>/ 에 넣기. 예: extra/volume/ 에 볼륨 사진
     사진 한 장에 홀드(볼륨) 하나가 가운데 오게 찍거나 잘라 두면 됨
  4) python scripts/make_hold_dataset.py

결과: climb/dataset/holds/
  train/<종류>/*.jpg   ← Teachable Machine 각 클래스에 이 폴더 사진을 업로드
  test/<종류>/*.jpg    ← 학습에 넣지 말고 정확도 확인용으로만 사용
  ATTRIBUTION.txt      ← 출처·라이선스 표기(CC BY 4.0은 출처 표기 필수)
"""
import os
import random
import shutil
import sys

from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, 'dataset', 'raw')
EXTRA = os.path.join(ROOT, 'dataset', 'extra')  # 직접 찍은 사진: extra/<종류>/*.jpg (예: extra/volume/)
OUT = os.path.join(ROOT, 'dataset', 'holds')
SIZE = 224  # Teachable Machine 입력 크기
PAD = 0.15  # 상자 바깥으로 15% 여유(홀드 가장자리가 잘리지 않게)
MIN_PX = 24  # 이보다 작은 상자는 너무 흐려서 버림
TEST_RATIO = 0.15
KEEP = {'jug', 'crimp', 'sloper', 'pinch', 'pocket', 'volume'}  # 'foot'(발 홀드)은 모양 종류가 아니라 제외


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
    is_bg = lambda c: min(c) > 205 and max(c) - min(c) < 30
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
    return Image.composite(bg, im, mask)


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
                side = max(bw * W, bh * H) * (1 + 2 * PAD)  # 정사각형으로 잘라 비율이 찌그러지지 않게
                if side < MIN_PX:
                    continue
                x0, y0 = cx * W - side / 2, cy * H - side / 2
                crop = im.crop((round(x0), round(y0), round(x0 + side), round(y0 + side))).resize((SIZE, SIZE), Image.LANCZOS)
                crops[cls].append((f'{split}_{stem}_{k}.jpg', crop))

    # 직접 찍은 사진(extra/<종류>/): 가운데를 정사각형으로 잘라 같은 크기로
    bg_rand = random.Random(7)
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
                    for j, bg in enumerate(wall_patches(2, bg_rand)):
                        crops.setdefault(cls, []).append((f'extra_{stem}_bg{j}.jpg', swap_bg(im, bg)))
                else:
                    crops.setdefault(cls, []).append((f'extra_{stem}.jpg', im))

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    random.seed(42)
    total = {}
    for cls, items in crops.items():
        if cls not in KEEP or not items:
            continue
        random.shuffle(items)
        n_test = max(1, int(len(items) * TEST_RATIO))
        for part, chunk in (('test', items[:n_test]), ('train', items[n_test:])):
            d = os.path.join(OUT, part, cls)
            os.makedirs(d, exist_ok=True)
            for name, img in chunk:
                img.save(os.path.join(d, name), quality=90)
        total[cls] = (len(items) - n_test, n_test)

    with open(os.path.join(OUT, 'ATTRIBUTION.txt'), 'w', encoding='utf-8') as f:
        f.write('이 폴더의 사진은 다음 데이터셋의 홀드 상자를 잘라 만든 것입니다.\n')
        f.write('"hold classification" by Capstone, Roboflow Universe\n')
        f.write('https://universe.roboflow.com/capstone-kz2o9/hold-classification\n')
        f.write('License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)\n')
        f.write('변경 사항: 상자 영역을 정사각형으로 잘라 224x224로 크기 조정, 종류별 폴더로 분류, 학습/테스트로 나눔\n')
        f.write('파일 이름이 extra_ 로 시작하는 사진은 따로 넣은 사진입니다(위 라이선스와 무관). 이름이 _bg0, _bg1 로 끝나면 흰 배경을 위 데이터셋의 벽 사진 조각으로 바꾼 것입니다.\n')

    print('\n종류별 사진 수 (학습 / 테스트):')
    for cls, (tr, te) in sorted(total.items(), key=lambda x: -sum(x[1])):
        print(f'  {cls:8s} {tr:5d} / {te:4d}')
    print('\n결과 폴더:', OUT)


if __name__ == '__main__':
    main()
