"""테스트 사진을 224x224 RGB 픽셀 파일로 저장(Node에서 모델 평가할 때 사용).

사용: python scripts/export_test_pixels.py [데이터 폴더=dataset/holds_public]
결과: <폴더>/test_pixels.bin (N x 224 x 224 x 3, uint8), <폴더>/test_index.json (파일·정답·출처)
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, sys.argv[1] if len(sys.argv) > 1 else os.path.join('dataset', 'holds_public'))
SIZE = 224

man = os.path.join(BASE, 'test_manifest.json')
items = json.load(open(man, encoding='utf-8'))['items'] if os.path.exists(man) else [
    {'file': f'{c}/{f}', 'label': c, 'origin': 'unknown'} for c in sorted(os.listdir(os.path.join(BASE, 'test'))) for f in sorted(os.listdir(os.path.join(BASE, 'test', c)))]
with open(os.path.join(BASE, 'test_pixels.bin'), 'wb') as f:
    for it in items:
        f.write(Image.open(os.path.join(BASE, 'test', it['file'])).convert('RGB').resize((SIZE, SIZE)).tobytes())
json.dump({'size': SIZE, 'items': items}, open(os.path.join(BASE, 'test_index.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print(len(items), '장 저장:', BASE)
