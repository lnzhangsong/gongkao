#!/usr/bin/env python3
"""行测国考真题：PDF → 结构化 JSON（data/xingce/*.json，供 scripts/import-xingce.mjs 入库）

背景：2026 卷由「试卷答案解析」合并版 PDF 解析（scripts/parse-xingce26.py）；2000–2025
的推荐版是**真题 PDF + 答案解析 PDF 两套文件**，格式逐年不同，需要一条独立管线。
本脚本按「年份+卷别」把两份 PDF 配对，从真题 PDF 取题干/选项，从答案 PDF 取答案/解析，
合并为 import-xingce.mjs 约定的 schema。

范围与已知缺口（本阶段，用户 2026-09 裁定）：
- 只做**文本**：图形推理题图、资料分析图表/公式选项无文字时，`image` 留空并写 warnings；
  裁图回填沿用 scripts/xingce-images.py（后续阶段）。
- 扫描件（无文本层，如 2023 副省级/地市级真题、2002 B 卷答案、2021 副省级答案）本脚本
  不处理，会跳过并在报告里点名。

用法：
  python3 scripts/parse-xingce-pdf.py --paper 2022-副省级        # 单卷（样卷验证用）
  python3 scripts/parse-xingce-pdf.py --year 2022                # 某年全部卷别
  python3 scripts/parse-xingce-pdf.py --list                     # 只列出配对结果
  python3 scripts/parse-xingce-pdf.py --all                      # 全量（2000–2025）
"""
from __future__ import annotations

import argparse
import json
import os
import re
import unicodedata
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_Q_DIR = Path(
    "/Users/tomcat/Documents/docs/【01】国考真题资料/国考2000-2026真题pdf 【推荐用这个版本】"
    "/2000-2025国考行测PDF/行测-真题"
)
DEFAULT_A_DIR = Path(
    "/Users/tomcat/Documents/docs/【01】国考真题资料/国考2000-2026真题pdf 【推荐用这个版本】"
    "/2000-2025国考行测PDF/行测-答案及解析"
)
DEFAULT_OUT = ROOT / "data" / "xingce"

DURATION_MIN = 120
CN = "一二三四五六七八九十"
# 原卷为图片（图形推理选项、数学公式选项）时的占位文本；裁图回填后由 xingce-images.py 覆盖
OPT_PLACEHOLDER = "（原卷为图形/公式，待补图）"

# 公式选项：原卷是内嵌位图，这里转录为 LaTeX（前端 KaTeX 渲染，见 src/components/exam/MathText.tsx），
# 转录后该题不再回填题图（选项已有文本，parse-xingce-images.py 会自动跳过）。
# key = (year, level, idx) → A/B/C/D 的 LaTeX；同一道题在不同卷别重复出现时各自登记。
_CYLINDER = [r"$(\sqrt{2}+1)\pi+2$", r"$\sqrt{2}(\pi+2)$", r"$2\sqrt{2}(\pi-2)$", r"$2\sqrt{2}\pi-2$"]
_LAPTOP = [r"$\dfrac{125}{126}$", r"$\dfrac{125}{252}$", r"$\dfrac{25}{63}$", r"$\dfrac{50}{63}$"]
_TABLE_TENNIS = [r"$\dfrac{225}{256}$", r"$\dfrac{11}{15}$", r"$\dfrac{8}{11}$", r"$\dfrac{3}{4}$"]
FORMULA_OPTIONS: dict[tuple[int, str, int], list[str]] = {
    (2022, "副省级", 73): _CYLINDER,
    (2022, "地市级", 67): _CYLINDER,
    (2022, "地市级", 68): _LAPTOP,
    (2022, "地市级", 70): _TABLE_TENNIS,
    (2022, "行政执法", 65): _CYLINDER,
    (2022, "行政执法", 68): _LAPTOP,
    (2022, "行政执法", 70): _TABLE_TENNIS,
}

# ---------- 文本清洗 ----------

