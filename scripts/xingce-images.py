#!/usr/bin/env python3
"""行测真题图表 → PNG（data URL）回填 JSON

思路：不再 OCR（2026-09-08 用户裁定识别质量不达刷题标准），改为从「试卷」PDF 把
资料分析材料图表、图形推理题整块裁成 PNG，base64 存进 JSON：
- 题组材料 → questions[].groupImage（JSON 数组字符串，跨页材料为多张）
- 被丢的图形推理/图片选项题 → 恢复整题：image + stem + answer/explanation（解析 PDF 补）

用法：python3 scripts/xingce-images.py <试卷目录> <解析目录> <json目录>
定位策略：行级 bbox 文本 → 题号候选链（严格递增，跳过卷首「注意事项 1.」类伪题号）
"""
import base64
import json
import re
import sys
from pathlib import Path

import pymupdf

GROUP_RE = re.compile(r"^[一二三四五六七八九十]+、\s*根据以下资料，?回答?\s*(\d+)\s*[-—–~至]\s*(\d+)\s*题")
ZILIAO_RE = re.compile(r"资料分析")
PAREN_GROUP_RE = re.compile(r"^[（(][一二三四五六七八九十][)）]\s*$")  # 行政执法卷组头「(一)」样式
QNUM_RE = re.compile(r"^(\d{1,3})[.．]\s*")
OPT_SPLIT_RE = re.compile(r"(?:^|\n|\s)([A-E])[．.]\s*")
ANS_RE = re.compile(r"^(\d{1,3})[.．]\s*([A-E])\s*项?。", re.M)
PAGEFOOT_RE = re.compile(r"第\d+页[,，]?\s*共?\d*页?|^第\s*\d+\s*部分|^\d{1,3}$")
ZOOM = 2.5
PAGE_MARGIN_X = 40
PAGE_MARGIN_Y = 36
FOOTER = 40  # 页脚广告/页码区


def page_lines(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            text = "".join(s["text"] for s in l["spans"]).strip()
            if text:
                out.append((pymupdf.Rect(l["bbox"]), text))
    return out


def build_index(doc):
    """[(page_no, rect, text)] 全文行索引 + 题号候选"""
    lines = []
    for pno in range(len(doc)):
        for rect, text in page_lines(doc[pno]):
            lines.append((pno, rect, text))
    return lines


def question_chain(lines, max_q):
    """题号 n → (page, rect)：在全文行序里为 1..max_q 挑一条严格递增的候选链"""
    chain = {}
    cur = (-1, pymupdf.Rect(0, 0, 0, 0))
    for n in range(1, max_q + 1):
        found = None
        for pno, rect, text in lines:
            if (pno, rect.y0) <= (cur[0], cur[1].y0):
                continue
            m = QNUM_RE.match(text)
            if m and int(m.group(1)) == n:
                found = (pno, rect)
                break
        if not found:
            continue  # 该卷没有这个题号（各级卷题量不同）
        chain[n] = found
        cur = found
    return chain


def crop_pngs(doc, start, end):
    """(page, y0, y1) 序列 → PNG bytes 列表。start/end 为 (pno, y) 定位点"""
    sp, sy = start
    ep, ey = end
    spans = []
    if ep == sp:
        spans.append((sp, sy, ey))
    else:
        spans.append((sp, sy, doc[sp].rect.height - FOOTER))
        for p in range(sp + 1, ep):
            spans.append((p, PAGE_MARGIN_Y, doc[p].rect.height - FOOTER))
        spans.append((ep, PAGE_MARGIN_Y, ey))
    out = []
    for pno, y0, y1 in spans:
        if y1 - y0 < 8:
            continue
        clip = pymupdf.Rect(PAGE_MARGIN_X, y0, doc[pno].rect.width - PAGE_MARGIN_X, y1)
        pix = doc[pno].get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), clip=clip)
        png = pix.tobytes("png")
        if len(png) < 20_000:
            continue  # 近空白裁片（组头页尾、页码残留）
        out.append(png)
    return out


def to_dataurls(pngs):
    return json.dumps(["data:image/png;base64," + base64.b64encode(b).decode() for b in pngs])


