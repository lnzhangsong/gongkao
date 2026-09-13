#!/usr/bin/env python3
"""行测真题图表 → WebP 落盘 + JSON 写引用（2026 卷专用管线）

思路：不再 OCR（2026-09-08 用户裁定识别质量不达刷题标准），改为从「试卷」PDF 把
资料分析材料图表、图形推理题整块裁成图，**直接落盘** data/xingce-img/{paper_id}/，
JSON 里只写轻量引用（不再内嵌 base64，见 docs/行测做题模块设计方案.md §4.1）：
- 题组材料 → questions[].groupImage = [{file, w, h}]
- 被丢的图形推理/图片选项题 → 恢复整题：image + stem + answer/explanation（解析 PDF 补）

用法：python3 scripts/xingce-images.py <试卷目录> <解析目录> <json目录> [--img-dir data/xingce-img]
      加 --answers-only 只回填答案（解析 PDF 文字解析行 + 黄色高亮标记），不动图片
定位策略：行级 bbox 文本 → 题号候选链（严格递增，跳过卷首「注意事项 1.」类伪题号）
"""
import json
import re
import shutil
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_IMG_DIR = ROOT / "data" / "xingce-img"

GROUP_RE = re.compile(r"^(?:[一二三四五六七八九十]+、\s*)?根据(?:以下资料|所给材料|所给的材料|下述材料)，?回答?\s*(\d+)\s*[-—–~至]\s*(\d+)\s*题")
ZILIAO_RE = re.compile(r"资料分析")
PAREN_GROUP_RE = re.compile(r"^[（(][一二三四五六七八九十][)）]\s*$")  # 行政执法卷组头「(一)」样式
QNUM_RE = re.compile(r"^(\d{1,3})[.．]\s*")
OPT_SPLIT_RE = re.compile(r"(?:^|\n|\s)([A-E])[．.]\s*")
ANS_RE = re.compile(r"^(\d{1,3})[.．]\s*([A-E])\s*项?。", re.M)
PAGEFOOT_RE = re.compile(r"第\d+页[,，]?\s*共?\d*页?|^第\s*\d+\s*部分|^\d{1,3}$")
# 题干提到图但 JSON 里没图：文字被 OCR 收录、图形被丢的题（数量关系几何 / 图形推理由图选项）
FIG_REF_RE = re.compile(r"下图|左图|右图|六个图形|如图")
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
        # x 不钳页边距：材料图表有放置到 x>width-PAGE_MARGIN_X 的，钳住会切掉右端
        clip = pymupdf.Rect(0, y0, doc[pno].rect.width, y1)
        pix = doc[pno].get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), clip=clip)
        png = pix.tobytes("png")
        if len(png) < 20_000:
            continue  # 近空白裁片（组头页尾、页码残留）
        item = dict(zip(("b", "ext", "w", "h"), png_to_webp(png, 85)))
        item["w"], item["h"] = pix.width, pix.height
        out.append(item)
    return out


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


def split_text_options(stem_texts):
    """文字题选项拆分：以「单字母 + 空格或点」开头的行起新选项（「A 甲在…」「B.乙在…」混用），
    其余行续接上一选项。键序须恰为 A-D 才认；否则返回 None（调用方沿用旧文本/旧选项）。"""
    marks = []
    for i, ln in enumerate(stem_texts):
        m = re.match(r"^([A-E])(?:[.．]\s*|\s+)", ln)
        if m:
            marks.append((i, m.group(1)))
    sel: list[tuple[int, str]] = []
    ki = 0
    for i, k in marks:
        if ki < 4 and k == "ABCD"[ki]:
            sel.append((i, k))
            ki += 1
    if ki != 4:
        return None
    stem_lines = stem_texts[: sel[0][0]]
    opts = []
    for j, (i, k) in enumerate(sel):
        end = sel[j + 1][0] if j + 1 < len(sel) else len(stem_texts)
        text = re.sub(r"^[A-E][.．]?\s*", "", stem_texts[i]) + "".join(stem_texts[i + 1 : end])
        opts.append({"key": k, "text": text.strip()})
    return stem_lines, opts


def png_to_webp(png: bytes, quality: int) -> tuple[bytes, str, int, int]:
    """线条图转有损 WebP：同画质体积约为 PNG 的 1/4，读取时浏览器直接解码。
    （试过转灰度 L：有损 WebP 内部本就走 YUV，灰度只省 0.4%，不值得。）
    Pillow 不可用时回退 PNG（尺寸 0 交给前端省略宽高属性）。返回 (bytes, ext, w, h)。"""
    try:
        import io

        from PIL import Image
        img = Image.open(io.BytesIO(png))
        w, h = img.size
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=quality, method=6)
        return buf.getvalue(), "webp", w, h
    except Exception:
        return png, "png", 0, 0


