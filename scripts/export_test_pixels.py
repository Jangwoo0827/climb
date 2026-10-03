"""dataset/holds/test 사진을 224x224 RGB 픽셀 파일로 저장(Node에서 모델 평가할 때 사용).

결과: dataset/holds/test_pixels.bin (N x 224 x 224 x 3, uint8), dataset/holds/test_index.json
"""
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST = os.path.join(ROOT, 'dataset', 'holds', 'test')
SIZE = 224

items = []
with open(os.path.join(ROOT, 'dataset', 'holds', 'test_pixels.bin'), 'wb') as f:
    for cls in sorted(os.listdir(TEST)):
        for fn in sorted(os.listdir(os.path.join(TEST, cls))):
            im = Image.open(os.path.join(TEST, cls, fn)).convert('RGB').resize((SIZE, SIZE))
            f.write(im.tobytes())
            items.append({'file': f'{cls}/{fn}', 'label': cls})
json.dump({'size': SIZE, 'items': items}, open(os.path.join(ROOT, 'dataset', 'holds', 'test_index.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print(len(items), '장 저장')
