"""Roboflow Universe 'ClinbingHoldType'(CC BY 4.0, 실제 벽 홀드 crop 2,369장)으로 학습 세트를 만든다.

- 입력: dataset/raw_cht/ClinbingHoldType.v1i.folder/{train,valid,test}/<Class>/*.jpg
- 클래스: 앱과 같은 5종류(jug, crimp, pinch, pocket, sloper). Foothold/Other는 뺌(앱의 손 그립 종류가 아님)
- 전처리: 비율을 유지한 채 224 회색(128) 바탕 가운데에 놓음(앱의 tight crop + letterbox와 같게)
- train = CHT train + valid + 기존 holds_base train(같은 5종류), test = CHT test(origin cht) + holds_base test(origin capstone)
- 누수 방지: test와 지각 해시(dHash 8x8, 해밍 거리 ≤ 4)가 거의 같은 train 이미지는 뺌
출력: dataset/holds_cht/{train,test}/<class>/, test_manifest.json, ATTRIBUTION.txt
"""
import json
import os
import shutil

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'dataset', 'raw_cht', 'ClinbingHoldType.v1i.folder')
BASE = os.path.join(ROOT, 'dataset', 'holds_base')
OUT = os.path.join(ROOT, 'dataset', 'holds_cht')
MAP = {'Jug': 'jug', 'Crimp': 'crimp', 'Pinch': 'pinch', 'Pocket': 'pocket', 'Sloper': 'sloper'}
CLASSES = sorted(MAP.values())


def letterbox(im, size=224):
    im = im.convert('RGB')
    w, h = im.size
    k = size / max(w, h)
    im = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.BICUBIC)
    out = Image.new('RGB', (size, size), (128, 128, 128))
    out.paste(im, ((size - im.width) // 2, (size - im.height) // 2))
    return out


def dhash(im):
    g = np.asarray(im.convert('L').resize((9, 8), Image.BILINEAR), dtype=np.int16)
    return np.packbits((g[:, 1:] > g[:, :-1]).flatten())


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    test_items, test_hashes = [], []
    # test 먼저: CHT test + 기존 실제 사진 test
    for cls_src, cls in MAP.items():
        d = os.path.join(SRC, 'test', cls_src)
        for f in sorted(os.listdir(d)):
            im = letterbox(Image.open(os.path.join(d, f)))
            os.makedirs(os.path.join(OUT, 'test', cls), exist_ok=True)
            im.save(os.path.join(OUT, 'test', cls, 'cht_' + f))
            test_items.append({'file': f'{cls}/cht_{f}', 'label': cls, 'origin': 'cht'})
            test_hashes.append(dhash(im))
    man = {i['file']: i for i in json.load(open(os.path.join(BASE, 'test_manifest.json'), encoding='utf-8'))['items']}
    for cls in CLASSES:
        d = os.path.join(BASE, 'test', cls)
        for f in sorted(os.listdir(d)):
            im = Image.open(os.path.join(d, f)).convert('RGB')
            im.save(os.path.join(OUT, 'test', cls, f))
            test_items.append({'file': f'{cls}/{f}', 'label': cls, 'origin': man.get(f'{cls}/{f}', {}).get('origin', 'capstone')})
            test_hashes.append(dhash(im))
    H = np.stack(test_hashes)

    def near_test(im):
        h = dhash(im)
        return int(np.unpackbits(H ^ h, axis=1).sum(1).min()) <= 4

    kept, dropped = {c: 0 for c in CLASSES}, 0
    srcs = [(os.path.join(SRC, sp, cs), cls, 'cht_') for sp in ('train', 'valid') for cs, cls in MAP.items()]
    srcs += [(os.path.join(BASE, 'train', cls), cls, '') for cls in CLASSES]
    for d, cls, pre in srcs:
        os.makedirs(os.path.join(OUT, 'train', cls), exist_ok=True)
        for f in sorted(os.listdir(d)):
            im = Image.open(os.path.join(d, f))
            im = letterbox(im) if pre else im.convert('RGB')
            if near_test(im):
                dropped += 1
                continue
            im.save(os.path.join(OUT, 'train', cls, pre + f))
            kept[cls] += 1
    json.dump({'items': test_items}, open(os.path.join(OUT, 'test_manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    open(os.path.join(OUT, 'ATTRIBUTION.txt'), 'w', encoding='utf-8').write(
        'ClinbingHoldType Dataset by Personal, Roboflow Universe, CC BY 4.0\n'
        'https://universe.roboflow.com/personal-9wu84/clinbingholdtype\n'
        '+ hold classification (Capstone), Roboflow Universe, CC BY 4.0\n')
    from collections import Counter
    print('train', kept, '· test와 거의 같아 뺀 train', dropped)
    print('test', dict(Counter((i['origin'], i['label']) for i in test_items)))


if __name__ == '__main__':
    main()
