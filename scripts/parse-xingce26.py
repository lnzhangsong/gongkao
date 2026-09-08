#!/usr/bin/env python3
"""行测真题 PDF → 结构化 JSON（供 scripts/import-xingce.mjs 入库）

数据源：26国考行测「试卷答案解析」PDF（题目+答案+解析连续排版，单一数据源）
产出：data/xingce/guokao-xingce-2026-<level>.json

用法：python3 scripts/parse-xingce26.py <解析pdf目录> [输出目录]

解析策略（best-effort，宁多勿漏，warnings 里说明缺陷）：
- 题目切分：行首 `N.` 且 N 严格递增（避免误切正文中「1.5万亿」类数字）
- 答案：块内 `N.X。` 标记（X=正确选项）
- 解析：答案标记后的【解析】段
- 题组：资料分析 `一、根据以下资料，回答 116-120题` → groupId + groupStem
- 已知缺失（写进 warnings）：图形推理题图、资料分析图表/表格数据无法从文本提取
"""
import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

LEVELS = [("副省级", "副省级"), ("地市", "地市级"), ("行政执法", "行政执法")]
PART_RE = re.compile(r"^第[一二三四五六七八九十]+部分\s*(.+)$")
Q_START_RE = re.compile(r"^(\d{1,3})\.\s*")
ANS_RE = re.compile(r"^\d{1,3}\.\s*([A-E])\s*项?。", re.M)
OPT_SPLIT_RE = re.compile(r"([A-E])\s*[.、．]\s*")
GROUP_RE = re.compile(
    r"^(?:[一二三四五六七八九十]+、\s*)?根据(?:以下资料|所给材料|所给的材料|下述材料)，?回答?\s*(\d+)\s*[-—–~至]\s*(\d+)\s*题"
)
# 题组头被 pypdf 粘进上一题选项行的情况：按匹配位置拆成两行
INLINE_GROUP_RE = re.compile(
    r"根据(?:以下资料|所给材料|所给的材料|下述材料)，?回答?\s*\d+\s*[-—–~至]\s*\d+\s*题"
)
# pypdf 会把部分头/指导语/下一题解析粘进上一个选项的行——这些标记之后的文本一律截断
LEAK_RE = re.compile(
    r"（共\s*\d+\s*题[，,]?参考时限"
    r"|请开始答题"
    r"|[一二三四五六七八九十]+、\s*(?:图形推理|定义判断|类比推理|逻辑判断|资料分析|数量关系|言语理解|言语理解与表达|常识判断|政治理论)"
    r"|(?:[一二三四五六七八九十]+、\s*)?根据(?:以下资料|所给材料|所给的材料|下述材料)，?回答?\s*\d+\s*[-—–~至]\s*\d+\s*题"
    r"|\d{1,3}[.．]\s*【解析】"
)


def cut_leak(s: str, nxt: int | None = None) -> str:
    """截断粘进来的泄漏文本；nxt 给出紧邻下一题号时，连「N.」形态的下一题开头一起切
    （小数如 78.5 不切，题号后紧跟年份如 78.2024年 要切）。"""
    pat = LEAK_RE
    if nxt is not None:
        pat = re.compile(LEAK_RE.pattern + rf"|(?<![0-9]){nxt}[.．]\s*(?!\d{{1,2}}[^0-9])")
    m = pat.search(s)
    return s[: m.start()].rstrip() if m else s


# 引流版尾部推广语（「…上岸咨询热线/微信：18650027100 要成公，选优公！圆您公职梦！」）
AD_CUT = re.compile(
    r"上岸咨询热线|要成公[，,]?选优公|圆您公职梦|优公教育|咨询热线[／/]|微信[：:]\s*\d{5,}"
)


def cut_ad(s: str | None) -> str | None:
    if not s:
        return s
    m = AD_CUT.search(s)
    return s[: m.start()].rstrip() if m else s
FIG_Q_RE = re.compile(r"^从所给的四个选项中")


def extract_text(pdf: Path) -> str:
    reader = PdfReader(str(pdf))
    pages = []
    for p in reader.pages:
        t = p.extract_text() or ""
        pages.append(t)
    return "\n".join(pages)


def clean_lines(raw: str) -> list[str]:
    out = []
    for line in raw.split("\n"):
        s = line.strip()
        # 页码行、分隔线、页眉提示
        if re.fullmatch(r"\d{1,3}", s):
            continue
        if s.startswith("…") or "版权所有" in s or s.startswith("严禁折叠"):
            continue
        # 行中间粘出的题组头：拆成两行，让 GROUP_RE 能认出后半
        gm = INLINE_GROUP_RE.search(s)
        if gm and gm.start() > 0:
            out.append(s[: gm.start()].strip())
            s = s[gm.start() :].strip()
        out.append(s)
    return out


