"""HoldClassificatore v2.2(Roboflow, CC BY 4.0) 정리: 2x2 모자이크를 4조각으로 나누고 같은 사진 조각은 하나만 남김.

받은 데이터는 640x640 한 장이 서로 다른 사진 4장을 이어 붙인 모자이크이고, 같은 원본 사진이 여러 모자이크와
train/valid/test에 반복해서 들어 있음(그대로 쓰면 중복이 많고 학습·테스트 누수가 생김).

사용: python scripts/prepare_holdclassificatore.py
입력: dataset/raw_holdclassificatore/<아무 폴더>/data.yaml (Roboflow YOLOv8 내보내기)
결과: dataset/raw_hc_unique/train/{images,labels}/hc_tNNNNN.*  + data.yaml (클래스 이름은 소문자로)
      조각 하나 = 원본 사진 하나라서, make_hold_dataset.py가 조각 단위로 학습/테스트를 나눠 누수가 없음
"""
import glob
import os
import shutil
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IN_BASE = os.path.join(ROOT, 'dataset', 'raw_holdclassificatore')
OUT = os.path.join(ROOT, 'dataset', 'raw_hc_unique')
NEAR = 10  # 지각 해시(256비트) 차이가 이 이하면 같은 사진(재압축·약간의 차이)
NEAR_CROP = 6  # 홀드 하나를 잘라 거친 해시(8x8, 64비트)로 비교: 같은 홀드는 2~4비트, 다른 홀드는 대부분 12비트 이상 차이


def dhash(im, n=16):
    g = im.convert('L').resize((n + 1, n), Image.LANCZOS)
    px = g.tobytes()
    bits = 0
    for y in range(n):
        for x in range(n):
            bits = (bits << 1) | (px[y * (n + 1) + x] > px[y * (n + 1) + x + 1])
    return bits