RADICAL_MAP = {
    "⻓": "长", "⺠": "民", "⻛": "风", "⻢": "马", "⻩": "黄", "⻋": "车", "⻔": "门",
    "⻄": "西", "⻬": "齐", "⻝": "食", "⻅": "见", "⻘": "青", "⻆": "角",
}


def fix_compat(s: str) -> str:
    out = []
    for ch in s:
        if ch in RADICAL_MAP:
            out.append(RADICAL_MAP[ch])
            continue
        o = ord(ch)
        if 0x2E80 <= o <= 0x2FDF or 0xF900 <= o <= 0xFAFF or 0x2F800 <= o <= 0x2FA1F:
            n = unicodedata.normalize("NFKC", ch)
            out.append(n if len(n) == 1 else ch)
        else:
            out.append(ch)
    return "".join(out)


def norm(s: str) -> str:
    """去 CJK/数字间抽取空格，保留英文词间空格。"""
    s = fix_compat(s).replace("\u3000", " ").replace("\xa0", " ")
    s = re.sub(r"(?<=[\u4e00-\u9fff])[ \t]+(?=[0-9A-Za-z])", "", s)
    s = re.sub(r"(?<=[0-9A-Za-z])[ \t]+(?=[\u4e00-\u9fff])", "", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


PAGE_FOOT_RE = re.compile(r"^[-—\s]*\d{1,3}[-—\s]*$|^第\s*\d+\s*页\s*共?\s*\d*\s*页?$|^\d{1,3}\s*/\s*\d{1,3}$")
SECTION_RE = re.compile(
    r"^(?:第([一二三四五六七八九十]+)部分|[一二三四五六七八九十]+、)\s*"
    r"(政治理论|常识判断|言语理解与表达|言语理解|数量关系|判断推理|资料分析|常识应用)"
    r"(?:[（(][^）)]*[）)])?\s*[：:，,]?.*$"
)
SEC_ALIAS = {"言语理解": "言语理解与表达", "常识应用": "常识判断"}

# 题干/材料重排：句末标点后的换行是真心换行；枚举标记行首保留换行
TERMINAL_RE = re.compile(r"[。！？；…：][”』」)）》】]*$")
MARK_RE = re.compile(r"^(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]|[（(][0-9一二三四五六七八九十]{1,3}[)）]|[一二三四五六七八九十]{1,3}、|\d{1,2}[.、](?!\d)|【)")


def reflow(lines: list[str]) -> str:
    out: list[str] = []
    for raw in lines:
        line = raw.strip()
        if not line:
            if out and out[-1] != "":
                out.append("")
            continue
        prev = out[-1] if out else None
        joinable = (
            prev is not None
            and prev != ""
            and not TERMINAL_RE.search(prev)
            and not MARK_RE.match(line)
        )
        if joinable:
            sep = " " if (prev[-1].isascii() and prev[-1].isalnum() and line[0].isascii() and line[0].isalnum()) else ""
            out[-1] = prev + sep + line
        else:
            out.append(line)
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out)


def extract_lines(pdf_path: Path) -> list[list[str]]:
    doc = pymupdf.open(pdf_path)
    pages: list[list[str]] = []
    for pg in doc:
        raw = pg.get_text("text").replace("\r\n", "\n")
        lines = []
        for l in raw.split("\n"):
            l = norm(l)
            if not l or PAGE_FOOT_RE.match(l):
                continue
            lines.append(l)
        pages.append(lines)
    doc.close()
    return pages


# ---------- 真题：题干 / 选项 ----------

OPT_RE = re.compile(r"^([A-E])\s*[.．、]\s*(.*)$")
Q_START_RE = re.compile(r"^(\d{1,3})\s*([.．、])\s*(.*)$")


def is_question_start(line: str, expect: int) -> tuple[int, str] | None:
    m = Q_START_RE.match(line)
    if not m:
        return None
    num = int(m.group(1))
    sep, rest = m.group(2), m.group(3).strip()
    if num != expect:
        return None
    # 「1.5 万亿」这类小数只有句点分隔符才需要排除；「3、2020 年…」是合法题干
    if sep in ".．" and rest[:1].isdigit():
        return None
    return num, rest


