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
# 2023–2025 卷的页脚/页眉会被 PyMuPDF 并进正文行（甚至插进句子中间，如「…之第5页,共25页下，…」），
# 整行锚定的 PAGE_FOOT_RE 抓不到，必须行内清理。
INLINE_FOOT_RE = re.compile(r"第\s*\d+\s*页\s*[，,]?\s*共\s*\d+\s*页?")
INLINE_HEAD_RE = re.compile(
    r"20\d{2}\s*年?\s*(?:国家公务员录用考试|国考)\s*《行测》[^（(）)]{0,16}(?:[（(][^）)]*[）)])?"
)


def strip_page_artifacts(line: str) -> str:
    """删掉行内页脚（第N页，共M页）与卷名页眉；循环到稳定，因两者常首尾相接。"""
    prev = None
    while prev != line:
        prev = line
        line = INLINE_FOOT_RE.sub("", line)
        line = INLINE_HEAD_RE.sub("", line)
    return line.strip()
SECTION_RE = re.compile(
    r"^(?:第([一二三四五六七八九十]+)部分|[一二三四五六七八九十]+[、.．])\s*"
    r"((?:政治理论|常识判断|常识应用|言语理解与表达|言语理解|数量关系|数字推理|数学运算"
    r"|判断推理|图形推理|定义判断|演绎推理|类比推理|事件排序|机械推理|资料分析))"
    r"(?:[（(][^）)]*[）)])?\s*[：:，,]?.*$"
)
# 行首名称（无「第X部分/N、」前缀）——「第X部分」与名称分行时的跨行合并用
SECTION_NAME_RE = re.compile(
    r"^(?:政治理论|常识判断|常识应用|言语理解与表达|言语理解|数量关系|数字推理|数学运算"
    r"|判断推理|图形推理|定义判断|演绎推理|类比推理|事件排序|机械推理|资料分析)"
)
PART_LINE_RE = re.compile(r"^第[一二三四五六七八九十]+部分\s*$")
SEC_ALIAS = {
    "言语理解": "言语理解与表达",
    "常识应用": "常识判断",
    # 早年（2000–2006）数量/判断部分的子块名归并到父区段（细分题型由 infer_subtype 推）
    "数字推理": "数量关系",
    "数学运算": "数量关系",
    "图形推理": "判断推理",
    "定义判断": "判断推理",
    "演绎推理": "判断推理",
    "类比推理": "判断推理",
    "事件排序": "判断推理",
    "机械推理": "判断推理",
}

# 题干/材料重排：句末标点后的换行是真心换行；枚举标记行首保留换行
TERMINAL_RE = re.compile(r"[。！？；…：][”』」)）》】]*$")
# 「16-25」整块图形推理：文本层只有区间号，10 道题全是矢量图（2003-B 卷）
RANGE_LINE_RE = re.compile(r"^(\d{1,3})\s*[-—–~至]\s*(\d{1,3})$")
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
    for pno, pg in enumerate(doc):
        raw = pg.get_text("text").replace("\r\n", "\n")
        lines = []
        for l in raw.split("\n"):
            l = norm(l)
            if not l:
                continue
            # 首页开头的含「行测」行是卷标题，和页眉同形，别被 strip_page_artifacts 删掉；
            # 页眉也可能在 get_text 顺序里落到页尾（2023 行政执法在第 56 行），用「前 3 行」限制住。
            if pno == 0 and len(lines) <= 2 and "行测" in l and not PAGE_FOOT_RE.match(l):
                lines.append(l)
                continue
            l = strip_page_artifacts(l)
            if not l or PAGE_FOOT_RE.match(l):
                continue
            lines.append(l)
        pages.append(lines)
    doc.close()
    return pages


# ---------- 真题：题干 / 选项 ----------

OPT_RE = re.compile(r"^([A-E])\s*[.．、]\s*(.*)$")
Q_START_RE = re.compile(r"^(\d{1,3})\s*([.．、:：]?)\s*(.*)$")


