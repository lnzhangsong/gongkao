#!/usr/bin/env python3
"""行测 2000–2025 题图/材料图裁切落盘（配合 scripts/parse-xingce-pdf.py）

2000–2025 推荐版是「真题 PDF（题干+选项、图在文本层外）+ 答案解析 PDF」两套文件；
图形推理题图、资料分析图表材料、公式/柱状/饼图选项在 PDF 里是**内嵌位图**。
本脚本从真题 PDF 按题号定位、把区域内的内嵌图渲染成 WebP，**直接落盘**
`data/xingce-img/{paper_id}/{q|g}{题号|组号}_{i}.webp`；JSON 里只写轻量引用：

    "image": [{"file": "q73_0.webp", "w": 1137, "h": 44}]

（不写 base64：同一张图在 git 里存两份、且每次重裁都重写 MB 级 JSON。）
前端按「卷号 + q{题号}/g{组号}」约定取图（src/data/xingceImages.ts），不读 API 的 image 字段；
`scripts/import-xingce.mjs` 只从引用里收集宽高生成尺寸清单，不再解码图片。

用法：
  python3 scripts/parse-xingce-images.py --paper 2022-副省级
  python3 scripts/parse-xingce-images.py --year 2022
  python3 scripts/parse-xingce-images.py --all          # 只处理已有 JSON 的卷
  python3 scripts/parse-xingce-images.py --paper 2022-副省级 --dry   # 只报告不写
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_JSON_DIR = ROOT / "data" / "xingce"
DEFAULT_IMG_DIR = ROOT / "data" / "xingce-img"
DEFAULT_Q_DIR = Path(
    "/Users/tomcat/Documents/docs/【01】国考真题资料/国考2000-2026真题pdf 【推荐用这个版本】"
    "/2000-2025国考行测PDF/行测-真题"
)

ZOOM = 2.5
PAGE_MARGIN_Y = 36
FOOTER = 40

QNUM_RE = re.compile(r"^(\d{1,3})\s*[.．、]")
PLACEHOLDER = "（原卷为图形/公式，待补图）"
FIG_REF_RE = re.compile(r"下图|如图|上图|所给的四个(图形|选项)|以下哪个饼图|以下柱状图|以下哪个图形|图片")
LEVEL_KW = {"副省级": ["副省级", "省级"], "地市级": ["地市级", "地市", "市地级"], "行政执法": ["行政执法"]}


# ---------- PDF 行索引 / 题号链 ----------

def safe_paper_dir(img_dir: Path, paper_id: str) -> Path:
    """paper_id 来自 JSON，可能被写坏成绝对路径或含 ..：rmtree 前强制校验仍落在 img_dir 内，
    否则 ignore_errors=True 会安静地删到仓库外。"""
    root = img_dir.resolve()
    d = (img_dir / paper_id).resolve()
    if d == root or root not in d.parents:
        raise ValueError(f"paper_id 越界：{paper_id!r} → {d}")
    return d


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
    lines = []
    for pno in range(len(doc)):
        for rect, text in page_lines(doc[pno]):
            lines.append((pno, rect, text))
    return lines


def question_chain(lines, max_q):
    """题号 n → (page, rect)：全文行序里挑一条严格递增的题号候选链。"""
    chain = {}
    cur = (-1, pymupdf.Rect(0, 0, 0, 0))
    for n in range(1, max_q + 1):
        for pno, rect, text in lines:
            if (pno, rect.y0) <= (cur[0], cur[1].y0):
                continue
            m = QNUM_RE.match(text)
            if m and int(m.group(1)) == n:
                chain[n] = (pno, rect)
                cur = (pno, rect)
                break
    return chain


# ---------- 图像工具 ----------

def png_to_webp(png: bytes, quality: int) -> tuple[bytes, str, int, int]:
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


def write_image_files(img_dir: Path, paper_id: str, items: list[dict], kind: str, key: int, dry: bool) -> list[dict]:
    """裁片落盘为 {kind}{key}_{i}.{ext}，返回 JSON 里的轻量引用 [{file, w, h}]。"""
    refs = []
    target = img_dir / paper_id
    for i, it in enumerate(items):
        name = f"{kind}{key}_{i}.{it['ext']}"
        if not dry:
            target.mkdir(parents=True, exist_ok=True)
            (target / name).write_bytes(it["b"])
        refs.append({"file": name, "w": it["w"], "h": it["h"]})
    return refs


def trimmed_png(doc, pno, clip, pad=5):
    """渲染后按非白像素收紧再留 pad 边（内嵌图 bbox 常带大片空白）。"""
    pix = doc[pno].get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), clip=clip)
    w, h, n = pix.width, pix.height, pix.n
    s = pix.samples
    stride = w * n

    def min_row(y):
        return min(s[y * stride : (y + 1) * stride])

    def min_col(x):
        return min(min(s[x * n + c :: stride]) for c in range(n))

    top = next((y for y in range(h) if min_row(y) < 245), None)
    if top is None:
        return pix.tobytes("png"), w, h
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


def is_ad_or_tiny(bb) -> bool:
    """页顶机构 logo（矮条紧贴页顶）与极小装饰图，不是题目内容。
    阈值要小：公式选项图（h≈17pt）常落在页顶下方 20–30pt，别误杀。"""
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    return (h <= 22 and bb[1] <= PAGE_MARGIN_Y + 10) or w < 12 or h < 8


def region_images(doc, start, end, last_text_y_before_material: float | None = None):
    """(page0, y0)…(page1, y1) 之间的内嵌位图，按文档顺序返回 [(pno, Rect)]。

    last_text_y_before_material：若给出，则过滤掉该 y 之上的图（上一题正文里的图，
    例如选项配图），避免把它误当成下一组材料。
    """
    (sp, sy), (ep, ey) = start, end
    out = []
    for pno in range(sp, ep + 1):
        y0 = sy if pno == sp else 0
        y1 = ey if pno == ep else doc[pno].rect.height
        for info in doc[pno].get_image_info():
            bb = info["bbox"]
            if bb[1] < y0 - 6 or bb[3] > y1 + 6:
                continue
            if last_text_y_before_material is not None and pno == sp and bb[1] < last_text_y_before_material - 6:
                continue
            if is_ad_or_tiny(bb):
                continue
            out.append((pno, pymupdf.Rect(bb)))
    return out


def merge_by_page(regions):
    """同页多张内嵌图 → 取并集，一张图。原卷里并排/上下相邻的多张位图本就是一个题图。"""
    merged: dict[int, "pymupdf.Rect"] = {}
    for pno, rect in regions:
        merged[pno] = rect if pno not in merged else (merged[pno] | rect)
    return sorted(merged.items())


def render_regions(doc, regions, quality=82, min_bytes=400):
    """regions: [(pno, Rect, floor, ceiling)]，每个 pno 至多一条。

    floor/ceiling 为同页题干文字边界，用于把上下沿压到文字之外——必须按**合并后的
    整块**计算，否则会误把块内表格自身的文字（或上一张表的底边）当成上沿，把图裁残。
    """
    items = []
    for pno, rect, floor, ceiling in regions:
        if rect.width < 6 or rect.height < 6:
            continue
        y0 = rect.y0 - 2
        if floor is not None:
            y0 = max(y0, floor + 3)
        y0 = max(0.0, y0)
        y1 = rect.y1 + 2
        if ceiling is not None:
            y1 = min(y1, ceiling - 1)
        y1 = min(y1, doc[pno].rect.height)
        if y1 - y0 < 6:
            continue
        # 左沿外扩：选项字母（A./B.）与表格边框在 PDF 里是文字/线条，紧贴位图左侧，
        # 不外扩会被切掉；外扩量固定且很小，不会带进相邻题内容
        x0 = max(0.0, rect.x0 - 12)
        clip = pymupdf.Rect(x0, y0, rect.x1 + 2, y1)
        png, w, h = trimmed_png(doc, pno, clip)
        b, ext, _w, _h = png_to_webp(png, quality)
        if len(b) < min_bytes:
            continue
        items.append({"b": b, "ext": ext, "w": w or _w, "h": h or _h})
    return items


def text_floor(lines, pno: int, lo_y: float, rect) -> float | None:
    """同页 [lo_y, 图顶] 之间文字行的最低底边；用于把图的上沿压到文字之下。"""
    floor = None
    for p, r, _t in lines:
        if p == pno and r.y0 >= lo_y - 1 and r.y1 <= rect.y0 + 3:
            floor = max(floor or 0.0, r.y1)
    return floor


def text_ceiling(lines, pno: int, hi_y: float, rect) -> float | None:
    """下沿边界：下一个题号行的顶边（同页时），避免把下一题文字切一半带进图里。"""
    if hi_y is None:
        return None
    return hi_y if hi_y >= rect.y0 else None


# ---------- 需要配图的题 ----------

def needs_image(q: dict) -> bool:
    if q.get("subtype") == "图形推理":
        return True
    opts = q.get("options") or []
    texts = [(o.get("text") or "").strip() for o in opts]
    if opts and all((not t) or t == "如上图所示" or PLACEHOLDER in t for t in texts):
        return True
    return bool(FIG_REF_RE.search(q.get("stem") or ""))


# ---------- 单卷 ----------

def find_paper_pdf(q_dir: Path, year: int, level: str) -> Path | None:
    cands = [f for f in q_dir.glob("*.pdf") if str(year) in f.name]
    for kw in LEVEL_KW[level]:
        hit = next((f for f in cands if kw in f.name), None)
        if hit:
            return hit
    # 早期卷（A/B 卷、卷一/卷二）无级别标识：仅在单卷时兜底
    return cands[0] if len(cands) == 1 else None


def process(json_path: Path, pdf_path: Path, img_dir: Path, dry: bool) -> None:
    paper = json.loads(json_path.read_text(encoding="utf-8"))
    paper_id = paper["id"]
    doc = pymupdf.open(str(pdf_path))
    lines = build_index(doc)
    questions = paper["questions"]
    chain = question_chain(lines, max(q["idx"] for q in questions))
    by_idx = {q["idx"]: q for q in questions}

    # 先清空旧的图字段与图目录：图由本脚本直接落盘，清掉避免旧序号文件残留
    # （残留会被前端 import.meta.glob 读成重复图），也避免本轮没抽到图时留着旧引用
    for q in questions:
        q["image"] = None
        q["groupImage"] = None
    if not dry:
        shutil.rmtree(safe_paper_dir(img_dir, paper_id), ignore_errors=True)

    def qpos(n):
        return chain.get(n)

    # 1) 资料分析题组材料图：上一题题号 → 本组首题题号 之间的内嵌图
    groups = {}
    for q in questions:
        if q.get("groupId") and q.get("section") == "资料分析":
            groups.setdefault(q["groupId"], []).append(q["idx"])
    n_group_img = 0
    for gid, members in sorted(groups.items()):
        first = min(members)
        pos = qpos(first)
        prev = qpos(first - 1)
        if not pos or not prev:
            continue
        # 上一题正文最后一行的底边：低于它的图才算材料图
        last_text_y = None
        (sp, sr), (ep, er) = prev, pos
        for pno in range(sp, ep + 1):
            y1 = er.y0 if pno == ep else doc[pno].rect.height
            for p, rect, _t in lines:
                if p == pno and prev[1].y0 <= rect.y0 and rect.y1 <= y1:
                    last_text_y = max(last_text_y or 0, rect.y1)
        regions = region_images(doc, (prev[0], prev[1].y0), (pos[0], pos[1].y0), last_text_y)
        regions = [
            (
                pno,
                rect,
                text_floor(lines, pno, prev[1].y0 if pno == prev[0] else 0, rect),
                text_ceiling(lines, pno, pos[1].y0 if pno == pos[0] else doc[pno].rect.height, rect),
            )
            for pno, rect in merge_by_page(regions)
        ]
        items = render_regions(doc, regions)
        if items:
            refs = write_image_files(img_dir, paper_id, items, "g", gid, dry)
            for q in questions:
                if q.get("groupId") == gid:
                    q["groupImage"] = refs
            n_group_img += 1
            print(f"  组{gid}（{first}-{max(members)}）材料图 {len(items)} 张")

    # 2) 图形/公式/图表题：题号 → 下一题题号 区域内的内嵌图
    n_q_img = 0
    idxs = sorted(by_idx)
    for i, n in enumerate(idxs):
        q = by_idx[n]
        if not needs_image(q):
            continue
        pos = qpos(n)
        if not pos:
            print(f"  ! 题{n}：试卷 PDF 未定位到题号，跳过")
            continue
        nxt = None
        for m in idxs[i + 1 :]:
            if qpos(m):
                nxt = qpos(m)
                break
        end = (nxt[0], nxt[1].y0 - 2) if nxt else (pos[0], doc[pos[0]].rect.height - FOOTER)
        regions = region_images(doc, (pos[0], pos[1].y0), end)
        regions = [
            (
                pno,
                rect,
                text_floor(lines, pno, pos[1].y0 if pno == pos[0] else 0, rect),
                text_ceiling(lines, pno, end[1] if pno == end[0] else doc[pno].rect.height, rect),
            )
            for pno, rect in merge_by_page(regions)
        ]
        items = render_regions(doc, regions)
        if items:
            q["image"] = write_image_files(img_dir, paper_id, items, "q", n, dry)
            # 题图已包含选项图形（图形推理/公式选项），清掉文本占位，
            # 前端按「纯图选项题」渲染成字母钮（XingcePracticePage imgQ 分支）
            for o in q.get("options", []):
                if (o.get("text") or "").strip() == PLACEHOLDER:
                    o["text"] = ""
            n_q_img += 1
            print(f"  题{n}（{q.get('subtype')}）题图 {len(items)} 张")
        else:
            print(f"  · 题{n}（{q.get('subtype')}）区域内无内嵌图（可能为矢量图，待裁整块）")

    if dry:
        print(f"✓ {json_path.name}（dry）：组材料图 {n_group_img} 组、题图 {n_q_img} 题")
        return
    json_path.write_text(json.dumps(paper, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ {json_path.name}：组材料图 {n_group_img} 组、题图 {n_q_img} 题")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json-dir", type=Path, default=DEFAULT_JSON_DIR)
    ap.add_argument("--img-dir", type=Path, default=DEFAULT_IMG_DIR)
    ap.add_argument("--q-dir", type=Path, default=DEFAULT_Q_DIR)
    ap.add_argument("--paper", help="单卷：<year>-<level>，如 2022-副省级")
    ap.add_argument("--year", type=int)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    files = sorted(args.json_dir.glob("guokao-xingce-*.json"))
    if args.paper:
        files = [f for f in files if args.paper in f.name]
    elif args.year:
        files = [f for f in files if f"xingce-{args.year}-" in f.name]
    elif not args.all:
        ap.error("需指定 --paper / --year / --all 之一")

    for jp in files:
        m = re.match(r"guokao-xingce-(\d{4})-(.+)\.json$", jp.name)
        if not m:
            continue
        year, level = int(m.group(1)), m.group(2)
        pdf = find_paper_pdf(args.q_dir, year, level)
        if not pdf:
            print(f"✗ {jp.name}：未找到对应真题 PDF")
            continue
        print(f"→ {jp.name} ← {pdf.name}")
        process(jp, pdf, args.img_dir, args.dry)


if __name__ == "__main__":
    main()