def clean_question_rest(rest: str) -> str:
    """去掉题号后的题型标记：「（单选题）」「(单选)」等。"""
    m = re.match(r"^[（(]\s*(单选题|多选题|不定项选择题?|单选|多选)\s*[)）]\s*(.*)$", rest)
    return m.group(2).strip() if m else rest


# 「选项后散行」判定为下一题材料的体量阈值：资料分析材料通常短，言语篇章阅读很长
MATERIAL_MIN_CHARS = 40
MATERIAL_MIN_CHARS_LONG = 120


def looks_like_material(lines: list[str], min_chars: int) -> bool:
    return sum(len(l) for l in lines) >= min_chars


def parse_questions(pages: list[list[str]]) -> dict:
    flat: list[str] = []
    for p in pages:
        flat.extend(p)
        flat.append("")
    title = next((l for l in flat if l), "")

    questions: list[dict] = []
    materials: dict[int, str] = {}  # 题号 → 该题组公共材料（资料分析图表文字 / 言语篇章阅读）
    section: str | None = None
    cur: dict | None = None
    cur_opt: int | None = None
    pre: list[str] = []  # 无 current 题时的散行（资料分析材料）
    expect = 1

    def settle_post(target: dict, post: list[str]) -> None:
        """选项后的散行：体量够大 => 下一题组的材料；否则并回最后一个选项（视觉换行）。"""
        if not post:
            return
        sec = target.get("section")
        min_chars = MATERIAL_MIN_CHARS if sec == "资料分析" else MATERIAL_MIN_CHARS_LONG
        if looks_like_material(post, min_chars):
            materials[target.get("next_idx") or 0] = reflow(post)
        elif target["options"]:
            target["options"][-1]["lines"].extend(post)
        else:
            target["stem_lines"].extend(post)

    def flush() -> None:
        nonlocal cur, cur_opt, pre
        if cur is not None and (cur["stem_lines"] or cur["options"]):
            cur["section"] = section
            settle_post(cur, cur.pop("_post", []))
            cur["stem"] = reflow(cur.pop("stem_lines"))
            for o in cur["options"]:
                o["text"] = reflow(o.pop("lines"))
            questions.append(cur)
        # 题目之间的散行（无 current 承接）也作为材料暂存
        if cur is None and section == "资料分析" and pre:
            materials[expect] = reflow(pre)
        cur, cur_opt, pre = None, None, []

    for line in flat:
        sec = SECTION_RE.match(line)
        if sec:
            flush()
            name = sec.group(2)
            section = SEC_ALIAS.get(name, name)
            continue
        if not line:
            continue
        started = is_question_start(line, expect)
        if started:
            flush()
            num, rest = started
            cur = {"idx": num, "options": [], "stem_lines": [clean_question_rest(rest)], "_post": [], "next_idx": None}
            # 题前材料（cur 为 None 时累积的散行）归属本题
            if pre:
                cur["groupStem"] = reflow(pre)
                materials[num] = cur["groupStem"]
                pre = []
            expect = num + 1
            continue
        if cur is None:
            if section == "资料分析":
                pre.append(line)
            continue
        om = OPT_RE.match(line)
        if om:
            cur["options"].append({"key": om.group(1), "lines": [om.group(2)]})
            cur_opt = len(cur["options"]) - 1
            continue
        if cur_opt is not None:
            cur["_post"].append(line)
            cur["next_idx"] = expect
        else:
            cur["stem_lines"].append(line)

    flush()
    return {"title": title, "questions": questions, "warnings": [], "materials": materials}


