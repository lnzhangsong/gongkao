#!/usr/bin/env python3
"""《申论写作八讲》（半月谈教育 编著）EPUB → 结构化 JSON（data/shenlun-book/book.json + images/）

把整本书拆成「讲 → 节 → 目」三级、以标题为界的渲染单元（unit）扁平结构：
  lectures  讲目录（前言为 idx=0）
  units     一个单元 = 一个标题 + 其下内容块（blocks）；level 1=讲导语（无标题）/2=节/3=目
内容块 type：p 正文 · sig 例文标题行（right-content）· center 例文文章题（center-content）
· img 图示。书里的「模型」图、参考答案、答案对比分析都是扫描图片，属于核心内容，
必须随文入库；jpg 统一转 webp 瘦身，文件名 l{讲}-{序}.webp。

源 EPUB 不进仓库（同申论真题 PDF 的处理方式，留在本地文档目录），仓库内只提交
处理后的 JSON 与图片；入库由 scripts/import-shenlun-book.mjs 完成。

用法：python3 scripts/parse-shenlun-book.py [--epub PATH] [--out DIR] [--quality N]
"""
import argparse
import html
import json
import os
import re
import shutil
import tempfile
import zipfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_EPUB = os.path.expanduser(
    "~/Downloads/申论写作八讲 (半月谈教育 编著) (z-library.sk, 1lib.sk, z-lib.sk).epub"
)
DEFAULT_OUT = os.path.join(ROOT, "data", "shenlun-book")

BOOK_ID = "shenlun-writing-8"
BOOK_TITLE = "申论写作八讲"
BOOK_AUTHOR = "半月谈教育 编著"

# 前言（fow001）作第 0 讲；txt001-008 为八讲正文
CHAPTERS = ["txt001", "txt002", "txt003", "txt004", "txt005", "txt006", "txt007", "txt008"]

HEADING_LEVEL = {"chapterTitle": 1, "sectionTitle": 2, "listTitle1": 3}

# 图片角色：图前最近的正文提示了图示性质（「模型」图 / 参考答案 / 例文），用于渲染角标
ROLE_PATTERNS = [
    (re.compile(r"模型"), "model"),
    (re.compile(r"参考答案|答案对比"), "answer"),
    (re.compile(r"例文|范文"), "essay"),
]


