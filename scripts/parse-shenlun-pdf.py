#!/usr/bin/env python3
"""申论国考真题：PDF → 结构化 JSON（data/shenlun/*.json）

背景：`_AI解析` 下的 md 行结构已损坏（题目/答案挤在一行），2000–2023 直接入库会产出错数据。
本脚本改为从推荐版 PDF 直接用 PyMuPDF 提取（行结构干净），再切分为
材料 / 题目（题干+要求）/ 参考答案，落 `data/shenlun/*.json`；
入库由 scripts/import-shenlun.mjs 完成（仅写 2000–2023，保留库内 2024/2025）。

用法：python3 scripts/parse-shenlun-pdf.py [--pdf-dir DIR] [--md-dir DIR] [--out DIR] [--only 2020]
"""
import argparse
import glob
import json
import os
import re
import unicodedata

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PDF_DIR = "/Users/tomcat/Documents/docs/【01】国考真题资料/国考2000-2026真题pdf 【推荐用这个版本】/2000-2025国考申论PDF"
DEFAULT_MD_DIR = "/Users/tomcat/Documents/docs/【01】国考真题资料_AI解析/国考2000-2026真题pdf 【推荐用这个版本】/2000-2025国考申论PDF"
DEFAULT_OUT = os.path.join(ROOT, "data", "shenlun")

CN = "一二三四五六七八九十"
YEARS = range(2000, 2024)


# ---------- 元数据（年份/级别取 md frontmatter；正文一律用 PDF） ----------

def read_md_meta(md_dir):
    meta = {}
    for f in glob.glob(os.path.join(md_dir, "*.md")):
        head = re.match(r"^---\n(.*?)\n---\n", open(f, encoding="utf-8").read(), re.S)
        d = {}
        if head:
            for k, v in re.findall(r"^(\w+):\s*(.+)$", head.group(1), re.M):
                d[k] = v.strip().strip('"')
        meta[os.path.splitext(os.path.basename(f))[0]] = d
    return meta


# ---------- PDF 文本清洗 ----------

# CJK Radicals Supplement 中 NFKC 无映射、需手工对应的部首字（实测出现于 2023 行政执法卷）
RADICAL_MAP = {
    "⻓": "长", "⺠": "民", "⻛": "风", "⻢": "马", "⻩": "黄", "⻋": "车", "⻔": "门",
    "⻄": "西", "⻬": "齐", "⻝": "食", "⻅": "见", "⻘": "青", "⻆": "角",
}


def _fix_compat(s):
    """仅把康熙部首/兼容汉字段落归一为常规汉字，保留全角标点（不做整体 NFKC）。"""
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


def normalize_spaces(s):
    s = _fix_compat(s)
    # PDF 抽取会在 CJK 与数字/英文间插空格：去掉这类空格，保留英文词间空格
    s = re.sub(r"(?<=[\u4e00-\u9fff])[ \t]+(?=[0-9A-Za-z])", "", s)
    s = re.sub(r"(?<=[0-9A-Za-z])[ \t]+(?=[\u4e00-\u9fff])", "", s)
    s = s.replace("\u3000", " ").replace("\xa0", " ")
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


def extract_pages(pdf_path):
    doc = pymupdf.open(pdf_path)
    pages = []
    for pg in doc:
        raw = pg.get_text("text").replace("\r\n", "\n")
        pages.append([normalize_spaces(l) for l in raw.split("\n")])
    return pages


def clean_pages(pages, title_key):
    """去页码、跨页重复页眉；收敛空行。"""
    key = re.sub(r"\s+", "", title_key or "")
    out = []
    for i, lines in enumerate(pages):
        kept = []
        for l in lines:
            if not l:
                kept.append("")
                continue
            if re.fullmatch(r"[-—\s]*\d{1,3}[-—\s]*", l):
                continue  # 页码（含 "- 5 -"）
            if i > 0 and key and re.sub(r"\s+", "", l) == key:
                continue
            kept.append(l)
        merged = []
        for l in kept:
            if l == "" and (not merged or merged[-1] == ""):
                continue
            merged.append(l)
        out.append(merged)
    return out


# ---------- 段落重排：把视觉硬换行并回一句，保留真实段界 ----------