def parse_answers(pdf: Path):
    """解析 PDF → {题号: (答案, 解析文本)}"""
    import pypdf

    text = "\n".join((p.extract_text() or "") for p in pypdf.PdfReader(str(pdf)).pages)
    marks = list(ANS_RE.finditer(text))
    out = {}
    for i, m in enumerate(marks):
        seg_end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        seg = text[m.end():seg_end]
        seg = re.sub(r"要成公[，,]?选优公|优公教育|版权所有.*|^\d{1,3}$", "", seg, flags=re.M).strip()
        out[int(m.group(1))] = (m.group(2), seg if len(seg) > 15 else None)
    return out


def split_stem_options(raw):
    """题干文本里若带 A. B. 选项行则拆出；否则选项留空（图片形态）。
    拆出的选项必须是完整的 A-D 且文本非空，否则视为图片选项（纯图片选项题 A./B. 空标记）。"""
    m = re.search(r"(?:^|\n|\s)([A-E])[．.]\s*", raw)
    stem0 = raw[: m.start()] if m else raw
    parts = OPT_SPLIT_RE.split(raw)
    keys = parts[1::2]
    texts = [t.strip() for t in parts[2::2]]
    if keys[:4] == list("ABCD") and len(texts) >= 4 and all(len(t) >= 2 for t in texts[:4]):
        return parts[0].strip(), [{"key": keys[i], "text": texts[i]} for i in range(4)]
    return stem0.strip(), []


