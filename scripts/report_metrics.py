"""experiments/<이름>/predictions.json 으로 지표를 계산해 metrics.json, confusion_matrix.png 저장.

사용: python scripts/report_metrics.py <실험 이름> [설명]
"""
import json
import os
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
name = sys.argv[1] if len(sys.argv) > 1 else 'experiment_000'
d = os.path.join(ROOT, 'experiments', name)
pred = json.load(open(os.path.join(d, 'predictions.json'), encoding='utf-8'))
labels = sorted(set(pred['labels']))
y = [i['true'] for i in pred['items']]
p = [i['pred'] for i in pred['items']]

acc = accuracy_score(y, p)
P, R, F, N = precision_recall_fscore_support(y, p, labels=labels, zero_division=0)
cm = confusion_matrix(y, p, labels=labels)
per = {c: {'precision': round(float(P[k]), 3), 'recall': round(float(R[k]), 3), 'f1': round(float(F[k]), 3), 'test_count': int(N[k])} for k, c in enumerate(labels)}
metrics = {
    'accuracy': round(acc, 4),
    'macro_precision': round(float(P.mean()), 4),
    'macro_recall': round(float(R.mean()), 4),  # 종류별 정답률(recall)의 평균 = 종류별 평균 정확도
    'macro_f1': round(float(F.mean()), 4),
    'test_total': len(y),
    'per_class': per,
    'confusion_matrix': {'labels': labels, 'rows_true_cols_pred': cm.tolist()},
}
# 출처별(실제 사진 Capstone / 공개 데이터 등) 정확도와 macro F1
by_origin = {}
for org in sorted({i.get('origin', 'unknown') for i in pred['items']}):
    yo = [i['true'] for i in pred['items'] if i.get('origin', 'unknown') == org]
    po = [i['pred'] for i in pred['items'] if i.get('origin', 'unknown') == org]
    _, _, fo, _ = precision_recall_fscore_support(yo, po, labels=sorted(set(yo)), zero_division=0)
    by_origin[org] = {'n': len(yo), 'accuracy': round(accuracy_score(yo, po), 4), 'macro_f1': round(float(fo.mean()), 4)}
metrics['by_origin'] = by_origin
json.dump(metrics, open(os.path.join(d, 'metrics.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

fig, ax = plt.subplots(figsize=(6.2, 5.4))
ax.imshow(cm, cmap='Blues')
ax.set_xticks(range(len(labels)), labels, rotation=30)
ax.set_yticks(range(len(labels)), labels)
ax.set_xlabel('predicted')
ax.set_ylabel('true')
for i in range(len(labels)):
    for j in range(len(labels)):
        ax.text(j, i, cm[i, j], ha='center', va='center', color='white' if cm[i, j] > cm.max() / 2 else 'black')
ax.set_title(f'{name}  acc {acc:.1%}  macro-F1 {F.mean():.2f}')
fig.tight_layout()
fig.savefig(os.path.join(d, 'confusion_matrix.png'), dpi=120)

print(f'{name}: 정확도 {acc:.1%}, macro F1 {F.mean():.3f}, 종류별 평균 정확도 {R.mean():.1%}')
for org, v in by_origin.items():
    print(f'  출처 {org}: {v["n"]}장, 정확도 {v["accuracy"]:.1%}, macro F1 {v["macro_f1"]:.3f}')
print(f"{'종류':8s} {'정밀도':>6s} {'재현율':>6s} {'F1':>6s} {'테스트수':>6s}")
for c in labels:
    v = per[c]
    print(f"{c:8s} {v['precision']:6.2f} {v['recall']:6.2f} {v['f1']:6.2f} {v['test_count']:6d}")