REFLOW_TERMINAL = re.compile(r"[。！？；：…][”』」)）》】]*$|[:：]$")
REFLOW_MARK = re.compile(r"^(?:[①②③④⑤⑥⑦⑧⑨⑩]|[（(]\s*[0-9一二三四五六七八九十]{1,3}\s*[)）]|[一二三四五六七八九十]{1,3}[、.]|\d{1,2}[、.](?!\d)|材料\s*[0-9一二三四五六七八九十A-Z]|[●◆])")


def reflow(lines):
    out = []
    for raw in lines:
        line = raw.strip()
        if not line:
            if out and out[-1] != "":
                out.append("")
            continue
        prev = out[-1] if out else None
        joinable = prev is not None and prev != "" and not REFLOW_TERMINAL.search(prev) and not REFLOW_MARK.match(line)
        if joinable:
            sep = " " if (prev[-1].isascii() and prev[-1].isalnum() and line[0].isascii() and line[0].isalnum()) else ""
            out[-1] = prev + sep + line
        else:
            out.append(line)
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out)


# ---------- 区段定位 ----------

MAT_START_RE = re.compile(r"^(?:[一二三四五六]、\s*)?(?:资料|给定资料|给定材料|背景资料)\s*$")
MAT_HEAD_RE = re.compile(r"^[【\[]?\s*材料\s*([0-9一二三四五六七八九十]+|[A-Z])\s*[】\]]?\s*[:：、.．]?\s*(.*)$")
MAT_SECTION_RE = re.compile(r"^[一二三四五六]、\s*(?:资料|给定资料|给定材料)")
REQ_START_RE = re.compile(r"^(?:[一二三四五六]、\s*)?(?:申论要求|作答要求)\s*$")
ANS_START_RE = re.compile(r"(参考答案|答案提示|参考例文|答案详解|答案详细解析|答案解析|真题答案|（解析）|\(解析\))")


def is_answer_head(line):
    if not ANS_START_RE.search(line):
        return False
    if line.startswith("要求") or "不超过" in line or re.search(r"[（(]\s*\d+\s*分\s*[）)]", line):
        return False
    return len(line) <= 45


REQ_LOOSE_RE = re.compile(r"^(?:[一二三四五六]、\s*)?(?:申论要求|作答要求)\s*$")


def find_regions(lines):
    """返回 (材料区, 题目区, 答案区, mat_i, req_i, ans_i)。"""
    n = len(lines)
    mat = next((i for i, l in enumerate(lines) if MAT_START_RE.match(l) or MAT_SECTION_RE.match(l)), None)
    if mat is None:
        mat = next((i for i, l in enumerate(lines) if MAT_HEAD_RE.match(l)), None)
    if mat is None:
        mat = 0
    start = mat + 1
    limit = n
    req = next((i for i in range(start, limit) if REQ_LOOSE_RE.match(lines[i]) or ("作答要求" in lines[i] and len(lines[i]) <= 12)), None)
    if req is None:
        # 2023 等：无「作答要求」标题，题目以「问题一」直接跟在材料后
        req = next((i for i in range(start, limit) if re.match(r"^\s*问题[一二三四五]\s*$", lines[i])), None)
    q_from = req + 1 if req is not None else start
    ans = next((i for i in range(q_from, n) if i >= 5 and is_answer_head(lines[i])), None)
    mat_body = lines[mat:req] if req is not None else lines[mat : ans if ans is not None else n]
    q_body = lines[req:ans] if (req is not None and ans is not None) else (lines[req:] if req is not None else [])
    a_body = lines[ans:] if ans is not None else []
    return mat_body, q_body, a_body, mat, req, ans


# ---------- 材料切分 ----------