def write_image_files(img_dir: Path, paper_id: str, items: list[dict], kind: str, key: int) -> list[dict]:
    """裁片落盘为 {kind}{key}_{i}.{ext}，返回 JSON 里的轻量引用 [{file, w, h}]。"""
    refs = []
    target = img_dir / paper_id
    for i, it in enumerate(items):
        name = f"{kind}{key}_{i}.{it['ext']}"
        target.mkdir(parents=True, exist_ok=True)
        (target / name).write_bytes(it["b"])
        refs.append({"file": name, "w": it["w"], "h": it["h"]})
    return refs


def clean_watermark(doc):
    """引流版水印的构成：内容贴图 = 彩色水印平铺(底图) + SMask 透明通道抠出图形形状
    （alpha≈255 图形黑、≈0 透白、中间为半透明水印层）。SMask 二值化后水印消失、图形不变。"""
    table = bytes(255 if v >= 200 else 0 for v in range(256))
    fixed = 0
    for x in range(1, doc.xref_length()):
        try:
            if doc.xref_get_key(x, "Subtype") != ("name", "/Image"):
                continue
            st, val = doc.xref_get_key(x, "SMask")
        except Exception:
            continue  # 引流版 PDF 有悬空 xref 条目
        if st != "xref":
            continue
        try:
            pix = pymupdf.Pixmap(doc, int(val.split()[0]))
        except Exception:
            continue
        if pix.colorspace is None or pix.colorspace.n != 1:
            continue
        doc.update_stream(int(val.split()[0]), pix.samples.translate(table), compress=True)
        fixed += 1
    return fixed


def trimmed_png(doc, pno, clip, pad=5):
    """渲染后按非白像素收紧再留 pad 边：内容贴图的 bbox 常带大片空白边。返回 (png, w, h)。"""
    pix = doc[pno].get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), clip=clip)
    w, h, n = pix.width, pix.height, pix.n
    s = pix.samples
    stride = w * n

    def min_row(y):
        return min(s[y * stride:(y + 1) * stride])

    def min_col(x):
        return min(min(s[x * n + c::stride]) for c in range(n))

    top = next((y for y in range(h) if min_row(y) < 245), None)
    if top is None:
        return pix.tobytes("png"), w, h  # 空白片照原样返回，交给调用方的大小过滤
    bot = next(y for y in range(h - 1, -1, -1) if min_row(y) < 245)
    left = next(x for x in range(w) if min_col(x) < 245)
    right = next(x for x in range(w - 1, -1, -1) if min_col(x) < 245)
    nclip = pymupdf.Rect(
        max(clip.x0, clip.x0 + left / ZOOM - pad),
        max(clip.y0, clip.y0 + top / ZOOM - pad),
        min(clip.x1, clip.x0 + (right + 1) / ZOOM + pad),
        min(clip.y1, clip.y0 + (bot + 1) / ZOOM + pad),
    )
    final = doc[pno].get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), clip=nclip)
    return final.tobytes("png"), final.width, final.height