def process(json_path: Path, paper_pdf: Path, ans_pdf: Path):
    paper = json.loads(json_path.read_text())
    existing = {q["idx"] for q in paper["questions"]}
    max_q = max(existing)
    doc = pymupdf.open(str(paper_pdf))
    lines = build_index(doc)
    chain = question_chain(lines, max_q + 1)

    # 0) 组头定位：两种卷式——「一、根据以下资料，回答 116-120题」/「六.资料分析：」+「(一)」
    headers = []  # [(order_idx, start, end, (pno, y1))]，start/end 可能为 None（(一) 式不带题号）
    in_ziliao = False
    for li, (pno, rect, text) in enumerate(lines):
        if ZILIAO_RE.search(text) and len(text) < 15:
            in_ziliao = True
        gm = GROUP_RE.match(text)
        pgm = PAREN_GROUP_RE.match(text) if in_ziliao else None
        if gm or pgm:
            headers.append((li, int(gm.group(1)) if gm else None, int(gm.group(2)) if gm else None, (pno, rect.y1)))

    json_groups = sorted({q["groupId"] for q in paper["questions"] if q.get("groupId")})
    # 恢复题的裁图下界：下一个题号 / 下一个组头，取更近者
    def bound_after(n, pos):
        cands = []
        nxt_q = next((p for p in range(n + 1, max_q + 2) if p in chain), None)
        if nxt_q:
            cands.append((chain[nxt_q][0], chain[nxt_q][1].y0 - 2))
        for li, s, e, hp in headers:
            if hp <= pos:
                continue
            if s is None or s > n:
                cands.append(hp)
            break
        cands = [c for c in cands if c > pos]
        return min(cands) if cands else (pos[0], doc[pos[0]].rect.height - FOOTER)

    # 1) 题组材料：组头行 → 组内首题行之间整块裁图（跨页取中间整页）
    img_by_group = {}
    for gi, (li, start, end, hdr) in enumerate(headers):
        if gi >= len(json_groups):
            break
        # 组内首题：显式题号，或按 JSON 组顺序推
        members = sorted(q["idx"] for q in paper["questions"] if q.get("groupId") == json_groups[gi])
        first_q = start if (start and start in chain) else (members[0] if members else None)
        if not first_q or first_q not in chain:
            continue
        pngs = crop_pngs(doc, hdr, (chain[first_q][0], chain[first_q][1].y0 - 2))
        if pngs:
            img_by_group[json_groups[gi]] = to_dataurls(pngs)
            print(f"  组{json_groups[gi]}（{start or '?'}-{end or members[-1]}）材料截图 {len(pngs)} 张")

    # 2) 恢复被丢的图片形态题（JSON 里缺号的）
    answers = parse_answers(ans_pdf)
    missing = [n for n in range(1, max_q + 1) if n not in existing]
    restored = []
    for n in missing:
        if n not in chain:
            print(f"  ! 题{n}：试卷 PDF 未定位到，跳过")
            continue
        endpos = bound_after(n, (chain[n][0], chain[n][1].y1))
        pngs = crop_pngs(doc, (chain[n][0], chain[n][1].y0 - 2), endpos)
        if not pngs:
            continue
        # 题干文本：定位行到裁图下界之间的文字（过滤页脚/页码）
        sp, sr = chain[n]
        ep, er = endpos
        texts = []
        for pno, rect, text in lines:
            if (pno > sp or (pno == sp and rect.y0 > sr.y1)) and (pno < ep or (pno == ep and rect.y1 < er + 2)):
                if not PAGEFOOT_RE.match(text):
                    texts.append(text)
        stem, opts = split_stem_options(" ".join(texts))
        stem = re.sub(r"^\d{1,3}[.．]\s*", "", stem)
        ans, expl = answers.get(n, (None, None))
        # section/groupId 继承相邻题（资料分析里的图形题不是图形推理）
        prev_q = next((q for q in reversed(paper["questions"]) if q["idx"] < n), None)
        next_q = next((q for q in paper["questions"] if q["idx"] > n), None)
        section, subtype, gid = "判断推理", "图形推理", None
        if prev_q and n - prev_q["idx"] == 1 and prev_q.get("groupId"):
            section, subtype, gid = prev_q["section"], None, prev_q["groupId"]
        elif prev_q and next_q and prev_q.get("groupId") and prev_q["groupId"] == next_q.get("groupId"):
            section, subtype, gid = prev_q["section"], None, prev_q["groupId"]
        restored.append({
            "idx": n,
            "section": section,
            "subtype": subtype,
            "groupId": gid,
            **({"groupStem": prev_q["groupStem"], "groupImage": img_by_group.get(gid)} if gid and prev_q.get("groupStem") else {}),
            "stem": stem or f"第{n}题（见配图）",
            "options": opts or [{"key": k, "text": ""} for k in "ABCD"],
            "answer": ans,
            "explanation": expl,
            "image": to_dataurls(pngs),
        })
        print(f"  题{n} 恢复：{section}{gid or ''} 截图 {len(pngs)} 张，答案 {ans or '缺'}")

    # 3) 回写 JSON：每组成员挂 groupImage；恢复题插回
    for q in paper["questions"]:
        if q.get("groupId") in img_by_group:
            q["groupImage"] = img_by_group[q["groupId"]]
    if restored:
        paper["questions"] = sorted(paper["questions"] + restored, key=lambda q: q["idx"])
    unloc = [n for n in missing if n not in chain]
    if unloc:
        paper["warnings"] = [w for w in (paper.get("warnings") or []) if "源 PDF 缺题" not in w]
        paper["warnings"].append(f"题号 {unloc} 在试卷源 PDF 中即为「缺」（引流版缺题），无法恢复")
        paper["warnings"] = [w for w in (paper.get("warnings") or [])
                             if "未收录" not in w and "图片形态" not in w]
        paper["warnings"].append(
            f"图形/图片选项题 {len(restored)} 题以整题截图恢复（image 字段），文字系 PDF 文本层原文")
    json_path.write_text(json.dumps(paper, ensure_ascii=False, indent=1))
    doc.close()
    print(f"✓ {json_path.name}：组图 {len(img_by_group)} 组，恢复 {len(restored)} 题")


def main():
    paper_dir, ans_dir, json_dir = (Path(a) for a in sys.argv[1:4])
    level_kw = {"副省级": "副省级", "地市级": "地市", "行政执法": "行政执法"}
    for jp in sorted(json_dir.glob("*.json")):
        level = next(k for k in level_kw if k in jp.name)
        paper_pdf = next(paper_dir.glob(f"*{level_kw[level]}*.pdf"))
        ans_pdf = next(ans_dir.glob(f"*{level_kw[level]}*.pdf"))
        print(f"→ {jp.name} ← {paper_pdf.name}")
        process(jp, paper_pdf, ans_pdf)


main()