def split_materials(mat_body):
    # 去掉区段标题行；兼容「二、给定材料材料1」把首个材料头并进标题行的情况
    body = list(mat_body)
    if body:
        body[0] = re.sub(r"^[一二三四五]、\s*(?:给定材料|给定资料|资料)\s*", "", body[0])
        if not body[0]:
            body = body[1:]
    heads = []
    for i, l in enumerate(body):
        m = MAT_HEAD_RE.match(l)
        if m and (i == 0 or l.startswith("材料") or l.startswith("【材料")):
            heads.append((i, m.group(1), m.group(2).strip()))
    blocks = []
    if len(heads) >= 2:
        pending = None  # 上一空编号材料（如「材料4」仅作容器，正文在 材料A/B/C）
        for k, (i, num, inline) in enumerate(heads):
            end = heads[k + 1][0] if k + 1 < len(heads) else len(body)
            content = ([inline] if inline else []) + body[i + 1 : end]
            if re.fullmatch(r"[A-Z]", str(num)) and pending:
                label = f"{pending}-{num}"
            else:
                label = "材料" + str(num)
            blocks.append({"label": label, "lines": content})
            if not re.fullmatch(r"[A-Z]", str(num)):
                pending = label if not reflow(content).strip() else None
    else:
        # 早期卷：材料A/B、无编号、或 (1)(2) 条目
        sub_head = [(i, m.group(1), m.group(2).strip()) for i, l in enumerate(body) for m in [re.match(r"^材料([A-Z])[:：]?(.*)$", l)] if m]
        if len(sub_head) >= 2:
            for k, (i, num, inline) in enumerate(sub_head):
                end = sub_head[k + 1][0] if k + 1 < len(sub_head) else len(body)
                content = ([inline] if inline else []) + body[i + 1 : end]
                blocks.append({"label": "材料" + str(num), "lines": content})
        else:
            item = [(i, m.group(1)) for i, l in enumerate(body) for m in [re.match(r"^[（(](\d{1,2})[）)]", l)] if m]
            if len(item) >= 3:
                for k, (i, num) in enumerate(item):
                    end = item[k + 1][0] if k + 1 < len(item) else len(body)
                    blocks.append({"label": "材料" + str(num), "lines": [body[i]] + body[i + 1 : end]})
            else:
                blocks.append({"label": "给定资料", "lines": body})

    out = []
    for b in blocks:
        content = reflow(b["lines"]).strip()
        if content:
            out.append({"label": b["label"], "content": content})
    for i, m in enumerate(out):
        m["idx"] = i + 1
    return out


# ---------- 题目切分 ----------

SCHEMES = [
    ("问题行", re.compile(rf"^\s*问题\s*([{CN}1-9])\s*[:：]")),
    ("问题", re.compile(rf"^\s*问题\s*([{CN}1-9])\s*$")),
    ("括号", re.compile(rf"^\s*[（(]\s*([{CN}]|1?\d)\s*[）)]")),
    ("汉序", re.compile(rf"^\s*([{CN}])\s*[、.]")),
    ("数序", re.compile(r"^\s*(\d{1,2})\s*[、.．]")),
]

STEM_VERB = re.compile(
    r"请|谈谈|假如|梳理|概括|归纳|分析|写一|提出|建议|看法|理解|启示|围绕|为题|论证|概述|阐释|简述|草拟|撰写|拟写|指出|整理|说明|评价|对待|如何|"
    r"认为|回答|列出|填写|阐述|提炼|解释|描述|介绍|拟一|写一|写份|写一篇|谈一谈|谈|讲讲"
)
# 强题干特征：短句里出现这些才可能是真题目（用于剔除「（2）恰当提炼，条理清晰；」这类要求小项）
STEM_STRONG = re.compile(
    r"请|谈谈|概括|归纳|分析|写一|撰写|草拟|拟写|提出|梳理|指出|如何|假如|围绕|以.{0,14}为题|自拟题目|有何|哪些|为什么|简述|概述|阐释"
)
REQ_PREFIX = re.compile(
    r"^(观点明确|条理清晰|层次分明|问题梳理|所提措施|不超过|不多于|语言流畅|内容全面|紧扣|针对性强|提炼准确|准确全面、|简明扼要|结构完整|切合主题|分条作答|字数|要求)"
)


def split_by(lines, rex):
    heads = []
    for i, l in enumerate(lines):
        m = rex.match(l)
        if m:
            heads.append((i, m.group(1), m.end()))
    parts = []
    for k, (i, num, pos) in enumerate(heads):
        end = heads[k + 1][0] if k + 1 < len(heads) else len(lines)
        head = lines[i][:pos].strip()
        first = lines[i][pos:].strip()
        raw = ([first] if first else []) + lines[i + 1 : end]
        parts.append({"num": num, "head": head, "text": reflow(raw).strip()})
    return parts


def num_value(s):
    if s in CN:
        return CN.index(s) + 1
    return int(s) if s.isdigit() else 0


