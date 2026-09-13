"""xingce_common 共享库回归测试（unittest，stdlib-only，可独立于前端门禁运行）：

    python3 -m unittest discover -s scripts/tests -v

覆盖三个来源：
1. 统一前三个脚本各自漂移、统一后共享的函数（question_chain / cut_leak / cut_ad / safe_paper_dir）；
2. 真实 bug 案例（2026 卷题号正则不接受顿号、泄漏截断的小数/年份边界、越界 paper_id）；
3. FakePage/FakeDoc 模拟 pymupdf 页对象，测行索引与题号链，不依赖真实 PDF。
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymupdf

from xingce_common import (
    QNUM_RE_2000_2025,
    QNUM_RE_2026,
    build_index,
    cut_ad,
    cut_leak,
    page_lines,
    question_chain,
    safe_paper_dir,
)


class FakeSpan:
    def __init__(self, text):
        self.text = text


class FakePage:
    """get_text("dict") 的最小模拟：rows = [((x0,y0,x1,y1), text)]；
    与真实 pymupdf 一致，block/line/span 都是 dict。"""

    def __init__(self, rows):
        self._dict = {
            "blocks": [
                {"type": 0, "lines": [{"bbox": list(bbox), "spans": [{"text": text}]}]} for bbox, text in rows
            ]
        }

    def get_text(self, kind):
        assert kind == "dict"
        return self._dict


class FakeDoc:
    def __init__(self, pages):
        self.pages = pages

    def __len__(self):
        return len(self.pages)

    def __getitem__(self, i):
        return self.pages[i]


def make_lines(*rows):
    """rows: (pno, y0, text) → [(pno, Rect, text)]，x 取 0"""
    return [(pno, pymupdf.Rect(0, y0, 100, y0 + 10), text) for pno, y0, text in rows]


class TestQuestionChain(unittest.TestCase):
    def test_strictly_increasing_chain(self):
        lines = make_lines(
            (0, 10, "1. 题干甲"),
            (0, 30, "2. 题干乙"),
            (0, 20, "2. 干扰行在题1和题2之间但 y 更小"),  # y 递增约束会跳过
            (1, 5, "3. 题干丙"),
        )
        chain = question_chain(lines, 3)
        self.assertEqual(list(chain), [1, 2, 3])
        self.assertEqual(chain[1][0], 0)
        self.assertEqual(chain[3][0], 1)

    def test_missing_numbers_skipped(self):
        # 各级卷题量不同：135 题卷解析 130 题卷的链要能跳过缺号
        lines = make_lines((0, 10, "1. 甲"), (0, 20, "3. 丙"))
        chain = question_chain(lines, 3)
        self.assertEqual(list(chain), [1, 3])

    def test_dunhao_only_accepted_by_2000_2025_re(self):
        """统一前的真实语义差：2015–2021 卷用「N、」做题号，2026 卷不接受。
        参数化后两条管线各自行为必须保持。"""
        lines = make_lines((0, 10, "1、 甲"))
        self.assertEqual(list(question_chain(lines, 1, qnum_re=QNUM_RE_2000_2025)), [1])
        self.assertEqual(question_chain(lines, 1, qnum_re=QNUM_RE_2026), {})

    def test_decimal_not_matched_as_question(self):
        lines = make_lines((0, 10, "1. 甲"), (0, 30, "2.5. 不是题号"), (0, 50, "2. 乙"))
        chain = question_chain(lines, 2, qnum_re=QNUM_RE_2000_2025)
        self.assertEqual(list(chain), [1, 2])


class TestCutLeak(unittest.TestCase):
    def test_leak_patterns(self):
        self.assertEqual(cut_leak("题干（共 40 题，参考时限 35 分钟）后续"), "题干")
        self.assertEqual(cut_leak("题干请开始答题：xxx"), "题干")
        self.assertEqual(cut_leak("题干三、资料分析所给材料，回答 116-120 题"), "题干")
        self.assertEqual(cut_leak("正常题干不动"), "正常题干不动")

    def test_nxt_cuts_next_question_header(self):
        self.assertEqual(cut_leak("题干78.2024年…", 78), "题干")  # 题号后紧跟年份要切
        self.assertEqual(cut_leak("题干78.5 个百分点", 78), "题干78.5 个百分点")  # 小数不切
        self.assertEqual(cut_leak("题干178.5", 78), "题干178.5")  # 前面有数字（非题号边界）不切

    def test_ad_cut(self):
        self.assertEqual(cut_ad("题干。上岸咨询热线 186xxx"), "题干。")
        self.assertEqual(cut_ad("干净文本"), "干净文本")
        self.assertEqual(cut_ad(None), None)
        self.assertEqual(cut_ad(""), "")


class TestSafePaperDir(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.img_dir = Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def test_normal_id(self):
        d = safe_paper_dir(self.img_dir, "guokao-xingce-2026-副省级")
        self.assertTrue(str(d).startswith(str(self.img_dir)))

    def test_rejects_escape(self):
        for bad in ["..", "../elsewhere", "/tmp/abs", "a/../../b"]:
            with self.assertRaises(ValueError):
                safe_paper_dir(self.img_dir, bad)

    def test_rejects_img_dir_itself(self):
        with self.assertRaises(ValueError):
            safe_paper_dir(self.img_dir, ".")


class TestPageIndex(unittest.TestCase):
    def test_page_lines_and_build_index(self):
        doc = FakeDoc(
            [
                FakePage([((0, 10, 100, 20), "第一行"), ((0, 0, 0, 0), "")]),  # 空文本行被滤掉
                FakePage([((5, 30, 105, 40), "第二页行")]),
            ]
        )
        lines = build_index(doc)
        self.assertEqual([t for _, _, t in lines], ["第一行", "第二页行"])
        self.assertEqual([p for p, _, _ in lines], [0, 1])
        # page_lines 直接用
        one = page_lines(doc[0])
        self.assertEqual(len(one), 1)
        self.assertAlmostEqual(one[0][0].y0, 10)

    def test_question_chain_multi_page(self):
        doc = FakeDoc(
            [
                FakePage([((0, 10, 400, 20), "1. 甲"), ((0, 500, 400, 510), "2. 乙")]),
                FakePage([((0, 10, 400, 20), "3. 丙")]),
            ]
        )
        chain = question_chain(build_index(doc), 3)
        self.assertEqual(sorted(chain), [1, 2, 3])
        self.assertEqual(chain[3][0], 1)


if __name__ == "__main__":
    unittest.main()
