"""parse-xingce-pdf.py 题干/选项切分的回归测试（unittest，无需真实 PDF）。

锁住 2026-09 修复的三类「题号行缺失/被误拒 → 选项堆到上一题」真实案例：
1. 选项 key 重复 = 新题开始（2012 卷 104、2016 地市 32/106/116…）；
2. 小数守卫误拒题号（2003-A 卷 78「78.20世纪」、2003-B 卷 5「5.5/7」）；
3. 资料分析组首题缺号：组头+材料要拆进 groupStem，题干单独留在 stem（2016 地市 111/112）。
"""

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("parse_xingce_pdf", ROOT / "scripts" / "parse-xingce-pdf.py")
px = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(px)


def parse(*lines):
    """单页试卷 → parse_questions 结果（pages 是「页 → 行」的二维列表）。"""
    return px.parse_questions([list(lines)])


class TestDecimalGuard(unittest.TestCase):
    def test_ascii_slash_fraction_is_question(self):
        # 「5.5/7，7/12…」是数列题，不是小数 5.5/7
        self.assertIsNotNone(px.is_question_start("5.5/7，7/12，", 5))

    def test_percent_decimal_still_rejected(self):
        # 资料分析断行的百分比「19.3%）相比…」不能当题号
        self.assertIsNone(px.is_question_start("19.3%）相比，教师上网太少", 19))

    def test_year_like_rest_still_rejected_by_guard(self):
        # 「78.20世纪」与小数同形，守卫仍拒；由「选项 key 重复」的补号分支兜住（见下）
        self.assertIsNone(px.is_question_start("78.20世纪90年代初出现的“新经济”", 78))


class TestDuplicateOptionRecovery(unittest.TestCase):
    def test_missing_number_line_splits_new_question(self):
        """2012 卷 104 / 2016 地市 32：题号行整行缺失，A 选项与上一题重复。"""
        r = parse(
            "第一部分言语理解与表达",
            "1、第一题（",
            "）。",
            "A、甲",
            "B、乙",
            "C、丙",
            "D、丁",
            "第二题没有题号",
            "A、戊",
            "B、己",
            "C、庚",
            "D、辛",
            "3、第三题（",
            "）。",
            "A、a",
            "B、b",
            "C、c",
            "D、d",
        )
        idxs = [q["idx"] for q in r["questions"]]
        self.assertEqual(idxs, [1, 2, 3])
        q2 = next(q for q in r["questions"] if q["idx"] == 2)
        self.assertIn("第二题没有题号", q2["stem"])
        self.assertEqual([o["key"] for o in q2["options"]], ["A", "B", "C", "D"])
        self.assertTrue(any("补号" in w for w in r["warnings"]))

    def test_rejected_number_line_prefix_stripped(self):
        """2003-A 卷 78：题号行被小数守卫拒掉，补号后题干不能带「2.」前缀。"""
        r = parse(
            "第一部分常识判断",
            "1、下列人员（",
            "）。",
            "A、甲",
            "B、乙",
            "C、丙",
            "D、丁",
            "2.20世纪90年代初出现的“新经济”是相对于传统经济而言的",
            "（",
            "）。",
            "A、全球化",
            "B、市场化",
            "C、信息化",
            "D、专业化",
            "3、第三题（",
            "）。",
            "A、a",
            "B、b",
            "C、c",
            "D、d",
        )
        q2 = next(q for q in r["questions"] if q["idx"] == 2)
        self.assertTrue(q2["stem"].startswith("20世纪90年代初"))
        self.assertEqual([o["text"] for o in q2["options"]], ["全球化", "市场化", "信息化", "专业化"])


class TestMaterialSplit(unittest.TestCase):
    def test_zl_group_material_split_from_stem(self):
        """2016 地市 116：组头+材料混在 _post 里，要拆成 groupStem 与 stem。"""
        r = parse(
            "第五部分资料分析",
            "1、数据是多少？",
            "A、1",
            "B、2",
            "C、3",
            "D、4",
            "（二）2014年材料说明，共若干字。",
            "2014年平均每个单位约为：",
            "A、5",
            "B、6",
            "C、7",
            "D、8",
            "3、第三题？",
            "A、a",
            "B、b",
            "C、c",
            "D、d",
        )
        q2 = next(q for q in r["questions"] if q["idx"] == 2)
        self.assertEqual(q2["stem"], "2014年平均每个单位约为：")
        self.assertIn("（二）2014年材料说明", r["materials"][2])

    def test_zl_pre_question_recovered(self):
        """2016 地市 111：组首题缺号落在「无 current 题」窗口，靠 pre 里的题干补题。"""
        r = parse(
            "第五部分资料分析",
            "一、根据以下资料，回答1～5题。",
            "2014年数据材料。",
            "2014年平均值约为：",
            "A、1",
            "B、2",
            "C、3",
            "D、4",
            "2、第二题？",
            "A、a",
            "B、b",
            "C、c",
            "D、d",
        )
        idxs = [q["idx"] for q in r["questions"]]
        self.assertEqual(idxs, [1, 2])
        q1 = r["questions"][0]
        self.assertEqual(q1["stem"], "2014年平均值约为：")
        self.assertIn("根据以下资料", r["materials"][1])