def stem_ok(text):
    t = re.sub(r"\s", "", text)
    if REQ_PREFIX.match(t):
        return False
    # 短小且无强题干特征的，判为要求小项（如「（2）恰当提炼，条理清晰；」）
    if len(t) < 20 and not STEM_STRONG.search(t):
        return False
    return bool(STEM_VERB.search(t[:400]))


def is_question(text):
    if len(text) <= 8:
        return False
    stem, _ = extract_req(clean_stem(text))
    return stem_ok(stem)


def merge_lead_subs(parts):
    """合并「回答下列两个问题：1.…2.…」这类引导题 + 子题。"""
    out = []
    i = 0
    while i < len(parts):
        p = parts[i]
        if re.search(r"两个问题|两个小题|下面两题|以下两题|两题|两问|回答.{0,6}问题", p["text"]) and i + 1 < len(parts):
            merged = p["text"]
            j, expect = i + 1, 1
            while j < len(parts) and num_value(parts[j]["num"]) == expect:
                merged += "\n" + parts[j]["text"]
                j += 1
                expect += 1
            if j > i + 1:
                out.append({"num": p["num"], "head": p.get("head", ""), "text": merged})
                i = j
                continue
        out.append(p)
        i += 1
    return out


def pick_scheme(q_body, answer_count=None):
    """多编号方案评分：取能构成单调递增题干序列、题数 2–6 的方案；返回该方案的完整切分。"""
    best = None
    for name, rex in SCHEMES:
        parts = merge_lead_subs(split_by(q_body, rex))
        ok, last = 0, 0
        for p in parts:
            v = num_value(p["num"])
            if v > last and is_question(p["text"]):
                ok += 1
                last = v
        if 2 <= ok <= 6 and (best is None or ok > best[1]):
            best = (name, ok, parts)
    if best is None:
        return None, []
    return best[0], best[2]


def clean_stem(text):
    text = re.sub(r"^\s*(?:【\s*(?:问题|题目)[^】]*】)\s*", "", text)
    return text.strip()


def extract_req(text):
    """题干 / 要求分离：从首个「要求（:（」处切开（含行内式）。"""
    m = re.search(r"要求\s*[（(:：]", text)
    if m and m.start() > 0:
        return text[: m.start()].strip(), text[m.start() :].strip()
    return text.strip(), ""


def word_limit(text):
    for a, b in re.findall(r"(\d{3,4})\s*[-–—~～至到]\s*(\d{3,4})\s*字", text):
        return {"min": int(a), "max": int(b)}
    for n in re.findall(r"(?:不超过|不多于|不少于)\s*(\d{3,4})\s*字", text):
        return {"max": int(n)}
    for n in re.findall(r"(\d{3,4})\s*字(?:左右|以内|上下)", text):
        return {"max": int(n)}
    return None


def points(text):
    m = re.search(r"[（(]\s*(\d{1,2})\s*分\s*[）)]", text)
    return int(m.group(1)) if m else None


def classify(stem, req, wl):
    t = stem + req
    if re.search(r"写一篇(?:文章|议论文)|自拟题目|自选角度|作文|写一篇文章|为题，写", t):
        return "大作文"
    if re.search(r"文章|议论", t) and wl and (wl.get("max", 0) >= 900 or wl.get("min", 0) >= 900):
        return "大作文"
    if re.search(r"提案|讲话稿|发言稿|倡议书|公开信|报告|提纲|宣传稿|简报|编者按|导言|新闻稿|公众号|短评|讲解稿|备询|经验介绍|案例摘要|发布词|汇报|材料", t):
        return "应用文"
    if re.search(r"对策|建议|措施|解决办法|解决.{0,6}问题|如何(解决|改善|推进)|工作思路", t):
        return "对策"
    if re.search(r"分析|谈谈|看法|理解|启示|评价|见解|含义|认识|比较", t):
        return "分析"
    if re.search(r"概括|归纳|梳理|指出|哪些方面|有哪些|特点|原因|过程|变化|差异|不同", t):
        return "概括"
    return None


# ---------- 答案切分 ----------

ANS_KEY = re.compile(r"参考答案|答案提示|参考例文|答案解析|答案详解|答卷|评析|参考范文|范文")
ANS_LINE_START = re.compile(r"^\s*(?:【\s*)?(?:参考答案|答案提示|参考例文|答案解析|答案详解|答卷|评析|参考范文|范文)")

