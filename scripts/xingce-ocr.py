#!/usr/bin/env python3
"""行测资料分析「图表材料」OCR 回文字（docs/行测做题模块设计方案.md X1）

对 data/xingce/*.json 中材料缺失（图表/表格是 PDF 内嵌图片）的资料分析题组：
1. 定位组头「一、根据以下资料，回答 N-M 题」所在页与 y 坐标；
2. 截取组头 → 本组第一题之间的区域，OCR 识别；
3. 按行坐标聚类重建表格行（同一行的单元格用 | 分隔），写回 groupStem。

已知边界：统计图（柱状/饼图）与图形推理题图无法用 OCR 表达，对应题目保持不收录
（由 parse-xingce26.py 处理）。OCR 有误差，papers.warnings 里注明。

用法：python3 scripts/xingce-ocr.py <解析pdf目录> [data/xingce]
"""
import json
import re
import sys
from pathlib import Path

import pymupdf
from rapidocr_onnxruntime import RapidOCR

LEVELS = [("副省级", "副省级"), ("地市", "地市级"), ("行政执法", "行政执法")]
ZOOM = 3
ROW_GAP = 22  # 3x 缩放下行间距阈值（px）：低于它视为同一表格行
MATERIAL_MIN_TEXT = 100


def despace(s: str) -> str:
    return re.sub(r"\s+", "", s)


def clean_cell(s: str) -> str:
    # OCR 常把小数点后带空格：493. 5 → 493.5
    return re.sub(r"(\d)\.\s+(\d)", r"\1.\2", s).strip()


def main() -> None:
    src_dir = Path(sys.argv[1])
    data_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("data/xingce")
    ocr = RapidOCR()

    for jf in sorted(data_dir.glob("*.json")):
        paper = json.loads(jf.read_text(encoding="utf-8"))
        pdf = next(
            (p for p in src_dir.glob("*.pdf") if any(key in p.name for key, lv in LEVELS if lv == paper["level"])),
            None,
        )
        if pdf is None:
            print(f"✗ {jf.name}：找不到对应 PDF")
            continue
        doc = pymupdf.open(str(pdf))
        # 页缓存：despaced 文本 + OCR 结果（懒执行，每页只 OCR 一次）
        page_cache: dict[int, list] = {}

        def page_boxes(pi: int) -> list:
            if pi not in page_cache:
                pix = doc[pi].get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM))
                tmp = Path(f"/tmp/xg-ocr-{pi}.png")
                pix.save(str(tmp))
                res, _ = ocr(str(tmp))
                tmp.unlink()
                boxes = []
                for item in res or []:
                    box, text = item[0], item[1]
                    boxes.append((min(p[1] for p in box), min(p[0] for p in box), text))
                page_cache[pi] = boxes
            return page_cache[pi]

        def dashnorm(s: str) -> str:
            # OCR 常把题组范围的「—」识别成汉字「一」：数字之间的一视作连字符
            return re.sub(r"(?<=\d)一(?=\d)", "-", despace(s))

        def find_header(lo: int, hi: int) -> tuple[int, float] | None:
            """组头行（页号, y）"""
            for pi in range(len(doc)):
                for y, _x, text in page_boxes(pi):
                    td = dashnorm(text)
                    if "根据以下资料" in td and f"{lo}-{hi}题" in td:
                        return pi, y
            return None

        def first_q_y(pi: int, lo: int) -> float | None:
            for y, _x, text in page_boxes(pi):
                if despace(text).startswith(f"{lo}.") or despace(text).startswith(f"{lo}．"):
                    return y
            return None

        patched = 0
        warns_add = []
        groups_done: set[int] = set()
        for q in paper["questions"]:
            gid = q["groupId"]
            if gid is None or gid in groups_done:
                continue
            needs = q["groupStem"] is None or len(q["groupStem"]) < MATERIAL_MIN_TEXT
            if not needs or q.get("groupImage"):
                continue
            lo, hi = q["groupStart"], q["groupEnd"]
            if lo is None:
                continue
            hit = find_header(lo, hi)
            if hit is None:
                warns_add.append(f"题组{gid}（{lo}-{hi}题）：未定位到组头，材料缺失")
                groups_done.add(gid)
                continue
            pi, y0 = hit
            rows: list[dict] = []
            # 组头页 + 跨页：材料可能从页尾延续到下一页，直到本组第一题出现为止
            for cur in range(pi, min(pi + 3, len(doc))):
                y1 = first_q_y(cur, lo)
                top = y0 + 5 if cur == pi else 0
                bottom = y1 if y1 is not None else doc[cur].rect.height
                stop = y1 is not None
                for y, x, text in page_boxes(cur):
                    if not (top < y < bottom):
                        continue
                    if rows and y - rows[-1]["y"] < ROW_GAP:
                        rows[-1]["cells"].append((x, text))
                    else:
                        rows.append({"y": y, "cells": [(x, text)]})
                if stop:
                    break
            lines = [
                " | ".join(clean_cell(t) for _x, t in sorted(r["cells"], key=lambda v: v[0]))
                for r in rows
            ]
            material = "\n".join(lines).strip()
            if len(material) < 20:
                warns_add.append(f"题组{gid}（{lo}-{hi}题）：OCR 未得到有效材料内容")
                groups_done.add(gid)
                continue
            material = "【材料由 OCR 识别自真题原图，数字可能有误差】\n" + material
            for q2 in paper["questions"]:
                if q2["groupId"] == gid:
                    q2["groupStem"] = material
            groups_done.add(gid)
            patched += 1

        if warns_add:
            paper["warnings"] = list(paper.get("warnings") or []) + warns_add
        jf.write_text(json.dumps(paper, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"✓ {jf.name}：OCR 补材料 {patched} 组")


if __name__ == "__main__":
    main()