class TestPageArtifacts(unittest.TestCase):
    def test_inline_footer_stripped(self):
        self.assertEqual(px.strip_page_artifacts("数据“阳光”之第5页,共25页下，让环境监测"), "数据“阳光”之下，让环境监测")

    def test_footer_plus_header_stripped(self):
        s = "某选项2025年国考《行测》题（地市级）第11页，共26页"
        self.assertEqual(px.strip_page_artifacts(s), "某选项")


class TestBareNumberRewrite(unittest.TestCase):
    def test_range_16_25_not_treated_as_postfixed_numbers(self):
        """2003-A 卷 16–25：也是「N.」独立成行，但不能被 2024/2025 的题号后置重排吞掉。"""
        lines = ["第一部分判断推理", "一、图形推理：本部分包括两种类型的题目，共10题。"]
        for n in range(1, 16):
            lines += [f"{n}.题干{n}（", "）。", "A、a", "B、b", "C、c", "D、d"]
        for n in range(16, 26):
            lines += [f"{n}.", "A", "B", "C", "D"]
        r = parse(*lines)
        idxs = [q["idx"] for q in r["questions"]]
        self.assertEqual(idxs, list(range(1, 26)))
        for q in r["questions"][15:]:
            self.assertEqual([o["key"] for o in q["options"]], ["A", "B", "C", "D"])


class TestRangeBlock(unittest.TestCase):
    def test_range_line_creates_questions(self):
        """2003-B 卷「16-25」整块图：文本层无逐题内容，按区间建题（图由裁图脚本补）。"""
        r = parse(
            "第二部分判断推理",
            "一、图形推理：本部分包括两种类型的题目，共10题。",
            "16-25",
            "二、演绎推理：共15题",
            "26.题干甲（",
            "）。",
            "A、a",
            "B、b",
            "C、c",
            "D、d",
        )
        idxs = [q["idx"] for q in r["questions"]]
        self.assertEqual(idxs, list(range(16, 27)))
        self.assertTrue(all(q.get("_subtype") == "图形推理" for q in r["questions"] if q["idx"] <= 25))
        self.assertTrue(any("整块图" in w for w in r["warnings"]))


class TestAnswerBackfill(unittest.TestCase):
    def _paper(self, pid, year, questions):
        return {"id": pid, "year": year, "level": "副省级", "title": pid, "warnings": [], "questions": questions}

    def _q(self, idx, stem, opts, answer=None):
        return {"idx": idx, "stem": stem, "options": [{"key": k, "text": t} for k, t in opts], "answer": answer}

    def test_same_question_backfilled(self):
        import json
        import tempfile
        from pathlib import Path

        opts = [("A", "甲"), ("B", "乙"), ("C", "丙"), ("D", "丁")]
        a = self._paper("guokao-xingce-2016-副省级", 2016, [self._q(1, "题干甲", opts, "B")])
        b = self._paper("guokao-xingce-2016-地市级", 2016, [self._q(2, "题干甲", opts)])
        with tempfile.TemporaryDirectory() as d:
            for p in (a, b):
                (Path(d) / f"{p['id']}.json").write_text(json.dumps(p, ensure_ascii=False), encoding="utf-8")
            n = px.backfill_answers(Path(d))
            self.assertEqual(n, 1)
            out = json.loads((Path(d) / "guokao-xingce-2016-地市级.json").read_text(encoding="utf-8"))
            self.assertEqual(out["questions"][0]["answer"], "B")

    def test_placeholder_option_question_not_matched(self):
        """图形题题干+占位选项都相同，不得互相回填（2016 副省 76 踩过）。"""
        import json
        import tempfile
        from pathlib import Path

        ph = [("A", "（原卷为图形/公式，待补图）"), ("B", "（原卷为图形/公式，待补图）"), ("C", "（原卷为图形/公式，待补图）"), ("D", "（原卷为图形/公式，待补图）")]
        generic = "从所给的四个选项中，选择最合适的一个填入问号处，使之呈现一定规律性："
        a = self._paper("guokao-xingce-2016-副省级", 2016, [self._q(76, generic, ph, "B")])
        b = self._paper("guokao-xingce-2016-地市级", 2016, [self._q(80, generic, ph)])
        with tempfile.TemporaryDirectory() as d:
            for p in (a, b):
                (Path(d) / f"{p['id']}.json").write_text(json.dumps(p, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(px.backfill_answers(Path(d)), 0)
            out = json.loads((Path(d) / "guokao-xingce-2016-地市级.json").read_text(encoding="utf-8"))
            self.assertIsNone(out["questions"][0]["answer"])


if __name__ == "__main__":
    unittest.main()