ANS_SCHEMES = [
    ("问", re.compile(rf"^\s*第\s*([{CN}1-9])\s*[问题題]")),
    ("问题", re.compile(rf"^\s*(?:【\s*)?问题\s*([{CN}1-9])")),
    ("括号", re.compile(rf"^\s*[（(]\s*([{CN}]|1?\d)\s*[）)]")),
    ("汉序", re.compile(rf"^\s*([{CN}])\s*[、.．]")),
    ("数序", re.compile(r"^\s*(\d{1,2})\s*[、.．]")),
]


def common_prefix_len(a, b):
    a, b = re.sub(r"\s", "", a), re.sub(r"\s", "", b)
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


def answer_anchor_candidates(a_body, questions):
    """按编号方案各自产出一组答案块（编号行需自带答案关键词、后 1–2 行以答案词开头，或复述题干）。"""
    out = []
    for _, rex in ANS_SCHEMES:
        heads = []
        for i, l in enumerate(a_body):
            s = l.strip()
            m = rex.match(s)
            if not m:
                continue
            num = m.group(1)
            ok = bool(ANS_KEY.search(s)) or bool(re.match(r"^[（(]?\s*\d{1,3}\s*分", s[m.end() :].strip()))
            if not ok:
                seen = 0
                for j in range(i + 1, len(a_body)):
                    t = a_body[j].strip()
                    if not t:
                        continue
                    if ANS_LINE_START.match(t):
                        ok = True
                        break
                    seen += 1
                    if seen >= 2:
                        break
            if not ok:
                rest = s[m.end() :].strip()
                ok = any(common_prefix_len(rest, q["stem"]) >= 10 for q in questions)
            if ok:
                heads.append((i, num))
        blocks = []
        for k, (i, num) in enumerate(heads):
            end = heads[k + 1][0] if k + 1 < len(heads) else len(a_body)
            text = reflow(a_body[i:end]).strip()
            if text:
                blocks.append({"num": num, "text": text})
        if blocks:
            out.append(blocks)
    return out


def scheme_blocks(a_body, rex):
    return [{"num": p["num"], "text": p["text"]} for p in split_by(a_body, rex) if len(p["text"]) > 8]


def assign_answers(blocks, questions, warnings):
    matched = 0
    if not blocks or not questions:
        return matched
    if len(blocks) == len(questions):
        for q, b in zip(questions, blocks):
            q["answer"] = b["text"]
            q["answerMatched"] = True
            matched += 1
        return matched
    used = [False] * len(blocks)
    for q in questions:
        for bi, b in enumerate(blocks):
            if not used[bi] and num_value(b["num"]) == q["idx"]:
                q["answer"] = b["text"]
                q["answerMatched"] = True
                used[bi] = True
                matched += 1
                break
    if matched < len(questions):
        warnings.append(f"答案块 {len(blocks)} ≠ 题目 {len(questions)}，对齐 {matched} 题")
    return matched


# ---------- 单卷解析 ----------