def parse_answers(pdf_path: Path) -> dict[int, dict]:
    pages = extract_lines(pdf_path)
    flat: list[str] = []
    for p in pages:
        flat.extend(p)
        flat.append("")
    text = "\n".join(flat)

    # 块头：「N.解析」「N. 解析」「第【N】题」等
    head_re = re.compile(r"(?m)^(?:第\s*【?\s*(\d{1,3})\s*】?\s*题|(\d{1,3})\s*[.．]\s*解析)\s*$")
    heads = [(m.start(), int(m.group(1) or m.group(2)), m.end()) for m in head_re.finditer(text)]
    # 「正确答案:【C】」型（2023 等）也可作为块头
    blocks: dict[int, str] = {}
    for k, (pos, num, end) in enumerate(heads):
        stop = heads[k + 1][0] if k + 1 < len(heads) else len(text)
        body = text[end:stop]
        if num not in blocks:
            blocks[num] = body
        else:
            blocks[num] += "\n" + body

    ANS_PAT = re.compile(
        r"因此[，,]\s*选择\s*([A-E])\s*选项"
        r"|正确答案[是为][:：]?\s*【?\s*([A-E])\s*】?"
        r"|故正确答案为\s*([A-E])"
        r"|答案为\s*([A-E])"
        r"|答案[:：]\s*【?\s*([A-E])\s*】?"
    )
    # 无块头时（整卷只有【N】解析 或 快速对答案表），额外尝试表格式答案
    out: dict[int, dict] = {}
    for num, body in blocks.items():
        m = ANS_PAT.search(body)
        ans = next((g for g in m.groups() if g), None) if m else None
        expl = body.strip()
        if not expl:
            expl = ""
        out[num] = {"answer": ans, "explanation": expl}
    return out


# ---------- 题型细分 ----------

def infer_subtype(section: str | None, stem: str, options: list[dict]) -> str | None:
    """从题干特征推细分题型（best-effort，仅用于前端筛选，不参与判分）。"""
    if section in ("常识判断", "政治理论"):
        return None
    if section == "数量关系":
        return "数学运算"
    if section == "资料分析":
        return "资料分析"
    if section == "言语理解与表达":
        if re.search(r"填入|横线|划线", stem):
            return "逻辑填空"
        if re.search(r"语序|排序|最适合放在.{0,12}位置|填入.{0,8}位置|接下来|下文|衔接", stem):
            return "语句表达"
        return "片段阅读"
    if section == "判断推理":
        opt_text = "".join(o["text"] for o in options)
        if re.search(r"从所给的四个选项中，选择最合适的一个填入问号处|图形|如上图|所给的四个图形", stem) or "如上图" in opt_text:
            return "图形推理"
        if re.search(r"根据上述定义|根据以下定义|下列.{0,12}定义", stem):
            return "定义判断"
        # 类比推理：短题干 + 词项分隔符（∶/：），或「…对于…相当于…」
        if re.search(r"对于.{0,15}相当于|相当于.{0,15}对于", stem) or (
            len(stem) <= 40 and re.search(r"[：:∶]", stem)
        ):
            return "类比推理"
        return "逻辑判断"
    return None


# ---------- 选项补全 ----------

INLINE_OPT_RE = re.compile(r"([A-E])\s*[.．、]\s*")


def recover_inline_options(q: dict) -> bool:
    """选项与题干挤在同一行的年份（如 2022 行政执法 83）：在 stem+已知选项 里找
    连续的 A→B→C→D 标记并重新切分。成功返回 True。"""
    if len(q["options"]) >= 4:
        return False
    text = q["stem"] + "".join(f"\n{o['key']}．{o['text']}" for o in q["options"])
    marks = [(m.start(), m.group(1), m.end()) for m in INLINE_OPT_RE.finditer(text)]
    best: list[tuple[int, str, int]] | None = None
    seq: list[tuple[int, str, int]] = []
    for m in marks:
        if m[1] == "A":
            seq = [m]
        elif seq and m[1] == chr(ord(seq[-1][1]) + 1):
            seq.append(m)
        else:
            seq = []
        if len(seq) >= 4 and seq[0][1] == "A":
            best = seq[:4]
    if not best:
        return False
    opts = [
        {"key": key, "text": text[end : best[i + 1][0] if i + 1 < len(best) else len(text)].strip()}
        for i, (_, key, end) in enumerate(best)
    ]
    stem = text[: best[0][0]].strip()
    if not stem or not all(o["text"] for o in opts):
        return False
    q["stem"], q["options"] = stem, opts
    return True