def is_question_start(line: str, expect: int) -> tuple[int, str, bool] | None:
    """匹配 (题号, 题干, 是否跳号)。跳号 = PDF 里中间题整题缺失（2006 卷 52 题不存在）。"""
    m = Q_START_RE.match(line)
    if not m:
        return None
    num = int(m.group(1))
    sep, rest = m.group(2), m.group(3).strip()
    if not sep:
        # 无分隔符（2019 卷「47基础数学是…」）：顺序保护下只在严格等于 expect 时接受
        return (num, rest, False) if num == expect else None
    if num < expect:
        return None
    if num > expect:
        # 跳号：仅带分隔符、跨度有限、且题干有实义文本时接受——
        # 资料分析表格文本「100.0」（纯数字小数）、断行百分比「19.3%）相比…」不是题号（2001/2007 卷踩过）
        if num - expect <= 10 and re.search(r"[^\d\s.．]", rest) and not re.match(r"^\d+(?:\.\d+)?%", rest):
            return (num, rest, True)
        return None
    # 「1.5 万亿」这类小数只有句点分隔符才需要排除；「3、2020 年…」是合法题干。
    # 但数量关系题干本身就可能以数字开头：「23.1，2，2，4，( )」（数列，数字后逗号）、
    # 「38．19991998的末位数字」（长数字）、「5.2／3，1／2」（分数斜杠）、「27．6」（纯数字）、
    # 「46.1 235×6 788」（千分位空格）、「96.70年代…」（整数+年代）——
    # 只有「1–2 位数字 + 紧跟汉字/字母」才是真小数（'5万亿'）
    if sep in ".．" and re.match(r"^\d{1,2}(?!年代)[^\d，,、／/\s]", rest):
        return None
    return num, rest, False


def clean_question_rest(rest: str) -> str:
    """去掉题号后的题型标记：「（单选题）」「(单选)」「单选、」（2002 卷）等。"""
    m = re.match(r"^(?:[（(]\s*)?(单选题|多选题|不定项选择题?|单选|多选)\s*[)）、]?\s*(.*)$", rest)
    return m.group(2).strip() if m else rest


# 「选项后散行」判定为下一题材料的体量阈值：资料分析材料通常短，言语篇章阅读很长
MATERIAL_MIN_CHARS = 40
MATERIAL_MIN_CHARS_LONG = 120


def looks_like_material(lines: list[str], min_chars: int) -> bool:
    return sum(len(l) for l in lines) >= min_chars


# 资料分析组头标记：「（二）」「一、根据下列图表回答问题。」「回答 111～115 题」等
ZL_GROUP_MARK_RE = re.compile(
    r"^[（(]\s*[一二三四五六七八九十\d]+\s*[）)]"
    r"|根据(?:以下资料|所给材料|所给的材料|下述材料|下列图表|下列资料|下图|上图)"
    r"|回答?\s*\d+\s*[-—–~至]\s*\d+\s*题"
)
ZL_STEM_END_RE = re.compile(r"[？?：:]$")


def split_zl_material(lines: list[str]) -> tuple[str | None, list[str]]:
    """资料分析组首题缺号时，_post 里混着「组头 + 材料」与本题题干。按组头标记定位材料，
    再以题干结尾标点（？/：）切出题干，返回 (材料文本 | None, 题干行)。无组头标记则整段当题干。"""
    k = next((i for i, l in enumerate(lines) if ZL_GROUP_MARK_RE.search(l)), None)
    if k is None:
        return None, lines
    tail = lines[k:]
    s = next((i for i in range(len(tail) - 1, -1, -1) if ZL_STEM_END_RE.search(tail[i])), len(tail) - 1)
    material, stem = tail[:s], tail[s:]
    if not material or not stem:
        return None, lines
    return reflow(material), stem


