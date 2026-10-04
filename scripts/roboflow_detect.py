"""Roboflow Cloud 워크플로로 벽 사진에서 홀드 위치를 찾는다(홀드 검출만: 그립 종류·색은 판별하지 않음).

준비:
    pip install inference-sdk
    API 키는 환경변수 ROBOFLOW_API_KEY 로만 읽음(코드에 적거나 출력하지 않음)
      PowerShell:  $env:ROBOFLOW_API_KEY = "..."
      bash:        export ROBOFLOW_API_KEY=...

사용 예:
    python scripts/roboflow_detect.py testimage/4-1.jpg
"""
import os
import sys

from inference_sdk import InferenceConfiguration, InferenceHTTPClient

API_URL = 'https://serverless.roboflow.com'
WORKSPACE = '-wodfh'
WORKFLOW_ID = 'climb-hold-detector'
PARAMS = {'confidence': 0.4, 'iou_threshold': 0.3, 'class_agnostic_nms': False, 'max_detections': 1000}


def _client():
    key = os.environ.get('ROBOFLOW_API_KEY')
    if not key:
        raise RuntimeError('환경변수 ROBOFLOW_API_KEY 가 설정되지 않았어요')
    return InferenceHTTPClient(api_url=API_URL, api_key=key).configure(InferenceConfiguration(api_key_transport='header'))


def _find_predictions(obj):
    """워크플로 결과 안에서 검출 목록(x, y, width, height, confidence가 있는 dict 리스트)을 찾아 모두 모음"""
    found = []
    if isinstance(obj, dict):
        if all(k in obj for k in ('x', 'y', 'width', 'height', 'confidence')):
            return [obj]
        for v in obj.values():
            found += _find_predictions(v)
    elif isinstance(obj, list):
        for v in obj:
            found += _find_predictions(v)
    return found


def detect_holds(image_path):
    """로컬 이미지에서 홀드를 검출.
    반환: [{'x0','y0','x1','y1'(픽셀, 상자 모서리), 'cx','cy','w','h'(중심·크기), 'confidence'}] — 신뢰도 높은 순
    """
    result = _client().run_workflow(
        workspace_name=WORKSPACE,
        workflow_id=WORKFLOW_ID,
        images={'image': image_path},
        parameters=PARAMS,
        use_cache=True,
    )
    holds = []
    for p in _find_predictions(result):
        cx, cy, w, h = float(p['x']), float(p['y']), float(p['width']), float(p['height'])
        holds.append({'x0': cx - w / 2, 'y0': cy - h / 2, 'x1': cx + w / 2, 'y1': cy + h / 2,
                      'cx': cx, 'cy': cy, 'w': w, 'h': h, 'confidence': float(p['confidence'])})
    holds.sort(key=lambda d: -d['confidence'])
    return holds


if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'testimage', '4-1.jpg')
    holds = detect_holds(path)
    print(f'{path}: 홀드 {len(holds)}개')
    for d in holds[:10]:
        print(f"  상자 ({d['x0']:.0f},{d['y0']:.0f})-({d['x1']:.0f},{d['y1']:.0f})  신뢰도 {d['confidence']:.2f}")