def ensure_four_options(q: dict) -> bool:
    """选项缺失（纯图片选项题，如 2022 地市级 67/68/70）或键不齐时，按 A-D 补齐占位。
    返回是否发生了补齐（用于写 warning）。"""
    keys = [o["key"] for o in q["options"]]
    if keys in (["A", "B", "C", "D"], ["A", "B", "C", "D", "E"]):
        return False
    if len(set(keys)) != len(keys) or any(k not in "ABCDE" for k in keys):
        return False
    if "E" in keys:
        return False  # E 缺失的 5 选项题不猜测补位，否则重建 A-D 会把 E 丢掉
    by_key = {o["key"]: o for o in q["options"]}
    q["options"] = [by_key.get(k, {"key": k, "text": ""}) for k in "ABCD"]
    return True


# ---------- 题组分组 ----------

GROUP_START_RE = re.compile(r"根据(?:以下资料|所给材料|所给的材料|下述材料)，?回答?\s*(\d+)\s*[-—–~至]\s*(\d+)\s*题")
PASSAGE_SECTION = "言语理解与表达"  # 言语篇章阅读：一篇材料带 5 题，与资料分析同为「题组」


def assign_groups(questions: list[dict], materials: dict[int, str], warnings: list[str]) -> None:
    """题组划分。

    - 资料分析：显式「根据以下资料，回答 N-M 题」组头优先；缺失时以文本材料出现处为界，
      并按国考惯例以 5 题补齐（材料是图表的组 groupStem 留空 + warning）。
    - 言语篇章阅读：以篇章材料出现处为界，一篇带 5 题。
    groupId 全卷统一编号（与 2026 卷数据一致）。
    """
    ranges: list[tuple[int, int, str | None]] = []

    zl = [q for q in questions if q.get("section") == "资料分析"]
    if zl:
        zl_set = {q["idx"] for q in zl}
        explicit = {
            int(m.group(1)): q["stem"]
            for q in zl
            for m in [GROUP_START_RE.search(q["stem"])]
            if m
        }
        first, last = zl[0]["idx"], zl[-1]["idx"]
        if explicit:
            bounds = sorted(set(explicit) | {first})
        else:
            seeds = sorted({i for i in materials if i in zl_set} | {first})
            # 与上一个保留界相隔 <3 题的丢弃（多为选项换行被误判成材料）
            bounds = []
            for s in seeds:
                if not bounds or s - bounds[-1] >= 3:
                    bounds.append(s)
        filled: list[int] = []
        for k, a in enumerate(bounds):
            b = bounds[k + 1] if k + 1 < len(bounds) else last + 1
            n = a
            while n < b:
                filled.append(n)
                n += 5
        for i, a in enumerate(filled):
            b = filled[i + 1] - 1 if i + 1 < len(filled) else last
            ranges.append((a, b, explicit.get(a) or materials.get(a)))
        if (last - first + 1) % 5:
            warnings.append(f"资料分析 {first}-{last} 题数非 5 的整数倍，末组为余数（组头按 5 题推定）")

    pyq = [q for q in questions if q.get("section") == PASSAGE_SECTION]
    if pyq:
        pyq_set = {q["idx"] for q in pyq}
        seeds = sorted(i for i in materials if i in pyq_set)
        for k, a in enumerate(seeds):
            b = seeds[k + 1] - 1 if k + 1 < len(seeds) else max(pyq_set)
            ranges.append((a, b, materials[a]))

    if not ranges:
        return

    ranges.sort()
    by_idx = {q["idx"]: q for q in questions}
    for gid, (a, b, stem) in enumerate(ranges, start=1):
        for n in range(a, b + 1):
            if n in by_idx:
                by_idx[n]["groupId"] = gid
                by_idx[n]["groupStem"] = stem

    zl_missing = [q["idx"] for q in zl if q.get("groupId") and not q.get("groupStem")]
    if zl_missing:
        if len(zl_missing) == len(zl):
            warnings.append("资料分析材料均为图表/图片，无法文本化")
        else:
            warnings.append(f"资料分析材料为图表/图片，未文本化：{zl_missing}")