def parse_paper(pdf_path, meta):
    year = int(meta.get("year"))
    level = meta.get("level") or "未分级"
    if level in ("省部级", "省级"):
        level = "副省级"
    pages = clean_pages(extract_pages(pdf_path), meta.get("source_file", ""))
    lines = []
    for p in pages:
        lines.extend(p)
        lines.append("")
    title = ""
    for l in lines:
        if l.strip():
            title = l.strip()
            break
    title = re.split(r"一、注意事项|注意事项|满分\s*[:：]?\s*100|本题本", title)[0].strip()[:120] or f"{year}年国考《申论》题"

    mat_body, q_body, a_body, mat_i, req_i, ans_i = find_regions(lines)
    warnings = []
    if req_i is None:
        warnings.append("未定位到作答要求区")
    if ans_i is None:
        warnings.append("未定位到参考答案区")

    materials = split_materials(mat_body)
    scheme, parts = pick_scheme(q_body)
    if scheme is None:
        warnings.append("题目区未切分出题目")
    if scheme:
        warnings.append(f"题目切分方案={scheme}")

    questions = []
    last = 0
    for p in parts:
        v = num_value(p["num"])
        if not (v > last and is_question(p["text"])):
            # 落选块（多为上一题的要求小项）：并入上一题要求，避免丢内容
            if questions:
                add = (p.get("head", "") + p["text"]).strip()
                questions[-1]["_req_extra"] = questions[-1].get("_req_extra", "") + "\n" + add
            continue
        last = v
        stem, req = extract_req(clean_stem(p["text"]))
        wl = word_limit(req) or word_limit(stem)
        questions.append({
            "idx": len(questions) + 1,
            "type": classify(stem, req, wl),
            "stem": stem,
            "requirement": req,
            "wordLimit": wl,
            "points": points(stem + req),
            "answer": None,
            "answerMatched": False,
            "_extra": "",
            "_req_extra": "",
        })

    answers_raw = reflow(a_body).strip() if a_body else ""
    candidates = answer_anchor_candidates(a_body, questions) if a_body else []
    if a_body:
        candidates += [scheme_blocks(a_body, rex) for _, rex in ANS_SCHEMES]
    best = None
    for blocks in candidates:
        if len(blocks) < 1:
            continue
        qcopy = [dict(q) for q in questions]
        mt = assign_answers(blocks, qcopy, [])
        exact = 1 if len(blocks) == len(questions) else 0
        minlen = min((len(b["text"]) for b in blocks), default=0)
        score = (exact, mt, minlen)
        if best is None or score > best[0]:
            best = (score, qcopy)
    matched = 0
    if best:
        matched = best[0][1]
        for q, src in zip(questions, best[1]):
            q["answer"] = src["answer"]
            q["answerMatched"] = src["answerMatched"]
    if questions and matched == 0:
        warnings.append("答案未对齐")
    elif questions and matched < len(questions):
        warnings.append(f"答案对齐 {matched}/{len(questions)} 题")
    for q in questions:
        req_extra = q.pop("_req_extra", "").strip()
        if req_extra:
            q["requirement"] = (q["requirement"] + "\n" + req_extra).strip()
        q.pop("_extra", None)
        wl = word_limit(q["requirement"]) or word_limit(q["stem"])
        q["wordLimit"] = wl
        q["type"] = classify(q["stem"], q["requirement"], wl)
        q["points"] = points(q["stem"] + q["requirement"])

    return {
        "id": f"guokao-shenlun-{year}-{level}",
        "year": year,
        "level": level,
        "title": title,
        "sourceFile": os.path.relpath(pdf_path, os.path.dirname(pdf_path)),
        "pages": len(pages),
        "warnings": "; ".join(warnings) or None,
        "materials": materials,
        "questions": questions,
        "answersRaw": answers_raw or None,
    }


# ---------- 主流程 ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", default=DEFAULT_PDF_DIR)
    ap.add_argument("--md-dir", default=DEFAULT_MD_DIR)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--only", type=int, default=None)
    args = ap.parse_args()

    md_meta = read_md_meta(args.md_dir)
    os.makedirs(args.out, exist_ok=True)
    seen = {}
    for pdf in sorted(glob.glob(os.path.join(args.pdf_dir, "*.pdf"))):
        base = os.path.splitext(os.path.basename(pdf))[0]
        meta = md_meta.get(base)
        if not meta or not meta.get("year"):
            continue
        year = int(meta["year"])
        if year not in YEARS:
            continue
        if "_1213233422" in base:
            continue
        if args.only and year != args.only:
            continue
        paper = parse_paper(pdf, meta)
        # 同年同级重复取更长的一份
        prev = seen.get(paper["id"])
        if prev is None or len(json.dumps(paper, ensure_ascii=False)) > len(json.dumps(prev, ensure_ascii=False)):
            seen[paper["id"]] = paper

    report = []
    for pid in sorted(seen):
        paper = seen[pid]
        path = os.path.join(args.out, pid + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(paper, f, ensure_ascii=False, indent=2)
            f.write("\n")
        matched = sum(1 for q in paper["questions"] if q["answerMatched"])
        report.append(f"{paper['year']} {paper['level']:<4} 材料{len(paper['materials']):>2} 题{len(paper['questions']):>2} 答{matched}/{len(paper['questions'])} | {paper['title'][:38]}")
        if paper["warnings"]:
            report.append(f"      warn: {paper['warnings']}")
    print(f"写出 {len(seen)} 卷 → {args.out}")
    print("\n".join(report))


if __name__ == "__main__":
    main()
