"""PyTorch 홀드 분류기: ImageNet으로 미리 학습된 경량 모델을 홀드 crop 데이터로 fine-tuning.

기존 Teachable Machine(=MobileNet 전이학습)을 baseline으로 두고, 같은 test 세트로 비교한다.
- 데이터: dataset/<세트>/train, test (make_hold_dataset.py가 만든 224 letterbox crop, 원본 사진 단위 분할)
- 검증: train 안에서 원본 사진(그룹) 단위로 15%를 떼어 냄(같은 사진의 홀드가 train/val에 함께 들어가지 않게)
- 불균형: 클래스 가중치(빈도 역수) + 증강(좌우 반전, 회전, 크기·밝기·색 변화)
- 학습: 1단계 머리(분류층)만 → 2단계 전체를 낮은 학습률로, 검증 macro F1 기준 최고 모델 저장(조기 종료)
- 출력: experiments/<이름>/ predictions.json(report_metrics.py와 같은 형식), config.json, model.pt, model.onnx

사용: python scripts/train_torch.py --exp experiment_005 --arch mobilenet_v3_large [--data holds_base] [--drop volume]
"""
import argparse
import json
import os
import random
import re
import time
from collections import Counter, defaultdict

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from sklearn.metrics import f1_score
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def source_of(name):
    """원본 사진 그룹: Roboflow 파일은 UUID(같은 사진에서 나온 crop끼리 같음), 그 밖은 파일 이름 앞부분"""
    m = re.search(r'([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})', name, re.I)
    if m:
        return m.group(1)
    return re.sub(r'(_\d+)?\.(jpe?g|png)$', '', name, flags=re.I)


def list_split(d, split, labels):
    out = []
    for i, c in enumerate(labels):
        p = os.path.join(d, split, c)
        if not os.path.isdir(p):
            continue
        for f in sorted(os.listdir(p)):
            out.append((os.path.join(p, f), i, f'{c}/{f}'))
    return out


class Holds(Dataset):
    def __init__(self, items, tf):
        self.items, self.tf = items, tf

    def __len__(self):
        return len(self.items)

    def __getitem__(self, k):
        path, y, _ = self.items[k]
        return self.tf(Image.open(path).convert('RGB')), y


def build(arch, n):
    if arch == 'mobilenet_v3_small':
        m = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.IMAGENET1K_V1)
        m.classifier[3] = nn.Linear(m.classifier[3].in_features, n)
        head = m.classifier
    elif arch == 'mobilenet_v3_large':
        m = models.mobilenet_v3_large(weights=models.MobileNet_V3_Large_Weights.IMAGENET1K_V2)
        m.classifier[3] = nn.Linear(m.classifier[3].in_features, n)
        head = m.classifier
    elif arch == 'efficientnet_b0':
        m = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
        m.classifier[1] = nn.Linear(m.classifier[1].in_features, n)
        head = m.classifier
    else:
        raise ValueError(arch)
    return m, head