# ---------- 单卷 ----------

def build_paper(year: int, level: str, q_pdf: Path, a_pdf: Path) -> dict:
    pages = extract_lines(q_pdf)
    parsed = parse_questions(pages)
    warnings: list[str] = []
    questions = parsed["questions"]

    # 选项修复：行内选项（题干与 A/B 挤在一行）切分；纯图片选项题按 A-D 补齐占位
    inline_fixed: list[int] = []
    padded: list[int] = []
    for q in questions:
        if recover_inline_options(q):
            inline_fixed.append(q["idx"])
        if ensure_four_options(q):
            padded.append(q["idx"])

    # 公式选项转录：覆盖占位文本，避免再被当作文本缺失
    formula_fixed: list[int] = []
    for q in questions:
        latex = FORMULA_OPTIONS.get((year, level, q["idx"]))
        if latex and len(latex) == len(q["options"]):
            for o, tex in zip(q["options"], latex):
                o["text"] = tex
            formula_fixed.append(q["idx"])

    # 答案 + 解析
    ans = parse_answers(a_pdf)
    for q in questions:
        a = ans.get(q["idx"])
        q["answer"] = a["answer"] if a else None
        q["explanation"] = (a["explanation"] or None) if a else None
        q["subtype"] = infer_subtype(q.get("section"), q["stem"], q["options"])
        q["image"] = None
        q["groupStem"] = q.get("groupStem")

    assign_groups(questions, parsed["materials"], warnings)
    if inline_fixed:
        warnings.append(f"行内选项已自动切分：{inline_fixed}")
    if padded:
        warnings.append(f"选项缺失，已按 A-D 补齐占位（纯图片选项题，待裁图）：{padded}")
    if formula_fixed:
        warnings.append(f"公式选项已转录 LaTeX、改由前端渲染：{formula_fixed}")

    # 质量核查
    no_ans = [q["idx"] for q in questions if not q["answer"]]
    no_exp = [q["idx"] for q in questions if not q["explanation"]]
    no_sec = [q["idx"] for q in questions if not q.get("section")]
    empty_opt = [q["idx"] for q in questions if any(not o["text"] for o in q["options"])]
    short_opt = [q["idx"] for q in questions if len(q["options"]) < 4]
    if no_ans:
        warnings.append(f"答案缺失：{no_ans}")
    if no_exp:
        warnings.append(f"解析缺失：{no_exp}")
    if no_sec:
        warnings.append(f"题型区段缺失：{no_sec}")
    if empty_opt:
        warnings.append(f"图形/公式选项无可提取文本（已占位，待裁图）：{empty_opt}")
    if short_opt:
        warnings.append(f"选项不足 4 项：{short_opt}")

    # 占位符：原卷是图片，暂无可渲染文本；保证入库校验通过，缺图题清单已写进 warnings
    for q in questions:
        for o in q["options"]:
            if not o["text"]:
                o["text"] = OPT_PLACEHOLDER

    title = parsed["title"] or f"{year}年国家公务员考试《行测》真题（{level}）"
    return {
        "id": f"guokao-xingce-{year}-{level}",
        "year": year,
        "level": level,
        "title": title,
        "durationMin": DURATION_MIN,
        "warnings": warnings,
        "questions": [
            {
                "idx": q["idx"],
                "section": q.get("section") or "未知",
                "subtype": q.get("subtype"),
                "groupId": q.get("groupId"),
                "groupStem": q.get("groupStem"),
                "stem": q["stem"],
                "options": q["options"],
                "answer": q.get("answer"),
                "explanation": q.get("explanation"),
                "image": None,
            }
            for q in questions
        ],
    }


