"""parse-xingce-pdf.py 答案解析内核（answers_from_text）的回归测试。

四个 bug 全靠人肉发现、零测试拦截（--list 不生效 / paper_has_text 只看前 5 页 /
答案句式漏 3 种 / 块头误切），其中两个落在这个纯函数里。这里用真实 bug 案例
做固定输入，把每个分支锁死：

    python3 -m unittest discover -s scripts/tests -v
"""

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("parse_xingce_pdf", ROOT / "scripts" / "parse-xingce-pdf.py")
mod = importlib.util.module_from_spec(_spec)
sys.modules["parse_xingce_pdf"] = mod
_spec.loader.exec_module(mod)

answers_from_text = mod.answers_from_text


class TestBlockHeads(unittest.TestCase):
    def test_dot_jie_variant(self):
        text = "1. 解析\n因此，选择 A 选项\n2. 解析\n答案为 B"
        out = answers_from_text(text)
        self.assertEqual(out[1]["answer"], "A")
        self.assertEqual(out[2]["answer"], "B")

    def test_dunhao_variant_2015_2021(self):
        """「N、」型块头：题号与解析同行，无行尾锚点"""
        text = "1、本题考查言语理解。因此，选择 C 选项\n2、故正确答案为 D。"
        out = answers_from_text(text)
        self.assertEqual(out[1]["answer"], "C")
        self.assertEqual(out[2]["answer"], "D")

    def test_di_ti_variant(self):
        text = "第【1】题\n正确答案：【A】\n第【2】题\n正确答案：【B】"
        out = answers_from_text(text)
        self.assertEqual([out[1]["answer"], out[2]["answer"]], ["A", "B"])

    def test_body_enumeration_does_not_create_block(self):
        """解析正文里的「1、」枚举与已出现题号重复 → 去重，不得把正文切成新块"""
        text = "1. 解析\n本题有三个要点：1、观点正确；2、结构完整；3、语言流畅。因此，选择 A 选项"
        out = answers_from_text(text)
        self.assertEqual(list(out), [1])
        self.assertEqual(out[1]["answer"], "A")
        self.assertIn("2、结构完整", out[1]["explanation"])

    def test_out_of_order_within_span_kept(self):
        """2016 副省答案 PDF：79 排在 77/78 之前——小跨度乱序允许"""
        text = "77. 解析\nx\n79. 解析\ny\n78. 解析\nz\n"
        out = answers_from_text(text)
        self.assertEqual(sorted(out), [77, 78, 79])

    def test_far_jump_ignored(self):
        """解析里引用了「5、」这类远号：跳到很远不接受，避免正文被误切成不存在的题"""
        text = "1. 解析\nA 的分析。参见 5、的相关论述。答案为 A"
        out = answers_from_text(text)
        self.assertEqual(list(out), [1])


class TestAnswerPatterns(unittest.TestCase):
    CASES = [
        ("因此，选择 B 选项", "B"),
        ("正确答案为：C", "C"),
        ("正确答案:【D】", "D"),
        ("故正确答案为 A。", "A"),
        ("故正确答案 B。", "B"),  # 无「为」
        ("故正确选项为 C。", "C"),
        ("故正确答案选 D。", "D"),
    ]

    def test_all_variants(self):
        for sentence, expected in self.CASES:
            with self.subTest(sentence=sentence):
                out = answers_from_text(f"1. 解析\n{sentence}")
                self.assertEqual(out[1]["answer"], expected)

    def test_line_wrap_between_gu_gu_and_answer(self):
        """PDF 换行把「故正确答案」与「为 A」拆到两行，\\s* 必须能跨行"""
        out = answers_from_text("1. 解析\n本题考查综合分析。\n故正确答案\n为 A。")
        self.assertEqual(out[1]["answer"], "A")

    def test_no_answer_text(self):
        out = answers_from_text("1. 解析\n本题考查常识，略。")
        self.assertIsNone(out[1]["answer"])
        self.assertIn("常识", out[1]["explanation"])


if __name__ == "__main__":
    unittest.main()
