"""홀드 데이터셋 품질 분석: 개수, 해상도, 손상 파일, 중복(SHA256·지각 해시), 학습/테스트 누수.

사용: python scripts/analyze_dataset.py [폴더=dataset/holds]
결과: 화면 출력 + <폴더>/analysis.json + <폴더>/samples.jpg(종류별 샘플)
"""
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, sys.argv[1] if len(sys.argv) > 1 else os.path.join('dataset', 'holds'))


def dhash(im, n=8):
    """지각 해시(dHash): 크기·압축이 조금 달라도 비슷한 사진은 같은 값에 가까움"""
    g = im.convert('L').resize((n + 1, n), Image.LANCZOS)
    px = list(g.getdata())
    bits = 0
    for y in range(n):
        for x in range(n):
            bits = (bits << 1) | (px[y * (n + 1) + x] > px[y * (n + 1) + x + 1])
    return bits


def source_of(fn):
    """잘라낸 사진의 원본 사진 이름(같은 원본에서 나온 사진끼리 묶기 위함)"""
    stem = os.path.splitext(fn)[0]
    if stem.startswith('extra_'):
        return re.sub(r'_bg\d+$', '', stem)
    m = re.match(r'(train|valid|test)_(.+)_\d+$', stem)
    stem = m.group(2) if m else stem
    hc = re.match(r'(hc_s\d+)t\d+$', stem)  # HoldClassificatore 원본 사진 묶음
    return hc.group(1) if hc else stem


items = []
broken = []
for part in ('train', 'test'):
    d = os.path.join(BASE, part)
    if not os.path.isdir(d):
        continue
    for cls in sorted(os.listdir(d)):
        for fn in sorted(os.listdir(os.path.join(d, cls))):
            path = os.path.join(d, cls, fn)
            try:
                im = Image.open(path)
                im.load()
            except Exception as e:  # 손상된 이미지
                broken.append((path, str(e)))
                continue
            items.append({
                'part': part, 'cls': cls, 'file': fn, 'size': im.size,
                'sha': hashlib.sha256(open(path, 'rb').read()).hexdigest(),
                'dhash': dhash(im), 'src': source_of(fn),
            })

count = Counter((i['part'], i['cls']) for i in items)
classes = sorted({i['cls'] for i in items})
print('종류별 개수 (학습 / 테스트)')
for c in classes:
    print(f'  {c:8s} {count[("train", c)]:5d} / {count[("test", c)]:4d}')
print('해상도:', dict(Counter(i['size'] for i in items)))
print('손상 이미지:', len(broken))

# 완전 중복(SHA256)과 거의 같은 사진(dHash 차이 4비트 이하)
by_sha = defaultdict(list)
for i in items:
    by_sha[i['sha']].append(i)
exact = [g for g in by_sha.values() if len(g) > 1]
near = []
for a in range(len(items)):
    for b in range(a + 1, len(items)):
        if bin(items[a]['dhash'] ^ items[b]['dhash']).count('1') <= 4 and items[a]['sha'] != items[b]['sha']:
            near.append((items[a], items[b]))
print('완전 중복 묶음:', len(exact), '· 거의 같은 사진 쌍:', len(near))

# 누수: 같은 원본 사진(또는 거의 같은 사진)이 학습과 테스트에 함께 있는지
src_parts = defaultdict(set)
for i in items:
    src_parts[i['src']].add(i['part'])
leak_src = sorted(s for s, ps in src_parts.items() if len(ps) > 1)
leak_near = [(a, b) for a, b in near if a['part'] != b['part']]
leak_exact = [g for g in exact if len({i['part'] for i in g}) > 1]
test_total = sum(1 for i in items if i['part'] == 'test')
test_leaky = sum(1 for i in items if i['part'] == 'test' and i['src'] in leak_src)
print(f'누수: 원본 사진이 학습·테스트에 함께 있는 경우 {len(leak_src)}개 → 테스트 {test_total}장 중 {test_leaky}장이 해당')
print(f'      학습·테스트에 걸친 완전 중복 {len(leak_exact)}묶음, 거의 같은 사진 {len(leak_near)}쌍')

json.dump({
    'counts': {f'{p}/{c}': n for (p, c), n in sorted(count.items())},
    'resolutions': {f'{w}x{h}': n for (w, h), n in Counter(i['size'] for i in items).items()},
    'broken': broken,
    'exact_duplicate_groups': [[f"{i['part']}/{i['cls']}/{i['file']}" for i in g] for g in exact],
    'near_duplicate_pairs': [[f"{a['part']}/{a['cls']}/{a['file']}", f"{b['part']}/{b['cls']}/{b['file']}"] for a, b in near],
    'leak_sources': leak_src,
    'test_items_with_leaky_source': test_leaky,
}, open(os.path.join(BASE, 'analysis.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# 종류별 샘플 시트(사람이 라벨을 눈으로 확인)
n, s = 10, 96
sheet = Image.new('RGB', (s * n + 80, s * len(classes)), (25, 25, 25))
dr = ImageDraw.Draw(sheet)
for r, c in enumerate(classes):
    dr.text((5, r * s + s // 2), c, fill=(255, 220, 0))
    files = [i for i in items if i['cls'] == c and i['part'] == 'train'][:n]
    for k, i in enumerate(files):
        sheet.paste(Image.open(os.path.join(BASE, 'train', c, i['file'])).convert('RGB').resize((s, s)), (80 + k * s, r * s))
sheet.save(os.path.join(BASE, 'samples.jpg'), quality=88)
print('결과:', os.path.join(BASE, 'analysis.json'), os.path.join(BASE, 'samples.jpg'))
