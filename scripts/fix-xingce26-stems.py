#!/usr/bin/env python3
"""一次性修复 2026 卷数据错乱（2026-09-12 审计确认）：

T1 副省级 38-45（8 题）：题干截断在「依次」，从试卷 PDF 重提完整题干
T2 行政执法 130：题干只剩「以下柱状图反映了」，同法重提
T3 副省级 38：源 PDF 排版把「就像足球比赛中的防守反击战术…」重复排了一遍，
   保留第二处（「就如同…」起句连贯），删除第一处碎片

修复直接写回 data/xingce/*.json（indent=2 + 尾换行），重跑 import-xingce.mjs 入库。
"""
import json
import re
from pathlib import Path

import pymupdf

PAPER_DIR = Path(
    '/Users/tomcat/Documents/docs/【01】国考真题资料/国考2000-2026真题pdf 【推荐用这个版本】'
    '/26国考行测+申论真题解析【26年】/26行测真题试卷'
)
JSON_DIR = Path('data/xingce')

# 试卷 PDF 全文（按层名缓存）
_cache: dict[str, str] = {}


def pdf_text(level_kw: str) -> str:
    if level_kw not in _cache:
        pdf = next(PAPER_DIR.glob(f'*{level_kw}*.pdf'))
        doc = pymupdf.open(str(pdf))
        _cache[level_kw] = '\n'.join(p.get_text() for p in doc)
    return _cache[level_kw]


def extract_stem(level_kw: str, n: int, next_n: int) -> str:
    """PDF 里题号 n 的题干 = 「n.」之后、选项「A.」之前的文本（去换行、去空格差异）"""
    t = pdf_text(level_kw)
    m = re.search(rf'(?<!\d){n}[.．]\s*(.*?)A[.．]', t, re.S)
    if not m:
        raise SystemExit(f'{level_kw} {n} 题在 PDF 中未定位到')
    stem = m.group(1).replace('\n', '')
    # PDF 提取在数字与单位间带空格（「13 家」「2025 年」），与既有数据风格一致，保留原样
    stem = re.sub(r'\s+', ' ', stem).strip()
    if not stem:
        raise SystemExit(f'{level_kw} {n} 题干提取为空')
    return stem


def dedup_38(stem: str) -> str:
    """T3：删掉第一处重复碎片「就像足球比赛中的防守反击战术，先得保证自己不冒进、不失球、______，」"""
    frag = '就像足球比赛中的防守反击战术，先得保证自己不冒进、不失球、______，'
    if stem.count(frag) < 1 or '就如同足球比赛中的防守反击战术' not in stem:
        raise SystemExit('38 题重复句形态与预期不符，请人工核对')
    return stem.replace(frag, '', 1)


def main():
    fixes = [
        ('副省级', '副省级', [38, 39, 40, 41, 42, 43, 44, 45], {38: dedup_38}),
        ('行政执法', '行政执法', [130], {}),
    ]
    for json_kw, pdf_kw, ids, post in fixes:
        path = JSON_DIR / f'guokao-xingce-2026-{json_kw}.json'
        paper = json.loads(path.read_text())
        qs = {q['idx']: q for q in paper['questions']}
        for n in ids:
            stem = extract_stem(pdf_kw, n, n + 1)
            if n in post:
                stem = post[n](stem)
            old = qs[n]['stem']
            qs[n]['stem'] = stem
            print(f'{json_kw} {n}:')
            print(f'  旧: {old[-30:]!r}')
            print(f'  新: {stem[:60]}…{stem[-25:]!r}')
        path.write_text(json.dumps(paper, ensure_ascii=False, indent=2) + '\n')
    print('✓ JSON 已修复，请重跑 node scripts/import-xingce.mjs 入库')


main()
