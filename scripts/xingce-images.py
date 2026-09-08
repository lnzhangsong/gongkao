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

GROUP_RE = re.compile(r"^(?:[一二三四五六七八九十]+、\s*)?根据(?:以下资料|所给材料|所给的材料|下述材料)，?回答?\s*(\d+)\s*[-—–~至]\s*(\d+)\s*题")
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

# 与 parse-xingce26.py 的 LEAK_RE 保持一致：截断 pypdf 粘进来的部分头/指导语/组头
LEAK_RE = re.compile(
    r"（共\s*\d+\s*题[，,]?参考时限"
    r"|请开始答题"
    r"|[一二三四五六七八九十]+、\s*(?:图形推理|定义判断|类比推理|逻辑判断|资料分析|数量关系|言语理解|言语理解与表达|常识判断|政治理论)"
    r"|(?:[一二三四五六七八九十]+、\s*)?根据(?:以下资料|所给材料|所给的材料|下述材料)，?回答?\s*\d+\s*[-—–~至]\s*\d+\s*题"
    r"|\d{1,3}[.．]\s*【解析】"
)


def cut_leak(s: str, nxt: int | None = None) -> str:
    """截断粘进来的泄漏文本；nxt=紧邻下一题号时连「N.」开头一起切（小数不切、紧跟年份要切）。"""
    pat = LEAK_RE
    if nxt is not None:
        pat = re.compile(LEAK_RE.pattern + rf"|(?<![0-9]){nxt}[.．]\s*(?!\d{{1,2}}[^0-9])")
    m = pat.search(s)
    return s[: m.start()].rstrip() if m else s


# 引流版尾部推广语（与 parse-xingce26.py 的 AD_CUT 保持一致）
AD_CUT = re.compile(
    r"上岸咨询热线|要成公[，,]?选优公|圆您公职梦|优公教育|咨询热线[／/]|微信[：:]\s*\d{5,}"
)


def cut_ad(s):
    if not s:
        return s
    m = AD_CUT.search(s)
    return s[: m.start()].rstrip() if m else s


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


def spans_of(doc, start, end):
    """(page, y) 两点之间的渲染区间列表 [(pno, y0, y1)]"""
    sp, sy = start
    ep, ey = end
    if ep == sp:
        return [(sp, sy, ey)]
    out = [(sp, sy, doc[sp].rect.height - FOOTER)]
    for p in range(sp + 1, ep):
        out.append((p, PAGE_MARGIN_Y, doc[p].rect.height - FOOTER))
    out.append((ep, PAGE_MARGIN_Y, ey))
    return out


def question_pngs(doc, start, end):
    """整题截图：图形/选项是内嵌图片，以下方最后一张图的底边为裁图下界，
    尾随的下一题题干/页码不进来；中间无内嵌图的整页（下一大题文字页）跳过。
    区域内完全没有内嵌图时退回区间裁法（矢量图形兜底）。"""
    out = []
    spans = spans_of(doc, start, end)
    sp = spans[0][0]
    any_img = False
    trimmed: list[tuple[int, int, int]] = []
    for pno, y0, y1 in spans:
        if y1 - y0 < 8:
            continue
        rects = [
            pymupdf.Rect(i["bbox"])
            for i in doc[pno].get_image_info()
            if i["bbox"][1] >= y0 - 6 and i["bbox"][3] <= y1 + 6 and i["bbox"][0] < doc[pno].rect.width - PAGE_MARGIN_X
        ]
        if rects:
            any_img = True
            bottom = min(y1, max(r.y1 for r in rects) + 6)
            trimmed.append((pno, y0, bottom))
        elif pno == sp:
            trimmed.append((pno, y0, y1))  # 首页至少保留题干文字
        # 中间页/尾页无图：是下一题的文字，跳过
    if not any_img:
        return crop_pngs(doc, start, end)
    for pno, y0, y1 in trimmed:
        clip = pymupdf.Rect(PAGE_MARGIN_X, y0, doc[pno].rect.width - PAGE_MARGIN_X, y1)
        pix = doc[pno].get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), clip=clip)
        png = pix.tobytes("png")
        if len(png) < 20_000:
            continue
        out.append(png)
    return out


def parse_answers(pdf: Path):
    """解析 PDF → {题号: (答案, 解析文本)}"""
    import pypdf

    text = "\n".join((p.extract_text() or "") for p in pypdf.PdfReader(str(pdf)).pages)
    marks = list(ANS_RE.finditer(text))
    out = {}
    for i, m in enumerate(marks):
        n = int(m.group(1))
        seg_end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        seg = text[m.end():seg_end]
        seg = re.sub(r"要成公[，,]?选优公|优公教育|版权所有.*|^\d{1,3}$", "", seg, flags=re.M).strip()
        # 引流版在缺失答案的题处两题相隔很远，中间会粘进下一部分/下一题组的整段文字
        seg = cut_leak(seg, n + 1)
        seg = cut_ad(seg) or seg
        seg = re.sub(r"^【解析】\s*", "", seg).strip()
        out[n] = (m.group(2), seg if len(seg) > 15 else None)
    return out