def evaluate(model, loader):
    model.eval()
    ys, ps, probs = [], [], []
    with torch.no_grad():
        for x, y in loader:
            pr = torch.softmax(model(x), 1)
            probs.append(pr.numpy())
            ps += pr.argmax(1).tolist()
            ys += y.tolist()
    return np.array(ys), np.array(ps), np.concatenate(probs) if probs else np.zeros((0, 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--exp', required=True)
    ap.add_argument('--arch', default='mobilenet_v3_large')
    ap.add_argument('--data', default='holds_base')
    ap.add_argument('--drop', nargs='*', default=[], help='뺄 클래스(예: volume — 볼륨은 모양으로 판정)')
    ap.add_argument('--epochs_head', type=int, default=6)
    ap.add_argument('--epochs', type=int, default=25)
    ap.add_argument('--seed', type=int, default=0)
    a = ap.parse_args()
    random.seed(a.seed)
    np.random.seed(a.seed)
    torch.manual_seed(a.seed)
    torch.set_num_threads(max(1, os.cpu_count() or 1))

    d = os.path.join(ROOT, 'dataset', a.data)
    labels = sorted(c for c in os.listdir(os.path.join(d, 'train')) if c not in a.drop)
    train_all = list_split(d, 'train', labels)
    test = list_split(d, 'test', labels)
    manifest = {i['file']: i.get('origin', 'unknown') for i in json.load(open(os.path.join(d, 'test_manifest.json'), encoding='utf-8'))['items']}

    # 원본 사진 그룹 단위로 검증 세트 분리(클래스마다 약 15%)
    groups = defaultdict(list)
    for it in train_all:
        groups[(it[1], source_of(os.path.basename(it[0])))].append(it)
    train, val = [], []
    by_cls = defaultdict(list)
    for (c, g), its in groups.items():
        by_cls[c].append(its)
    for c, gl in by_cls.items():
        random.shuffle(gl)
        n = sum(len(x) for x in gl)
        acc = 0
        for its in gl:
            (val if acc < 0.15 * n else train).extend(its)
            acc += len(its) if acc < 0.15 * n else 0
    tr_groups = {source_of(os.path.basename(p)) for p, _, _ in train}
    leak = sum(source_of(os.path.basename(p)) in tr_groups for p, _, _ in val)
    cnt = Counter(y for _, y, _ in train)
    print('클래스', labels)
    print('train', {labels[k]: v for k, v in sorted(cnt.items())}, 'val', dict(Counter(labels[y] for _, y, _ in val)), 'test', dict(Counter(labels[y] for _, y, _ in test)), '그룹 누수', leak)

    norm = transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    tf_train = transforms.Compose([
        transforms.RandomResizedCrop(224, scale=(0.75, 1.0), ratio=(0.85, 1.15)),
        transforms.RandomHorizontalFlip(),  # 좌우 반전은 홀드 종류를 바꾸지 않음(상하 반전은 저그↔언더클링처럼 바뀔 수 있어 안 씀)
        transforms.RandomRotation(15, fill=128),
        transforms.ColorJitter(0.35, 0.35, 0.3, 0.05),
        transforms.RandomGrayscale(0.1),  # 홀드 색이 아니라 모양을 보도록
        transforms.ToTensor(),
        norm,
    ])
    tf_eval = transforms.Compose([transforms.Resize((224, 224)), transforms.ToTensor(), norm])
    dl_train = DataLoader(Holds(train, tf_train), batch_size=32, shuffle=True, num_workers=0)
    dl_val = DataLoader(Holds(val, tf_eval), batch_size=64)
    dl_test = DataLoader(Holds(test, tf_eval), batch_size=64)

    model, head = build(a.arch, len(labels))
    w = torch.tensor([len(train) / (len(labels) * max(1, cnt[i])) for i in range(len(labels))], dtype=torch.float)
    lossf = nn.CrossEntropyLoss(weight=w, label_smoothing=0.05)

    best = (-1, None, -1)
    log = []
    t0 = time.time()
    for phase, epochs, params, lr in [('head', a.epochs_head, head.parameters(), 1e-3), ('all', a.epochs, model.parameters(), 2e-4)]:
        for p in model.parameters():
            p.requires_grad = phase == 'all'
        for p in head.parameters():
            p.requires_grad = True
        opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=lr, weight_decay=1e-4)
        sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, max(1, epochs))
        stale = 0
        for ep in range(epochs):
            model.train()
            tl = 0.0
            for x, y in dl_train:
                opt.zero_grad()
                loss = lossf(model(x), y)
                loss.backward()
                opt.step()
                tl += loss.item() * len(y)
            sched.step()
            ys, ps, _ = evaluate(model, dl_val)
            f1 = f1_score(ys, ps, average='macro')
            acc = float((ys == ps).mean())
            log.append({'phase': phase, 'epoch': ep, 'loss': tl / len(train), 'val_acc': acc, 'val_f1': f1})
            print(f'{phase} {ep:2d} loss {tl / len(train):.3f} val acc {acc:.3f} macro-F1 {f1:.3f}  ({time.time() - t0:.0f}s)')
            if f1 > best[0]:
                best = (f1, {k: v.clone() for k, v in model.state_dict().items()}, len(log) - 1)
                stale = 0
            else:
                stale += 1
                if phase == 'all' and stale >= 8:
                    break

    model.load_state_dict(best[1])
    out = os.path.join(ROOT, 'experiments', a.exp)
    os.makedirs(out, exist_ok=True)
    t1 = time.time()
    ys, ps, pr = evaluate(model, dl_test)
    ms = (time.time() - t1) / max(1, len(test)) * 1000
    items = []
    for (path, y, rel), p, prob in zip(test, ps, pr):
        items.append({'file': rel, 'origin': manifest.get(rel, 'unknown'), 'true': labels[y], 'pred': labels[p], 'prob': float(prob[p]), 'probs': {labels[k]: float(prob[k]) for k in range(len(labels))}})
    json.dump({'labels': labels, 'items': items}, open(os.path.join(out, 'predictions.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump({'arch': a.arch, 'data': a.data, 'dropped': a.drop, 'labels': labels, 'train': len(train), 'val': len(val), 'test': len(test), 'val_group_leak': leak,
               'class_weight': w.tolist(), 'best_val_macro_f1': best[0], 'best_epoch': log[best[2]], 'cpu_ms_per_image': ms, 'log': log, 'seed': a.seed},
              open(os.path.join(out, 'config.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    torch.save(model.state_dict(), os.path.join(out, 'model.pt'))
    model.eval()
    torch.onnx.export(model, torch.randn(1, 3, 224, 224), os.path.join(out, 'model.onnx'), input_names=['input'], output_names=['logits'], opset_version=17, dynamo=False)
    print(f'test 정확도 {(ys == ps).mean():.3f}, 이미지당 {ms:.1f}ms(CPU) → {out}')


if __name__ == '__main__':
    main()