# ---------- 文件配对 ----------

LEVEL_PAT = [
    ("副省级", re.compile(r"副省级|省级|省部级")),
    ("地市级", re.compile(r"地市级|市地级|地市")),
    ("行政执法", re.compile(r"行政执法")),
]


def file_level(name: str) -> str | None:
    for level, pat in LEVEL_PAT:
        if pat.search(name):
            return level
    return None


def file_year(name: str) -> int | None:
    m = re.search(r"(19|20)\d{2}", name)
    return int(m.group()) if m else None


def discover(q_dir: Path, a_dir: Path) -> list[dict]:
    """按 (year, level) 配对真题与答案 PDF。"""
    pairs: dict[tuple[int, str], dict] = {}
    for sub, key in ((q_dir, "q"), (a_dir, "a")):
        for f in sorted(sub.glob("*.pdf")):
            y, lv = file_year(f.name), file_level(f.name)
            if not y or not lv:
                continue
            pairs.setdefault((y, lv), {})[key] = f
    out = []
    for (y, lv), d in sorted(pairs.items()):
        out.append({"year": y, "level": lv, "q": d.get("q"), "a": d.get("a")})
    return out


def paper_has_text(pdf: Path, min_cjk: int = 300) -> bool:
    doc = pymupdf.open(pdf)
    txt = "".join(doc[i].get_text() for i in range(min(doc.page_count, 5)))
    doc.close()
    return len(re.findall(r"[\u4e00-\u9fff]", txt)) >= min_cjk


# ---------- 主流程 ----------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--q-dir", type=Path, default=DEFAULT_Q_DIR)
    ap.add_argument("--a-dir", type=Path, default=DEFAULT_A_DIR)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--paper", help="单卷：<year>-<level>，如 2022-副省级")
    ap.add_argument("--year", type=int, help="某年全部卷别")
    ap.add_argument("--all", action="store_true", help="全量 2000–2025")
    ap.add_argument("--list", action="store_true", help="只列出配对结果")
    args = ap.parse_args()

    pairs = discover(args.q_dir, args.a_dir)
    if args.paper:
        y, _, lv = args.paper.partition("-")
        pairs = [p for p in pairs if p["year"] == int(y) and p["level"] == lv]
    elif args.year:
        pairs = [p for p in pairs if p["year"] == args.year]
    elif not args.all:
        ap.error("需指定 --paper / --year / --all / --list 之一")

    if args.list:
        for p in pairs:
            ok = p["q"] and p["a"] and paper_has_text(p["q"]) and paper_has_text(p["a"])
            print(
                f"{p['year']} {p['level']:<4} {'✓' if ok else '✗'} "
                f"Q={p['q'].name if p['q'] else '—'} | A={p['a'].name if p['a'] else '—'}"
            )
        return

    args.out.mkdir(parents=True, exist_ok=True)
    for p in pairs:
        if not p["q"] or not p["a"]:
            print(f"✗ {p['year']} {p['level']}：缺真题或答案 PDF")
            continue
        if not paper_has_text(p["q"]) or not paper_has_text(p["a"]):
            print(f"✗ {p['year']} {p['level']}：扫描件无文本层，本阶段跳过")
            continue
        paper = build_paper(p["year"], p["level"], p["q"], p["a"])
        out = args.out / f"{paper['id']}.json"
        out.write_text(json.dumps(paper, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        n = len(paper["questions"])
        matched = sum(1 for q in paper["questions"] if q["answer"])
        sections = {}
        for q in paper["questions"]:
            sections[q["section"]] = sections.get(q["section"], 0) + 1
        print(f"✓ {out.name}：{n} 题，答案 {matched}/{n}")
        print(f"   区段 {sections}")
        for w in paper["warnings"]:
            print(f"   warn: {w}")


if __name__ == "__main__":
    main()