def parse_paper(pdf: Path, level: str) -> dict:
    lines = clean_lines(extract_text(pdf))
    section = None
    # 期望的下一题号：只有行首题号 == next_idx 才认为新题开始
    next_idx = 1
    blocks: list[dict] = []  # {idx, section, lines}
    cur: dict | None = None
    pending_group: dict | None = None
    group_counter = 0

    for line in lines:
        m = PART_RE.match(line)
        if m:
            section = m.group(1).strip()
            continue
        gm = GROUP_RE.match(line)
        if gm:
            group_counter += 1
            pending_group = {
                "groupId": group_counter,
                "start": int(gm.group(1)),
                "end": int(gm.group(2)),
                "lines": [],
            }
            continue
        qm = Q_START_RE.match(line)
        # 题组过界（当前题号 > 组 end）：关闭该组，防止吞掉后续题
        if pending_group and qm and int(qm.group(1)) > pending_group["end"]:
            pending_group = None
        # 进入「第一部分」之后才开始切题——否则卷首「注意事项 1.」会被当成第 1 题
        if qm and section is not None and int(qm.group(1)) == next_idx:
            # 上一题组收尾：若题组范围在上一题结束后才闭合也无所谓，按题逐个判断归属
            cur = {"idx": next_idx, "section": section, "lines": [Q_START_RE.sub("", line)], "group": None}
            if pending_group and cur["idx"] >= pending_group["start"]:
                cur["groupStart"] = pending_group["start"]
                cur["groupEnd"] = pending_group["end"]
            blocks.append(cur)
            next_idx += 1
            continue
        if cur is not None:
            cur["lines"].append(line)
        if pending_group and cur is not None and cur["group"] is None:
            # 题组材料：从组头到该组第一题开始之间累积的行
            if cur["idx"] >= pending_group["start"]:
                cur["group"] = pending_group["groupId"]
            else:
                pending_group["lines"].append(line)

    # 题组材料分配：group_id 相同的题共用 groupStem（取组内第一题前累积文本不可靠，
    # 改为：解析期把 pending_group 的 lines 记到组号上）
    group_stems: dict[int, list[str]] = {}
    # 重扫一遍收集材料文本（上面首扫未保存组头行）
    section2 = None
    pending = None
    gc = 0
    seen_idx = 0
    group_starts: dict[int, int] = {}
    for line in lines:
        m = PART_RE.match(line)
        if m:
            section2 = m.group(1).strip()
            continue
        gm = GROUP_RE.match(line)
        # 与首扫一致：统计所有题组头（不再只限资料分析），否则组号错位
        if gm:
            gc += 1
            pending = gc
            group_stems.setdefault(pending, [])
            group_starts[pending] = int(gm.group(1))
            continue
        qm = Q_START_RE.match(line)
        if qm and int(qm.group(1)) == seen_idx + 1:
            seen_idx = int(qm.group(1))
            # 进入组内第一题后材料收集即完成
            if pending is not None and seen_idx >= group_starts[pending]:
                pending = None
            continue
        if pending is not None:
            group_stems[pending].append(line)

    warnings = []
    no_answer = []
    questions = []

    def norm(t: str) -> str:
        # PDF 换行是排版产物，中文题干直接拼回一行
        return t.replace("\n", "").strip()

    fig_skipped: list[int] = []
    for b in blocks:
        text = "\n".join(b["lines"])
        # 答案标记：块内行首 N.X。
        ans_m = ANS_RE.search(text)
        answer = None
        explanation = None
        if ans_m:
            answer = ans_m.group(1)
            tail = text[ans_m.end():].strip()
            tail = re.sub(r"^【解析】\s*", "", tail)
            # 引流版里上一题解析后面会粘下一段的部分头/指导语/下一题组材料
            tail = cut_leak(tail, b["idx"] + 1)
            tail = re.sub(r"^因此，?本题答案为\s*[A-E]\s*项?。?\s*$", "", tail, flags=re.M).strip()
            explanation = tail or None
        body = text[: ans_m.start()] if ans_m else text
        # 选项切分：从行首 A. 起
        opt_area = OPT_SPLIT_RE.split(body)
        # 找第一个独立的 A 标记（选项区起点）
        keys = opt_area[1::2]
        a_pos = None
        for i in range(1, len(opt_area), 2):
            if opt_area[i] == "A":
                a_pos = i
                break
        stem = body.strip()
        options = []
        # 以行内「字母+点」标记切分；chunks 形如 [题干, 'A', 文本, 'B', 文本, ...]
        # 不收「、」变体：题干里「A、B、C 三个品牌」会被误切
        chunks = re.split(r"(?:^|\n|\s)([A-E])\s*[.．]\s*", body)
        if len(chunks) >= 3 and "A" in chunks[1::2]:
            stem = cut_leak(chunks[0].strip(), b["idx"] + 1)
            for i in range(1, len(chunks) - 1, 2):
                options.append({"key": chunks[i], "text": cut_leak(chunks[i + 1].strip(), b["idx"] + 1)})
            # 双栏排版的选项 pypdf 按行抽出后键序可能乱（A,C,B,D），按键重排
            options.sort(key=lambda o: o["key"])
        is_fig = bool(FIG_Q_RE.match(stem))
        # 图形推理/饼图选项题：题图是图片，OCR 无法表达 → 不收录（表格材料由 xingce-ocr.py 回文字）
        if is_fig or len(options) < 2:
            fig_skipped.append(b["idx"])
            continue
        gid = b.get("group")
        gstem = "\n".join(group_stems.get(gid, [])).strip() or None if gid else None
        if is_fig:
            warnings.append(f"第{b['idx']}题为图形推理，题图未能从 PDF 提取")
        if answer is None:
            no_answer.append(b["idx"])
        if gid and not gstem:
            warnings.append(f"第{b['idx']}题所属资料分析题组的图表/表格材料未能从 PDF 提取")
        questions.append(
            {
                "idx": b["idx"],
                "section": b["section"],
                "subtype": "图形推理" if is_fig else None,
                "groupId": gid,
            "groupStart": b.get("groupStart"),
            "groupEnd": b.get("groupEnd"),
                "groupStem": norm(gstem) if gstem else None,
                "stem": norm(stem),
                "options": [
                    {"key": o["key"], "text": norm(o["text"])} for o in options
                ],
                "answer": answer,
                "explanation": norm(explanation) if explanation else None,
                "image": None,
            }
        )

    if no_answer:
        warnings.append(f"答案缺失（引流版解析未收录详解）：共 {len(no_answer)} 题")
    if fig_skipped:
        warnings.append(f"图形推理/图片选项题 {len(fig_skipped)} 题为图片形态，OCR 无法表达，未收录（题号 {fig_skipped[0]}–{fig_skipped[-1]}）")

    # 后处理：大段无标记词的粘连（如题组材料整段粘进上一题选项）无法靠 LEAK_RE 截断，
    # 用「其它题的题干/题组材料开头」交叉匹配定位切点
    starts = [t[:24] for q in questions for t in (q.get("groupStem"), q.get("stem")) if t]

    def decontam(t: str | None) -> str | None:
        if not t:
            return t
        cut = None
        for s0 in starts:
            i = t.find(s0, 8)  # 从第 8 字符起找：题干以材料开头属正常，不算粘连
            if i > 0 and (cut is None or i < cut):
                cut = i
        return t[:cut].rstrip() if cut is not None else t

    for q in questions:
        q["stem"] = cut_ad(decontam(q["stem"]))
        q["explanation"] = cut_ad(decontam(q["explanation"]))
        for o in q["options"]:
            o["text"] = cut_ad(decontam(o["text"]))
    return {
        "id": None,  # 由调用方按 level 填
        "level": level,
        "questions": questions,
        "warnings": sorted(set(warnings)),
    }


def main() -> None:
    src_dir = Path(sys.argv[1])
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("data/xingce")
    out_dir.mkdir(parents=True, exist_ok=True)
    for pdf in sorted(src_dir.glob("*.pdf")):
        level = next((lv for key, lv in LEVELS if key in pdf.name), None)
        if not level:
            continue
        paper = parse_paper(pdf, level)
        paper["id"] = f"guokao-xingce-2026-{level}"
        paper["year"] = 2026
        paper["title"] = f"2026年国家公务员考试《行测》题（{level}）"
        paper["durationMin"] = 120
        out = out_dir / f"{paper['id']}.json"
        out.write_text(json.dumps(paper, ensure_ascii=False, indent=2), encoding="utf-8")
        answered = sum(1 for q in paper["questions"] if q["answer"])
        print(f"✓ {out.name}：{len(paper['questions'])} 题（有答案 {answered}），warnings {len(paper['warnings'])} 条")
        for w in paper["warnings"][:5]:
            print(f"   - {w}")
        if len(paper["warnings"]) > 5:
            print(f"   - …等共 {len(paper['warnings'])} 条")


if __name__ == "__main__":
    main()
