"""실험의 ONNX 모델을 앱 모델 자리(public/models/holds)로 배포한다. 기존 Teachable Machine 모델은 public/models/holds_tm 으로 보존.
사용: python scripts/deploy_onnx.py experiment_009"""
import json, os, shutil, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
exp = os.path.join(ROOT, 'experiments', sys.argv[1])
cfg = json.load(open(os.path.join(exp, 'config.json'), encoding='utf-8'))
dst = os.path.join(ROOT, 'public', 'models', 'holds')
tm = os.path.join(ROOT, 'public', 'models', 'holds_tm')
if os.path.exists(os.path.join(dst, 'model.json')) and not os.path.exists(tm):
    shutil.copytree(dst, tm)  # baseline 보존
for f in os.listdir(dst):
    os.remove(os.path.join(dst, f))
shutil.copy(os.path.join(exp, 'model.onnx'), os.path.join(dst, 'model.onnx'))
json.dump({'format': 'onnx', 'labels': cfg['labels'], 'imageSize': 224, 'crop': 'tight', 'mean': [0.485, 0.456, 0.406], 'std': [0.229, 0.224, 0.225],
           'source': sys.argv[1], 'arch': cfg['arch'], 'data': cfg['data']}, open(os.path.join(dst, 'metadata.json'), 'w', encoding='utf-8'), indent=1)
src_attr = os.path.join(ROOT, 'dataset', cfg['data'], 'ATTRIBUTION.txt')
if os.path.exists(src_attr):
    shutil.copy(src_attr, os.path.join(dst, 'ATTRIBUTION.txt'))
print('배포:', sys.argv[1], cfg['arch'], cfg['labels'], f"{os.path.getsize(os.path.join(dst, 'model.onnx')) / 1e6:.1f}MB")