def parse_questions(pages: list[list[str]]) -> dict:
    flat: list[str] = []
    for p in pages:
        flat.extend(p)
        flat.append("")
    # 早年（2000–2014）区段标题跨两行：「第一部分\n言语理解」。把「第X部分」行与
    # 下一行的区段名合并，SECTION_RE 才能识别（合并用名称前缀正则，不要求完整一行）
    merged: list[str] = []
    i = 0
    while i < len(flat):
        line = flat[i]
        if PART_LINE_RE.match(line) and i + 1 < len(flat) and SECTION_NAME_RE.match(flat[i + 1]):
            merged.append(line + flat[i + 1])
            i += 2
            continue
        merged.append(line)
        i += 1
    flat = merged
    # 2024 卷选项断行：「B\n                   .2项」→ 合并为「B.2项」
    # （PDF 把选项字母单独成行，内容行的「.」留在下一行且前导空格已被 strip）
    fixed: list[str] = []
    i = 0
    while i < len(flat):
        line = flat[i]
        if re.fullmatch(r"[A-E]", line) and i + 1 < len(flat) and re.match(r"[.．]", flat[i + 1]):
            fixed.append(line + flat[i + 1])
            i += 2
            continue
        fixed.append(line)
        i += 1
    flat = fixed
    # 图形题选项字母挤在一行（2003-A 卷 17「C D」）：拆成独立字母行，后续按空文本选项收
    split_letters: list[str] = []
    for l in flat:
        if re.fullmatch(r"(?:[A-E][ \t]*){2,5}", l):
            split_letters.extend(re.findall(r"[A-E]", l))
        else:
            split_letters.append(l)
    flat = split_letters
    # 2024/2025 卷「题号后置」格式：题干在前，「N.」独立成行，选项跟在题号行后。
    # 把每道题的题干段挪回题号行（合并成「N.题干首行」），恢复「N.题干」的常规流。
    bare = [i for i, l in enumerate(flat) if re.match(r"^\d{1,3}\.$", l)]
    bare_nums = sorted(int(flat[i][:-1]) for i in bare)
    # 只有全卷题号都后置（从 1 开始、密集）才重排；2003-A 卷 16–25 图形推理也是「N.」独立成行，
    # 但它从 16 起跳，误触发会把题干重排成「A B C D」并吞掉第 16 题。
    if len(bare) >= 10 and bare_nums[0] <= 2:
        OPT_LINE = re.compile(r"^[A-E][.．、]")
        SEC_LINE = re.compile(r"^(?:第[一二三四五六七八九十]+部分|[一二三四五六七八九十]+[、.．])")
        for i in reversed(bare):  # 从后往前挪，前面段的索引不受影响；挪动段行数不变
            n = int(flat[i][:-1])
            j = i
            while j > 0:
                prev = flat[j - 1]
                if not prev or OPT_LINE.match(prev) or SEC_LINE.match(prev) or re.match(r"^\d{1,3}\.$", prev):
                    break
                j -= 1
            if j < i:
                stem = flat[j:i]
                flat[j : i + 1] = [f"{n}.{stem[0]}"] + stem[1:]
    # 标题取首个区段标题之前的非区段/题号行；区段行之前没有标题（2023 卷）则留空走 fallback
    sec_at = next((i for i, l in enumerate(flat) if SECTION_RE.match(l)), None)
    head_lines = flat[:sec_at] if sec_at is not None else flat
    title = next((l for l in head_lines if l and not re.match(r"^\d{1,3}[.．、]", l)), "")

    questions: list[dict] = []
    materials: dict[int, str] = {}  # 题号 → 该题组公共材料（资料分析图表文字 / 言语篇章阅读）
    warnings: list[str] = []
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
        rm = RANGE_LINE_RE.match(line)
        if rm and section == "判断推理":
            a, b = int(rm.group(1)), int(rm.group(2))
            if 0 < b - a + 1 <= 15 and a >= expect:
                flush()
                for n in range(a, b + 1):
                    # 整题为矢量图，文本层无题干/选项字母：建题占位，图由裁图脚本按行带切
                    questions.append(
                        {
                            "idx": n,
                            "options": [],
                            "stem_lines": [""],
                            "stem": "",
                            "section": section,
                            "_post": [],
                            "next_idx": None,
                            "_subtype": "图形推理",
                        }
                    )
                warnings.append(f"图形推理 {a}-{b} 为整块图，已按题号建题（待补图）")
                expect = b + 1
                cur, cur_opt, pre = None, None, []
                continue
        started = is_question_start(line, expect)
        if started:
            num, rest, skipped = started
            flush()
            if skipped:
                warnings.append(f"题号跳缺 {expect}–{num - 1}（PDF 里整题缺失）")
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
                # 资料分析组首题常缺题号，且刚好落在「上一题的选项之后、无 current 题」的窗口里
                # （2016 地市 111/112）：pre 里已积累「组头+材料+题干」，遇到第一个 A 选项即可补题。
                om0 = OPT_RE.match(line)
                if om0 and om0.group(1) == "A" and pre and ZL_STEM_END_RE.search(pre[-1]):
                    material, stem_lines = split_zl_material(pre)
                    num = expect
                    cur = {
                        "idx": num,
                        "options": [],
                        "stem_lines": stem_lines,
                        "_post": [],
                        "next_idx": None,
                    }
                    if material:
                        materials[num] = material
                    pre = []
                    warnings.append(f"第{num}题题号缺失，已按顺序补号")
                    expect = num + 1
                    cur["options"].append({"key": "A", "lines": [om0.group(2)]})
                    cur_opt = 0
                    continue
                pre.append(line)
            continue
        om = OPT_RE.match(line)
        if om:
            key, text = om.group(1), om.group(2)
        elif cur is not None:
            # 图形题选项常只有字母、图在文本层外（2003-A 卷 16–25）：整行单个字母且正好是
            # 当前题的下一个选项键，就当空文本选项。杂散字前缀（2019 省级 q60「呢B、…」）同理。
            expect_key = chr(ord(cur["options"][-1]["key"]) + 1) if cur["options"] else "A"
            existing = {o["key"] for o in cur["options"]}
            # 单个字母行：按顺序的下一键，或与已有选项重复（上一题 4 项已满、新题题号又缺失时，
            # 是新题的第一个 A；交给下面的「选项 key 重复」分支补号）。
            if re.fullmatch(r"[A-E]", line) and (line == expect_key or line in existing):
                key, text = line, ""
            else:
                m3 = re.match(r"^[^\sA-Ea-e]{1,2}\s*([A-E])\s*[.．、]\s*(.+)$", line)
                if m3 and m3.group(1) == expect_key:
                    key, text = m3.group(1), m3.group(2)
                else:
                    key = text = None
        else:
            key = text = None
        if key is not None:
            if any(o["key"] == key for o in cur["options"]):
                # 排版粘连（2018 副省「B、C、柏林…」）：上一选项字母粘到本行行首，本选项真字母在 text 里
                m2 = re.match(r"^([A-E])\s*[.．、]\s*(.*)$", text)
                if m2 and not any(o["key"] == m2.group(1) for o in cur["options"]):
                    key, text = m2.group(1), m2.group(2)
                else:
                    # 选项字母重复 = 新题开始：题号行缺失（2012 卷 104、2016 地市 32）或被
                    # 小数守卫误拒（2003-A 卷 78/124、2003-B 卷 5）时，上一题会把新题的题干
                    # 与选项一起吞掉（表现为「选项 key 重复」）。把 _post 里累积的散行当作
                    # 新题题干，题号按顺序补 expect。
                    stem_lines = cur.pop("_post", [])
                    if stem_lines:
                        stem_lines[0] = re.sub(r"^\d{1,3}\s*[.．、:：]\s*", "", stem_lines[0])
                    # 资料分析组首题缺号：_post 前半是组头+材料，后半才是题干——
                    # 材料要单独存进 materials（assign_groups 靠它分组），否则整组材料会
                    # 混进题干预设、分组也会串位。
                    material, stem_lines = (split_zl_material(stem_lines) if section == "资料分析" else (None, stem_lines))
                    flush()
                    num = expect
                    cur = {
                        "idx": num,
                        "options": [],
                        "stem_lines": stem_lines,
                        "_post": [],
                        "next_idx": None,
                    }
                    if material:
                        materials[num] = material
                    if pre:
                        cur["groupStem"] = reflow(pre)
                        materials[num] = cur["groupStem"]
                        pre = []
                    warnings.append(f"第{num}题题号缺失，已按顺序补号")
                    expect = num + 1
                    cur["options"].append({"key": key, "lines": [text]})
                    cur_opt = len(cur["options"]) - 1
                    continue
            cur["options"].append({"key": key, "lines": [text]})
            cur_opt = len(cur["options"]) - 1
            continue
        if cur_opt is not None:
            cur["_post"].append(line)
            cur["next_idx"] = expect
        else:
            cur["stem_lines"].append(line)

    flush()
    return {"title": title, "questions": questions, "warnings": warnings, "materials": materials}


