"""애매한 사례 모으기: 1등과 2등 확률 차이가 0.2 미만이거나 틀린 test 항목 → experiments/<실험>/ambiguous.json
사용: python scripts/ambiguous.py experiment_005"""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = os.path.join(ROOT, 'experiments', sys.argv[1])
items = json.load(open(os.path.join(d, 'predictions.json'), encoding='utf-8'))['items']
out = []
for i in items:
    top = sorted(i['probs'].items(), key=lambda kv: -kv[1])
    gap = top[0][1] - top[1][1]
    if gap < 0.2 or i['true'] != i['pred']:
        out.append({'file': i['file'], 'true': i['true'], 'pred': i['pred'], 'top2': [[k, round(v, 3)] for k, v in top[:2]], 'gap': round(gap, 3), 'wrong': i['true'] != i['pred']})
out.sort(key=lambda x: (not x['wrong'], x['gap']))
json.dump(out, open(os.path.join(d, 'ambiguous.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"{sys.argv[1]}: 애매하거나 틀린 {len(out)}/{len(items)}개 (틀림 {sum(x['wrong'] for x in out)})")