def question_parts(doc, lines, start, end, qrect):
    """整题拆成 (题干文本行, 截图 bytes 列表)。
    图形题：题干 = 题号行（qrect）+ 题号行之下、首页首张内嵌图上沿之上的文字行，随文本渲染不进图；
    截图从首图上沿裁到末图下沿（图形、选项字母仍随图）。首页无图的跨页题整页文字归题干。
    纯文字题（区域内无内嵌图）：跨页取全 span 文字归题干、截图为空列表。"""
    sp = start[0]
    sr = qrect
    spans = spans_of(doc, start, end)
    stem_bottom = None  # 首页题干区下沿（首张内嵌图上沿）
    trimmed: list[tuple[int, int, int]] = []
    any_img = False
    for pno, y0, y1 in spans:
        if y1 - y0 < 8:
            continue
        rects = [
            pymupdf.Rect(i["bbox"])
            for i in doc[pno].get_image_info()
            if i["bbox"][1] >= y0 - 6 and i["bbox"][3] <= y1 + 6 and i["bbox"][0] < doc[pno].rect.width - PAGE_MARGIN_X
            # 页顶「优公教育」广告条：小 logo 图（h≈18pt）贴着页顶，排除后广告文字也落在裁图外
            and not (i["bbox"][3] - i["bbox"][1] <= 25 and i["bbox"][1] <= PAGE_MARGIN_Y + 30)
        ]
        if rects:
            any_img = True
            top = min(r.y0 for r in rects) - 6
            if pno == sp:
                stem_bottom = top
            trimmed.append((pno, top, min(y1, max(r.y1 for r in rects) + 6)))
        # 无图页：首页纯题干不出图；中间/尾页无图是下一题的文字，跳过
    if not any_img:
        # 纯文字题：跨页取全 span 文字归题干
        stem_texts = []
        for pno, rect, text in lines:
            if PAGEFOOT_RE.match(text):
                continue
            if any(p == pno and y0 - 2 <= rect.y0 < y1 + 2 for p, y0, y1 in spans) and (
                pno != sp or rect.y0 >= sr.y0 - 1
            ):
                stem_texts.append(text)
        return stem_texts, []
    if stem_bottom is None:
        stem_bottom = doc[sp].rect.height - FOOTER  # 题干在首页、图形在后续页
    stem_texts = []
    stem_y1 = None  # 首页题干行最低底边
    for pno, rect, text in lines:
        if pno != sp or PAGEFOOT_RE.match(text):
            continue
        # 题干行 = 从题号行起、起始位置在图区上沿之前的行（行底可能紧贴甚至齐平图沿）
        if rect.y0 >= sr.y0 - 1 and rect.y0 < stem_bottom + 2:
            stem_texts.append(text)
            stem_y1 = max(stem_y1 or 0, rect.y1)
    # 裁图上沿让位：不切进题干行的下半截（题干底边与图形间隙不足 6pt 时按题干底边起裁）
    if trimmed and trimmed[0][0] == sp and stem_y1 is not None:
        p0, y0, y1 = trimmed[0]
        trimmed[0] = (p0, min(max(y0, stem_y1 + 2), y1), y1)
    out = []
    for pno, y0, y1 in trimmed:
        # x 不钳页边距：部分图形条（六宫格等）放置到 x>width-PAGE_MARGIN_X，钳住会切掉右端
        clip = pymupdf.Rect(0, y0, doc[pno].rect.width, y1)
        png, w, h = trimmed_png(doc, pno, clip)
        item = dict(zip(("b", "ext", "w", "h"), png_to_webp(png, 80)))
        item["w"], item["h"] = w, h
        if len(item["b"]) < 2_000:
            continue
        out.append(item)
    return stem_texts, out


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


def is_yellow(fill) -> bool:
    return bool(fill) and fill[0] > 0.85 and fill[1] > 0.85 and fill[2] < 0.6


def parse_highlight_answers(pdf: Path):
    """解析 PDF 黄色高亮 → {题号: 答案字母}。

    引流版对没有文字解析的题不写「N.X。【解析】」行，只在正确选项整行
    （或图形推理题题干行尾的答案字母）铺黄色高亮块——那是 (≈1,1,0) 的矢量
    填充矩形，纯文本提取完全看不到，须用 get_drawings() 定位后映射回覆盖的
    选项词（「B.职能型…」）或行尾字母。归属规则：高亮块属于阅读序里最近的
    上一个题号行，且跨页延续（题号行常在页尾、高亮选项在次页开头）。
    用已入库答案交叉校验 259 题全部一致。"""
    doc = pymupdf.open(str(pdf))
    out: dict[int, str] = {}
    cur = None  # 当前题号
    for page in doc:
        rects = [d["rect"] for d in page.get_drawings() if is_yellow(d.get("fill"))]
        lines = []
        for b in page.get_text("dict")["blocks"]:
            if b["type"] != 0:
                continue
            for l in b["lines"]:
                text = "".join(s["text"] for s in l["spans"]).strip()
                if text:
                    lines.append((pymupdf.Rect(l["bbox"]), text))
        lines.sort(key=lambda x: (round(x[0].y0), x[0].x0))
        words = page.get_text("words") if rects else []
        for rect, text in lines:
            m = QNUM_RE.match(text)
            if m:
                cur = int(m.group(1))
            # 高亮块比文字行高，用「块中心落在行带内」判定；命中后取块内以「X.」
            # 开头的词为选项字母
            hit = [r for r in rects if rect.y0 - 3 <= (r.y0 + r.y1) / 2 <= rect.y1 + 3
                   and r.x1 > rect.x0 and r.x0 < rect.x1]
            if not hit:
                continue
            letter = None
            for w in words:
                x0, y0, x1, y1, word = w[:5]
                if any(r.x0 <= (x0 + x1) / 2 <= r.x1 and r.y0 <= (y0 + y1) / 2 <= r.y1 for r in hit):
                    wm = re.match(r"^([A-E])[．.、)）]", word)
                    if wm:
                        letter = wm.group(1)
                        break
            # 题干行尾答案字母样式：「…使之呈现一定的规律性。D」
            if not letter:
                em = re.search(r"[。？?：:，,]\s*([A-E])\s*$", text)
                if em and any(r.x1 > rect.x1 - 15 for r in hit):
                    letter = em.group(1)
            if letter and cur:
                out.setdefault(cur, letter)
    doc.close()
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