def answers_from_text(text: str) -> dict[int, dict]:
    """答案解析纯文本解析（parse_answers 的内核，独立出来以便无 PDF 回归测试——
    scripts/tests/test_xingce_answers.py 用真实 bug 案例锁住这里的每个分支）。"""

    # 块头：「N.解析」「N. 解析」「第【N】题」，以及 2015–2021 的「N、」
    # （题号+顿号，题干与解析紧跟在同一行，所以这一支不加行尾锚点）；
    # 2000–2006 为「N.A【解析】」/「N.B［解析］」（2006 全角方括号）/「N【答案】」（2004 B，无分隔符），
    # 括号内的答案字母在解析内文缺失时兜底
    head_re = re.compile(
        r"(?m)^(?:第\s*【?\s*(\d{1,3})\s*】?\s*题|(\d{1,3})\s*[.．]\s*解析)\s*$"
        # 「N、」裸顿号块头（2015–2021）：后面不能紧跟另一个「数字、」，那是正文枚举（2004B「41、42、44…」）
        r"|^(?:(\d{1,3}))\s*、(?!\s*\d{1,3}\s*[、.．])"
        # 结构化块头（「N.A【解析】」「N【答案】C」「N.B［解析］」），字母在括号前或括号后
        r"|(\d{1,3})\s*[.．、]?\s*([A-E]{1,5})?\s*[【\[［]\s*(?:解析|答案)\s*[】\]］]\s*([A-E]{1,5})?"
        # 2003 卷：「70.B」独立成行（多选题字母可达 5 个），【解析】在下一行（行首+行尾锚定防误切正文）
        r"|^(\d{1,3})\s*[.．、]?\s*([A-E]{1,5})\s*$"
        r"|【\s*(\d{1,3})\s*】\s*解析"
    )
    heads: list[tuple[int, int, int, str | None]] = []
    seen: set[int] = set()
    last: int | None = None
    for m in head_re.finditer(text):
        num = int(m.group(1) or m.group(2) or m.group(3) or m.group(4) or m.group(7) or m.group(9))
        letter = m.group(5) or m.group(6) or m.group(8)
        # 去重 + 限制跨度：解析正文里的「1、」式枚举通常与已出现的题号重复；
        # 允许小跨度乱序（2016 副省答案 PDF 里 79 排在 77/78 之前），但不接受跳到很远的号。
        # 例外：带结构标记的块头（【答案】/【解析】/「N.字母」行）文本顺序可乱（2004B 提取乱序），
        # 只要题号没见过就接受——「N、」裸顿号分支才受 last+6 约束。
        if num in seen:
            continue
        if m.group(3) is not None and last is not None and num > last + 6:
            continue
        seen.add(num)
        last = max(last, num) if last is not None else num
        heads.append((m.start(), num, m.end(), letter))
    # 「正确答案:【C】」型（2023 等）也可作为块头
    blocks: dict[int, list] = {}  # num -> [body, 块头字母 | None]
    for k, (pos, num, end, letter) in enumerate(heads):
        stop = heads[k + 1][0] if k + 1 < len(heads) else len(text)
        body = text[end:stop]
        if num not in blocks:
            blocks[num] = [body, letter]
        else:
            blocks[num][0] += "\n" + body

    ANS_PAT = re.compile(
        r"因此[，,]\s*选择\s*([A-E])\s*选项"
        r"|正确答案[是为][:：]?\s*【?\s*([A-E])\s*】?"
        # 各年句式不一致：「故正确答案为A。」「故正确答案B。」（无「为」）、
        # 「故正确选项为C。」「故正确答案选B。」，且 PDF 换行会把「故正确答案」与「为A」拆到两行 → \s* 要能跨行
        r"|故正确(?:答案|选项)\s*[为选]?\s*([A-E])"
        r"|故选\s*([A-E])"
        r"|答案为\s*([A-E])"
        r"|答案[:：]\s*【?\s*([A-E])\s*】?"
        # 2009 卷结语句式：「…A项正确。」
        r"|([A-E])项正确"
        # 2002 卷块头「N、【答案】B」落在 body 开头
        r"|【答案】\s*([A-E])"
    )

    # 「快速对答案」表（2023+ 答案卷首）：【1-5】CCDBB —— 作为块内句式缺失时的兜底
    table_ans: dict[int, str] = {}
    for tm in re.finditer(r"【(\d{1,3})-(\d{1,3})】\s*([A-E]{2,})", text):
        a, b, letters = int(tm.group(1)), int(tm.group(2)), tm.group(3)
        if 0 < b - a + 1 == len(letters):
            for k, ch in enumerate(letters):
                table_ans.setdefault(a + k, ch)

    # 无块头时（整卷只有【N】解析 或 快速对答案表），额外尝试表格式答案
    out: dict[int, dict] = {}
    for num, (body, head_letter) in blocks.items():
        m = ANS_PAT.search(body)
        ans = next((g for g in m.groups() if g), None) if m else None
        if ans is None:
            ans = head_letter  # 「N.A【解析】」型块头自带答案字母
        if ans is None:
            ans = table_ans.get(num)  # 「快速对答案」表兜底
        expl = body.strip()
        if not expl:
            expl = ""
        out[num] = {"answer": ans, "explanation": expl}
    return out