def strip_tags(fragment: str) -> str:
    """去标签 + 实体还原。段落内空白压缩为单空格——书里有「岁月失语 惟石能言」
    这类靠空格断词的标题，不能整段删空格；中文正文原本就没有内部空白，不受影响。"""
    text = re.sub(r"<[^>]+>", "", fragment)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def parse_body(raw: str) -> list[dict]:
    """<body> 按文档顺序拆为元素：{kind: heading|p|sig|center|img, ...}"""
    body = re.search(r"<body[^>]*>(.*)</body>", raw, re.S).group(1)
    items = []
    for m in re.finditer(r"<p([^>]*)>(.*?)</p>", body, re.S):
        attrs, inner = m.group(1), m.group(2)
        cls_m = re.search(r'class="([^"]+)"', attrs)
        cls = cls_m.group(1) if cls_m else ""
        img_m = re.search(r"<img([^>]*)>", inner)
        if img_m:
            iattrs = img_m.group(1)
            src = re.search(r'src="([^"]+)"', iattrs)
            if src:
                items.append({"kind": "img", "src": src.group(1), "iattrs": iattrs})
                continue
        text = strip_tags(inner)
        if not text:
            continue
        if cls == "right-content":
            items.append({"kind": "sig", "text": text})
        elif cls == "center-content":
            items.append({"kind": "center", "text": text})
        elif cls in HEADING_LEVEL:
            items.append({"kind": "heading", "level": HEADING_LEVEL[cls], "text": text})
        else:
            items.append({"kind": "p", "text": text})
    return items


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--epub", default=DEFAULT_EPUB, help="EPUB 源文件路径（不进仓库）")
    ap.add_argument("--out", default=DEFAULT_OUT, help="输出目录（book.json + images/）")
    ap.add_argument("--quality", type=int, default=82, help="webp 压缩质量")
    args = ap.parse_args()

    if not os.path.exists(args.epub):
        raise SystemExit(f"✗ 找不到 EPUB：{args.epub}")

    work = tempfile.mkdtemp(prefix="shenlun-book-")
    try:
        with zipfile.ZipFile(args.epub) as z:
            z.extractall(work)
        ops = os.path.join(work, "OPS")

        os.makedirs(os.path.join(args.out, "images"), exist_ok=True)
        img_names: set[str] = set()

        def convert(epub_rel: str, out_name: str) -> str:
            """jpg → webp（扫描图，webp 省一半以上体积；已存在则复用，脚本可重跑）。"""
            dst = os.path.join(args.out, "images", out_name)
            if out_name not in img_names:
                with Image.open(os.path.join(ops, epub_rel)) as im:
                    im.save(dst, "webp", quality=args.quality, method=6)
                img_names.add(out_name)
            return f"images/{out_name}"

        # 封面单独出（页面头部展示用）
        cover = None
        if os.path.exists(os.path.join(ops, "images/cover.jpg")):
            cover = convert("images/cover.jpg", "cover.webp")

        lectures = []
        units = []

        for lecture_idx, chapter in enumerate([None] + CHAPTERS):
            path = os.path.join(ops, "fow001.html" if chapter is None else f"{chapter}.html")
            if not os.path.exists(path):
                continue
            items = parse_body(open(path, encoding="utf-8").read())
            title = next((i["text"] for i in items if i["kind"] == "heading" and i["level"] == 1), "前言")
            lectures.append({"id": f"l{lecture_idx:02d}", "idx": lecture_idx, "title": title})

            # 图片按讲内出现顺序命名
            img_seq = 0
            for it in items:
                if it["kind"] == "img":
                    img_seq += 1
                    it["out"] = convert(it["src"], f"l{lecture_idx:02d}-{img_seq:02d}.webp")
                    w = re.search(r'width="(\d+)"', it["iattrs"])
                    h = re.search(r'height="(\d+)"', it["iattrs"])
                    it["w"] = int(w.group(1)) if w else None
                    it["h"] = int(h.group(1)) if h else None

            # 标题开新单元：标题前内容归讲导语（level 1、无标题）；小结目标 kind=summary
            seq = 0
            buf: list[dict] = []
            cur: tuple[int, str | None] | None = None
            last_text = ""

            def flush() -> None:
                nonlocal seq
                if not buf:
                    return
                seq += 1
                level, unit_title = cur if cur else (1, None)
                units.append(
                    {
                        "id": f"l{lecture_idx:02d}-u{seq:02d}",
                        "lecture": lecture_idx,
                        "idx": seq,
                        "level": level,
                        "title": unit_title,
                        "kind": "summary" if (unit_title or "").startswith("小结") else None,
                        "blocks": list(buf),
                    }
                )
                buf.clear()

            for it in items:
                if it["kind"] == "heading":
                    flush()
                    cur = (it["level"], it["text"] if it["level"] > 1 else None)
                    continue
                if it["kind"] == "img":
                    role = "figure"
                    for pat, r in ROLE_PATTERNS:
                        if pat.search(last_text):
                            role = r
                            break
                    blocks_item = {"type": "img", "src": it["out"], "w": it["w"], "h": it["h"], "role": role}
                else:
                    blocks_item = {"type": it["kind"], "text": it["text"]}
                    last_text = it["text"]
                buf.append(blocks_item)
            flush()

        book = {
            "id": BOOK_ID,
            "title": BOOK_TITLE,
            "author": BOOK_AUTHOR,
            **({"cover": cover} if cover else {}),
            "lectures": lectures,
            "units": units,
        }
        out_json = os.path.join(args.out, "book.json")
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(book, f, ensure_ascii=False, indent=1)
            f.write("\n")

        chars = sum(len(b["text"]) for u in units for b in u["blocks"] if b["type"] != "img")
        n_img = sum(1 for u in units for b in u["blocks"] if b["type"] == "img")
        img_mb = sum(os.path.getsize(os.path.join(args.out, "images", f)) for f in os.listdir(os.path.join(args.out, "images"))) / 1e6
        empty = [u["id"] for u in units if not u["blocks"]]
        print(
            f"✓ {BOOK_TITLE}：{len(lectures)} 讲 / {len(units)} 单元 / {chars} 字 / {n_img} 图"
            f"（images/ 共 {img_mb:.1f}MB）→ {os.path.relpath(out_json, ROOT)}"
        )
        if empty:
            raise SystemExit(f"✗ 空单元（标题下无内容，多半是解析切错了）：{empty}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