def split_stem_options(raw, nxt: int | None = None):
    """题干文本里若带 A. B. 选项行则拆出；否则选项留空（图片形态）。
    拆出的选项必须是完整的 A-D 且文本非空，否则视为图片选项（纯图片选项题 A./B. 空标记）。"""
    m = re.search(r"(?:^|\n|\s)([A-E])[．.]\s*", raw)
    stem0 = cut_ad(cut_leak(raw[: m.start()], nxt)) if m else cut_ad(cut_leak(raw, nxt))
    parts = OPT_SPLIT_RE.split(raw)
    pairs = sorted(
        zip(parts[1::2], [cut_ad(cut_leak(t.strip(), nxt)) for t in parts[2::2]]),
        key=lambda kv: kv[0],
    )  # 双栏排版的选项 pypdf 按行抽出后键序可能乱，按键重排
    keys = [k for k, _ in pairs]
    texts = [t for _, t in pairs]
    if keys[:4] == list("ABCD") and len(texts) >= 4 and all(len(t) >= 2 for t in texts[:4]):
        return stem0.strip(), [{"key": keys[i], "text": texts[i]} for i in range(4)]
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
    # 只给资料分析题组裁图；言语等纯文字材料的题组用 groupStem 文本
    zl = []  # [(gid, min_idx, max_idx)] 按文档顺序
    for gid in sorted({q["groupId"] for q in paper["questions"] if q.get("groupId")}):
        members = sorted(q["idx"] for q in paper["questions"] if q.get("groupId") == gid)
        sec = next(q["section"] for q in paper["questions"] if q.get("groupId") == gid)
        if sec == "资料分析":
            zl.append((gid, members[0], members[-1]))
    img_by_group = {}
    claimed = set()
    # 显式题号组头：按题号落组
    pairings = []  # (hdr, gid)
    rest = list(zl)
    for li, start, end, hdr in headers:
        if start is None:
            continue
        hit = next((t for t in rest if t[1] <= start <= t[2]), None)
        if hit:
            pairings.append((hdr, hit[0]))
            claimed.add(hit[0])
            rest.remove(hit)
    # 匿名组头（行政执法「(一)」式）：按出现顺序填给剩余资料分析组
    for li, start, end, hdr in headers:
        if start is not None or not rest:
            continue
        hit = rest.pop(0)
        pairings.append((hdr, hit[0]))
        claimed.add(hit[0])
    for hdr, gid in pairings:
        members = sorted(q["idx"] for q in paper["questions"] if q.get("groupId") == gid)
        first_q = members[0] if members else None
        if not first_q or first_q not in chain:
            continue
        pngs = crop_pngs(doc, hdr, (chain[first_q][0], chain[first_q][1].y0 - 2))
        if pngs:
            img_by_group[gid] = to_dataurls(pngs)
            print(f"  组{gid}（{members[0]}-{members[-1]}）材料截图 {len(pngs)} 张")

    # 2) 恢复被丢的图片形态题（JSON 里缺号的）
    answers = parse_answers(ans_pdf)
    missing = [n for n in range(1, max_q + 1) if n not in existing]
    restored = []
    for n in missing:
        if n not in chain:
            print(f"  ! 题{n}：试卷 PDF 未定位到，跳过")
            continue
        endpos = bound_after(n, (chain[n][0], chain[n][1].y1))
        pngs = question_pngs(doc, (chain[n][0], chain[n][1].y0 - 2), endpos)
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
        stem, opts = split_stem_options(" ".join(texts), n)
        stem = re.sub(r"^\d{1,3}[.．]\s*", "", stem)
        # 图片选项题里尾粘进题干的选项字母（「…占比关系的是：D」）
        stem = re.sub(r"[：:，,。]\s*[A-E]\s*[.．]?\s*$", "", stem).rstrip()
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

    # 后处理：大段无标记词的粘连（材料粘进上一题选项）按「其它题干/题组材料开头」交叉匹配截断
    # （与 parse-xingce26.py 的 decontam 同法；此处覆盖恢复题——它们源自试卷 PDF，可能有新的粘连）
    starts = [t[:24] for q in paper["questions"] for t in (q.get("groupStem"), q.get("stem")) if t]

    def decontam(t):
        if not t:
            return t
        cut = None
        for s0 in starts:
            i = t.find(s0, 8)
            if i > 0 and (cut is None or i < cut):
                cut = i
        return t[:cut].rstrip() if cut is not None else t

    for q in paper["questions"]:
        q["stem"] = decontam(q["stem"]) or q["stem"]
        for o in q["options"]:
            o["text"] = decontam(o["text"])
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