def parse_answers(pdf_path: Path) -> dict[int, dict]:
    pages = extract_lines(pdf_path)
    flat: list[str] = []
    for p in pages:
        flat.extend(p)
        flat.append("")
    return answers_from_text("\n".join(flat))


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
    连续的 A→B→C→D 标记并重新切分。成功返回 True。
    2004 卷选项全部为空且无分隔符（「A简单多数规则B绝对多数规则…」）：字母后直接跟
    文字也算标记（宽松模式，仅在全卷选项无文本来源时才有意义）。"""
    if len(q["options"]) >= 4:
        return False
    loose = not any((o["text"] or "").strip() for o in q["options"])
    text = q["stem"] + "".join(f"\n{o['key']}．{o['text']}" for o in q["options"])
    pat = re.compile(r"([A-E])\s*[.．、]?\s*(?=[^\s])") if loose else INLINE_OPT_RE
    marks = [(m.start(), m.group(1), m.end()) for m in pat.finditer(text)]
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
    warnings: list[str] = list(parsed["warnings"])
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
        q["subtype"] = q.pop("_subtype", None) or infer_subtype(q.get("section"), q["stem"], q["options"])
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


# ---------- 同年兄弟卷答案回填 ----------

def option_signature(q: dict) -> tuple:
    return tuple((o.get("key"), (o.get("text") or "").strip()) for o in q.get("options", []))


def is_distinctive(q: dict) -> bool:
    """选项是否有足够真实文本可当同题指纹。

    图形题选项全是「（原卷为图形/公式，待补图）」占位，题干又常是同一句
    「从所给的四个选项中，选择最合适的一个填入问号处…」——不设门槛会把缺答案的图形题
    错配到另一道图形题（2016 副省 76 踩过）。
    """
    real = [t for t in ((o.get("text") or "").strip() for o in q.get("options", [])) if t and "待补" not in t]
    return len(real) >= 2


def backfill_answers(out_dir: Path) -> int:
    """同年兄弟卷同题回填缺失答案（2016 副省/地市、2022 副省/地市/行执 共用题库）。

    只在「题干 + 选项完全一致」且候选答案唯一时回填，避免把形近题串了。幂等：只填 answer 为空的题。
    """
    papers: list[tuple[Path, dict]] = []
    for f in sorted(out_dir.glob("guokao-xingce-*.json")):
        papers.append((f, json.loads(f.read_text(encoding="utf-8"))))
    index: dict[tuple, set[str]] = {}
    for _, p in papers:
        for q in p["questions"]:
            if q.get("answer") and (q.get("stem") or "").strip() and is_distinctive(q):
                index.setdefault((p["year"], q["stem"].strip(), option_signature(q)), set()).add(q["answer"])
    filled = 0
    for f, p in papers:
        changed = False
        for q in p["questions"]:
            if q.get("answer") or not (q.get("stem") or "").strip() or not is_distinctive(q):
                continue
            answers = index.get((p["year"], q["stem"].strip(), option_signature(q)))
            if answers and len(answers) == 1:
                q["answer"] = next(iter(answers))
                warns = p.setdefault("warnings", [])
                if isinstance(warns, list):
                    warns.append(f"第{q['idx']}题答案缺失，已由同年兄弟卷同题回填：{q['answer']}")
                changed = True
                filled += 1
        if changed:
            f.write_text(json.dumps(p, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return filled


# ---------- 文件配对 ----------

LEVEL_PAT = [
    ("副省级", re.compile(r"副省级|省级|省部级")),
    ("地市级", re.compile(r"地市级|市地级|地市")),
    ("行政执法", re.compile(r"行政执法")),
    # 早年卷别：2002–2004 为 A/B 卷，2005–2006 为 一/二 卷；
    # 2000–2001、2007–2014 单卷无卷别，discover 里 fallback 「未分级」
    ("A卷", re.compile(r"A卷")),
    ("B卷", re.compile(r"B卷")),
    ("卷一", re.compile(r"卷（一）|卷\(一\)")),
    ("卷二", re.compile(r"卷（二）|卷\(二\)")),
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
            if not y:
                continue
            # 单卷年份（2000–2001、2007–2014）无卷别标记，统一入「未分级」
            pairs.setdefault((y, lv or "未分级"), {})[key] = f
    out = []
    for (y, lv), d in sorted(pairs.items()):
        out.append({"year": y, "level": lv, "q": d.get("q"), "a": d.get("a")})
    return out


def paper_has_text(pdf: Path, min_ratio: float = 0.5) -> bool:
    """整本抽样判断有无文本层：扫描件常常**只有个别页**带文本（比如封面/首页），
    只看前几页会误判——2021 副省级答案就是首页 590 字、其余 35 页全空。
    取首/1-4/中/3-4/尾五页，要求过半页有足量中文。"""
    doc = pymupdf.open(pdf)
    n = doc.page_count
    idxs = sorted({0, n // 4, n // 2, (3 * n) // 4, n - 1})
    with_text = sum(1 for i in idxs if len(re.findall(r"[\u4e00-\u9fff]", doc[i].get_text())) >= 50)
    doc.close()
    return with_text / len(idxs) >= min_ratio


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
    elif not (args.all or args.list):
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

    # 全量/整年跑完后，再做一次跨卷回填（单卷 --paper 不跨卷，避免读写到别的卷）
    if args.all or args.year:
        n = backfill_answers(args.out)
        if n:
            print(f"答案回填：{n} 题来自同年兄弟卷同题")


if __name__ == "__main__":
    main()
