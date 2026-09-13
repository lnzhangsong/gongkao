"""行测解析管线共享库：被 xingce-images.py（2026 裁图）、parse-xingce-images.py
（2000–2025 裁图）、parse-xingce26.py（2026 文本解析）三套脚本引用。

收编原则：只收**行为可证明等价**的实现（此前是三份复制后各自漂移，divergence 全是
docstring/空白/等价重构，唯一语义差是题号正则对顿号「、」的接受度——已参数化为
qnum_re，由各脚本传自己的正则；禁止在这里悄悄统一）。

测试：scripts/tests/test_xingce_common.py（unittest，不依赖 pymupdf 之外的第三方）。
"""

from __future__ import annotations

import re
from pathlib import Path

import pymupdf

# ---------- 常量（与各脚本原本的定义逐字一致） ----------

ZOOM = 2.5

# 截断 pypdf 粘进来的部分头/指导语/组头（xingce-images.py 与 parse-xingce26.py 原本
# 各有一份并注释「保持一致」——现在只剩这一份，想漂移都难）
LEAK_RE = re.compile(
    r"（共\s*\d+\s*题[，,]?参考时限"
    r"|请开始答题"
    r"|[一二三四五六七八九十]+、\s*(?:图形推理|定义判断|类比推理|逻辑判断|资料分析|数量关系|言语理解|言语理解与表达|常识判断|政治理论)"
    r"|(?:[一二三四五六七八九十]+、\s*)?根据(?:以下资料|所给材料|所给的材料|下述材料)，?回答?\s*\d+\s*[-—–~至]\s*\d+\s*题"
    r"|\d{1,3}[.．]\s*【解析】"
)

# 引流版尾部推广语（「…上岸咨询热线/微信：18650027100 要成公，选优公！圆您公职梦！」）
AD_CUT = re.compile(
    r"上岸咨询热线|要成公[，,]?选优公|圆您公职梦|优公教育|咨询热线[／/]|微信[：:]\s*\d{5,}"
)

# 两套管线的题号正则语义不同：2026 卷（xingce-images.py）不接受顿号题号，
# 2000–2025 卷（parse-xingce-images.py）接受。作为参数由调用方传入，不在此统一。
QNUM_RE_2026 = re.compile(r"^(\d{1,3})[.．]\s*")
# 2000–2025 卷接受顿号题号（2015–2021「N、」）；冒号是 2002 A 卷的「N：单选、」形态，
# 不接受会让题号链在 2002-A 上错位（1 被误配到资料分析的「1.12+1.22」），全卷配不到图。
QNUM_RE_2000_2025 = re.compile(r"^(\d{1,3})\s*[.．、:：]")


# ---------- 路径安全 ----------

def safe_paper_dir(img_dir: Path, paper_id: str) -> Path:
    """paper_id 来自 JSON，可能被写坏成绝对路径或含 ..：rmtree 前强制校验仍落在 img_dir 内，
    否则 ignore_errors=True 会安静地删到仓库外。"""
    root = img_dir.resolve()
    d = (img_dir / paper_id).resolve()
    if d == root or root not in d.parents:
        raise ValueError(f"paper_id 越界：{paper_id!r} → {d}")
    return d


# ---------- PDF 行索引 / 题号链 ----------

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
    """[(page_no, rect, text)] 全文行索引"""
    lines = []
    for pno in range(len(doc)):
        for rect, text in page_lines(doc[pno]):
            lines.append((pno, rect, text))
    return lines


def question_chain(lines, max_q, qnum_re: re.Pattern = QNUM_RE_2000_2025):
    """题号 n → (page, rect)：全文行序里挑一条严格递增的题号候选链。
    该卷缺的题号（各级卷题量不同）跳过不进链。"""
    chain = {}
    cur = (-1, pymupdf.Rect(0, 0, 0, 0))
    for n in range(1, max_q + 1):
        for pno, rect, text in lines:
            if (pno, rect.y0) <= (cur[0], cur[1].y0):
                continue
            m = qnum_re.match(text)
            if m and int(m.group(1)) == n:
                chain[n] = (pno, rect)
                cur = (pno, rect)
                break
    return chain


# ---------- 文本清理 ----------

def cut_leak(s: str, nxt: int | None = None) -> str:
    """截断粘进来的泄漏文本；nxt 给出紧邻下一题号时，连「N.」形态的下一题开头一起切
    （小数如 78.5 不切，题号后紧跟年份如 78.2024年 要切）。"""
    pat = LEAK_RE
    if nxt is not None:
        pat = re.compile(LEAK_RE.pattern + rf"|(?<![0-9]){nxt}[.．]\s*(?!\d{{1,2}}[^0-9])")
    m = pat.search(s)
    return s[: m.start()].rstrip() if m else s


def cut_ad(s: str | None) -> str | None:
    if s is None:
        return None
    m = AD_CUT.search(s)
    return s[: m.start()].rstrip() if m else s


# ---------- 图像工具 ----------

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


def write_image_files(
    img_dir: Path, paper_id: str, items: list[dict], kind: str, key: int, dry: bool = False
) -> list[dict]:
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
    """渲染后按非白像素收紧再留 pad 边：内容贴图的 bbox 常带大片空白边。返回 (png, w, h)。"""
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
