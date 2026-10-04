"""보상 config 로드 + 커리큘럼 단계 override 적용"""
import copy
import json
import os

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'config', 'rewards.json')


def load_config(path: str = DEFAULT_PATH, stage=None) -> dict:
    with open(path, encoding='utf-8') as f:
        cfg = json.load(f)
    return apply_stage(cfg, stage) if stage is not None else cfg


def apply_stage(cfg: dict, stage) -> dict:
    """단계별 override: groups 는 기본 그룹 가중치에 곱하고, terms/params 는 덮어쓴다"""
    out = copy.deepcopy(cfg)
    st = cfg['stages'][str(stage)]
    for g, mul in st.get('groups', {}).items():
        out['groups'][g] = cfg['groups'][g] * mul
    out['terms'].update(st.get('terms', {}))
    out['params'].update(st.get('params', {}))
    out['fatigue'] = bool(st.get('fatigue', False))
    out['domain_randomization'] = bool(st.get('domain_randomization', False))
    out['stage'] = int(stage)
    return out