def main():
    yamls = glob.glob(os.path.join(IN_BASE, '**', 'data.yaml'), recursive=True)
    if not yamls:
        sys.exit(f'data.yaml을 찾지 못했어요: {IN_BASE}')
    base = os.path.dirname(yamls[0])
    text = open(yamls[0], encoding='utf-8').read()
    names = [n.strip().strip("'\"") for n in text.split('names:')[1].split('[', 1)[1].split(']', 1)[0].split(',')]
    print('원본 클래스:', names)

    tiles = []  # (hash, image, [(cls, cx, cy, w, h)] 조각 기준 0~1)
    files = 0
    crossing = 0
    for split in ('train', 'valid', 'test'):
        img_dir = os.path.join(base, split, 'images')
        if not os.path.isdir(img_dir):
            continue
        for fn in sorted(os.listdir(img_dir)):
            files += 1
            im = Image.open(os.path.join(img_dir, fn)).convert('RGB')
            W, H = im.size
            hw, hh = W // 2, H // 2
            lbl = os.path.join(base, split, 'labels', os.path.splitext(fn)[0] + '.txt')
            boxes = [[float(v) for v in l.split()] for l in open(lbl, encoding='utf-8') if len(l.split()) >= 5] if os.path.exists(lbl) else []
            for qy in (0, 1):
                for qx in (0, 1):
                    tile = im.crop((qx * hw, qy * hh, qx * hw + hw, qy * hh + hh))
                    mine = []
                    for b in boxes:
                        c, x, y, w, h = int(b[0]), b[1], b[2], b[3], b[4]
                        if (x >= 0.5) != bool(qx) or (y >= 0.5) != bool(qy):
                            continue
                        if (x - w / 2 < 0.5 < x + w / 2) or (y - h / 2 < 0.5 < y + h / 2):
                            crossing += 1
                            continue
                        mine.append((c, (x - qx * 0.5) * 2, (y - qy * 0.5) * 2, w * 2, h * 2))
                    if mine:
                        tiles.append((dhash(tile), tile, mine))

    # 같은 사진 조각 묶기: 해시를 16비트씩 4칸으로 나눠 한 칸이라도 같은 것끼리만 비교(빠르게)
    groups = []  # [대표 해시, 대표 조각, 상자, 묶인 수]
    buckets = {}
    for h, tile, boxes in tiles:
        found = None
        for band in range(16):
            key = (band, (h >> (band * 16)) & 0xFFFF)
            for gi in buckets.get(key, []):
                if bin(groups[gi][0] ^ h).count('1') <= NEAR:
                    found = gi
                    break
            if found is not None:
                break
        if found is None:
            groups.append([h, tile, boxes, 1])
            gi = len(groups) - 1
            for band in range(16):
                buckets.setdefault((band, (h >> (band * 16)) & 0xFFFF), []).append(gi)
        else:
            g = groups[found]
            g[3] += 1
            if len(boxes) > len(g[2]):  # 상자가 더 많이 달린 쪽을 대표로
                g[1], g[2] = tile, boxes

    # 2단계: 모자이크는 원본을 매번 다른 범위로 잘라 붙이므로, 조각이 달라도 같은 원본일 수 있음.
    # 홀드 하나하나를 잘라 지각 해시로 비교해서, 같은 홀드가 들어 있는 조각끼리는 같은 원본 사진으로 묶고(학습/테스트 분할 단위),
    # 같은 홀드는 한 번만 남김(중복 제거)
    parent = list(range(len(groups)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    crop_reps = []  # (해시, 조각 번호)
    crop_buckets = {}
    keep = [[] for _ in groups]
    dup_boxes = 0
    for gi, (h, tile, boxes, n) in enumerate(groups):
        tw, th = tile.size
        for c, x, y, w, hgt in boxes:
            pw, ph = max(8, w * tw), max(8, hgt * th)
            crop = tile.crop((round(x * tw - pw / 2), round(y * th - ph / 2), round(x * tw + pw / 2), round(y * th + ph / 2)))
            ch = (dhash(crop, 8) << 3) | c  # 거친 해시 + 종류(같은 종류끼리만 같은 홀드로 봄)
            match = None
            for band in range(8):  # 8비트씩 8칸: 6비트 이하 차이면 적어도 2칸은 같음
                for ri in crop_buckets.get((band, c, (ch >> (3 + band * 8)) & 0xFF), []):
                    if crop_reps[ri][0] & 7 == c and bin((crop_reps[ri][0] ^ ch) >> 3).count('1') <= NEAR_CROP:
                        match = ri
                        break
                if match is not None:
                    break
            if match is None:
                crop_reps.append((ch, gi))
                ri = len(crop_reps) - 1
                for band in range(8):
                    crop_buckets.setdefault((band, c, (ch >> (3 + band * 8)) & 0xFF), []).append(ri)
                keep[gi].append((c, x, y, w, hgt))
            else:
                dup_boxes += 1
                ra, rb = find(gi), find(crop_reps[match][1])
                if ra != rb:
                    parent[ra] = rb  # 같은 홀드가 들어 있는 조각 = 같은 원본 사진

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, 'train', 'images'))
    os.makedirs(os.path.join(OUT, 'train', 'labels'))
    from collections import Counter
    cnt = Counter()
    sources = {}
    written = 0
    for k, (h, tile, boxes, n) in enumerate(groups):
        if not keep[k]:
            continue  # 홀드가 모두 다른 조각과 겹치면 조각을 저장하지 않음
        src = sources.setdefault(find(k), len(sources))
        stem = f'hc_s{src:04d}t{k:05d}'  # s = 원본 사진 묶음(분할 단위), t = 조각
        tile.save(os.path.join(OUT, 'train', 'images', stem + '.jpg'), quality=92)
        written += 1
        with open(os.path.join(OUT, 'train', 'labels', stem + '.txt'), 'w', encoding='utf-8') as f:
            for c, x, y, w, hgt in keep[k]:
                f.write(f'{c} {x:.6f} {y:.6f} {w:.6f} {hgt:.6f}\n')
                cnt[names[c].lower()] += 1
    with open(os.path.join(OUT, 'data.yaml'), 'w', encoding='utf-8') as f:
        f.write('names: [' + ', '.join(f"'{n.lower()}'" for n in names) + ']\n')
        f.write('# HoldClassificatore v2.2 (Roboflow, CC BY 4.0) https://universe.roboflow.com/climbing-holds-classification/holdclassificatore_v2.2\n')
        f.write('# 2x2 모자이크를 4조각으로 나누고 같은 사진 조각은 하나만 남김(scripts/prepare_holdclassificatore.py)\n')

    print(f'모자이크 {files}장 → 홀드가 있는 조각 {len(tiles)}개 → 서로 다른 조각 {len(groups)}개 (같은 조각 {len(tiles) - len(groups)}개 제거)')
    print(f'홀드 단위 비교: 같은 홀드 {dup_boxes}개 제거 → 남은 조각 {written}개, 원본 사진 묶음 {len(sources)}개')
    print('가운데 선을 걸쳐 버린 상자:', crossing)
    print('남은 홀드 상자:', dict(cnt))
    print('결과:', OUT)


if __name__ == '__main__':
    main()