def process(json_path: Path, paper_pdf: Path, ans_pdf: Path, img_dir: Path = DEFAULT_IMG_DIR, answers_only: bool = False):
    paper = json.loads(json_path.read_text())
    existing = {q["idx"] for q in paper["questions"]}
    max_q = max(existing)

    answers = parse_answers(ans_pdf)
    hl_answers = parse_highlight_answers(ans_pdf)

    # 0) 答案回填：JSON 里 answer 为空的题（引流版只对部分题写文字解析，其余靠
    #    黄色高亮标答案），从解析 PDF 的「N.X。【解析】」行 + 黄色高亮两路补齐
    filled = 0
    for q in paper["questions"]:
        if not q.get("answer"):
            a = answers.get(q["idx"], (None, None))[0] or hl_answers.get(q["idx"])
            if a:
                q["answer"] = a
                filled += 1
    if filled:
        print(f"  答案回填 {filled} 题（解析 PDF 文字行/黄色高亮）")

    if answers_only:
        # 尾部补 \n：与仓库格式化工具（oxfmt）约定一致，避免每轮重跑都多出格式 diff
        json_path.write_text(json.dumps(paper, ensure_ascii=False, indent=2) + "\n")
        print(f"✓ {json_path.name}（仅答案）：回填 {filled} 题")
        return

    # 图由本脚本直接落盘：先清空该卷图目录，避免旧序号文件残留被前端读成重复图
    shutil.rmtree(img_dir / paper["id"], ignore_errors=True)

    doc = pymupdf.open(str(paper_pdf))
    wm = clean_watermark(doc)
    if wm:
        print(f"  水印清理：{wm} 张贴图")
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
            img_by_group[gid] = write_image_files(img_dir, paper["id"], pngs, "g", gid)
            print(f"  组{gid}（{members[0]}-{members[-1]}）材料截图 {len(pngs)} 张")

    # 2) 图片形态题：JSON 里缺号的恢复；已有 image 的重裁一遍
    #    （题干行改为文本渲染、截图只留图形区，2026-09-11）
    by_idx = {q["idx"]: q for q in paper["questions"]}
    missing = [n for n in range(1, max_q + 1) if n not in existing]
    # 候选：已有 image 的重裁；题干提到图但没图的补图（2026-09-11）
    need_img = {n for n, q in by_idx.items()
                if not q.get("image") and FIG_REF_RE.search(q.get("stem") or "")}
    restored = []
    recropped = 0
    stub: list[int] = []  # 源 PDF 即为存根（「N.缺」）的文字题
    for n in sorted(set(missing) | {n for n, q in by_idx.items() if q.get("image")} | need_img):
        if n not in chain:
            if n in missing:
                print(f"  ! 题{n}：试卷 PDF 未定位到，跳过")
            continue
        old = by_idx.get(n)
        had_img = bool(old and old.get("image"))
        opts = old["options"] if old else [{"key": k, "text": ""} for k in "ABCD"]
        # section/groupId 继承相邻题（资料分析里的图形题不是图形推理）
        prev_q = next((q for q in reversed(paper["questions"]) if q["idx"] < n), None)
        next_q = next((q for q in paper["questions"] if q["idx"] > n), None)
        section, subtype, gid = "判断推理", "图形推理", None
        if prev_q and n - prev_q["idx"] == 1 and prev_q.get("groupId"):
            section, subtype, gid = prev_q["section"], None, prev_q["groupId"]
        elif prev_q and next_q and prev_q.get("groupId") and prev_q["groupId"] == next_q.get("groupId"):
            section, subtype, gid = prev_q["section"], None, prev_q["groupId"]
        start = (chain[n][0], chain[n][1].y0 - 2)
        stem_texts, pngs = question_parts(doc, lines, start, bound_after(n, (chain[n][0], chain[n][1].y1)), chain[n][1])
        if stem_texts:
            # 题号行已并入 stem_texts：先剥行首题号，防 split 内 cut_leak(·, n) 误切在题号上；
            # 中文行直接相连，不走空格 join（否则「分类正/确的一项是」会拼出「正 确」）
            raw = re.sub(r"^\d{1,3}[.．]\s*", "", "".join(stem_texts))
            stem, opts2 = split_stem_options(raw, n)
            # 图片选项题里尾粘进题干的选项字母（「…占比关系的是：D」）
            stem = re.sub(r"[：:，,。]\s*[A-E]\s*[.．]?\s*$", "", stem).rstrip()
        else:
            stem, opts2 = "", []
        if not pngs:
            # 纯文字题（区域内无内嵌图）：完整题干走文本，撤销历史上误挂的整题截图
            split_result = split_text_options(stem_texts)
            stem_lines, opts2 = split_result if split_result else (stem_texts, [])
            raw = re.sub(r"^\d{1,3}[.．]\s*", "", "".join(stem_lines))
            stem = cut_ad(cut_leak(raw, n)).rstrip()
            ans, expl = answers.get(n, (None, None))
            ans = ans or hl_answers.get(n)
            if old:
                if not had_img:
                    continue  # 本就是文字题且未挂图，无需动
                if stem:
                    old["stem"] = stem
                if opts2:
                    old["options"] = opts2
                old["image"] = None
                recropped += 1
                print(f"  题{n} 转文字题：题干 {len(old['stem'])} 字，选项 {len(opts2) or '沿用旧值'}，移除整题截图")
                continue
            if len(stem) < 10:
                stub.append(n)
                print(f"  ! 题{n}：源 PDF 即为存根（题干 {len(stem)} 字），不恢复")
                continue
            restored.append({
                "idx": n,
                "section": section,
                "subtype": subtype if section == "判断推理" else None,
                "groupId": gid,
                **({"groupStem": prev_q["groupStem"], "groupImage": img_by_group.get(gid)} if gid and prev_q.get("groupStem") else {}),
                "stem": stem or f"第{n}题（见配图）",
                "options": opts2 or opts,
                "answer": ans,
                "explanation": expl,
                "image": None,
            })
            print(f"  题{n} 恢复（文字题）：{section}{gid or ''} 题干 {len(stem)} 字，答案 {ans or '缺'}")
            continue
        if not stem:
            stem = old["stem"] if old else f"第{n}题（见配图）"
        if old:
            old["stem"] = stem
            old["image"] = write_image_files(img_dir, paper["id"], pngs, "q", n)
            recropped += 1
            print(f"  题{n} {'重裁' if had_img else '补图'}：题干 {len(stem)} 字，截图 {len(pngs)} 张")
            continue
        ans, expl = answers.get(n, (None, None))
        ans = ans or hl_answers.get(n)
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
            "image": write_image_files(img_dir, paper["id"], pngs, "q", n),
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
    if unloc or stub:
        paper["warnings"] = [w for w in (paper.get("warnings") or []) if "源 PDF 缺题" not in w]
        if unloc:
            paper["warnings"].append(f"题号 {unloc} 在试卷源 PDF 中即为「缺」（引流版缺题），无法恢复")
        if stub:
            paper["warnings"].append(f"题号 {stub} 在试卷源 PDF 中即为「缺」（引流版缺题），无法恢复")
    paper["warnings"] = [w for w in (paper.get("warnings") or [])
                         if "未收录" not in w and "图片形态" not in w]
    paper["warnings"].append(
        f"图形/图片形态题以「题干文本 + 图形区截图」存储：本轮重裁 {recropped} 题、新恢复 {len(restored)} 题")
    json_path.write_text(json.dumps(paper, ensure_ascii=False, indent=2) + "\n")
    doc.close()
    print(f"✓ {json_path.name}：组图 {len(img_by_group)} 组，恢复 {len(restored)} 题")


def main():
    argv = sys.argv[1:]
    answers_only = "--answers-only" in argv
    img_dir = DEFAULT_IMG_DIR
    positional = []
    i = 0
    while i < len(argv):
        if argv[i] == "--answers-only":
            i += 1
        elif argv[i] == "--img-dir":
            img_dir = Path(argv[i + 1])
            i += 2
        else:
            positional.append(argv[i])
            i += 1
    paper_dir, ans_dir, json_dir = (Path(a) for a in positional)
    level_kw = {"副省级": "副省级", "地市级": "地市", "行政执法": "行政执法"}
    for jp in sorted(json_dir.glob("*.json")):
        level = next(k for k in level_kw if k in jp.name)
        paper_pdf = next(paper_dir.glob(f"*{level_kw[level]}*.pdf"))
        ans_pdf = next(ans_dir.glob(f"*{level_kw[level]}*.pdf"))
        print(f"→ {jp.name} ← {paper_pdf.name}")
        process(jp, paper_pdf, ans_pdf, img_dir, answers_only=answers_only)


main()
