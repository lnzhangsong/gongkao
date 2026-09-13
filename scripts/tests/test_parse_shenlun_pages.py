"""parse-shenlun-pdf.py 的 clean_pages 页码/水印清洗回归测试。

真实 bug（docs/申论功能整合新方案.md §9.3）：

P1：2025 三卷 PDF 的页脚 `第N页，共M页` 未被识别，作为正文写进材料与参考答案，
    随 /api/exams 返回，用户在真题页正文中间看到「第1页，共10页」。
根因：clean_pages 的页码 fullmatch 只覆盖 `- 5 -` 与 `1 / 14`。

P4：PDF 来源站点夹带的推广/来源水印被当成答案正文入库：
    · 2025 三卷参考答案尾 `TB:关注Seeyee智库，获取持续更新————考公-考研-四六级-事业单位…`
    · 2012 副省级解析页首 `来源：F整理：杨柳（微信：gwy288）`
根因：clean_pages 只清页码与重复页眉，没有任何广告行清洗。

这里把三种页码形态 + 两类水印形态锁死，并守住「正文提到微信/QQ群/智库/扫码关注」
这类合法内容不得误删——误删正文比漏删广告更糟。

    python3 -m unittest discover -s scripts/tests -v
"""

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "parse_shenlun_pdf", ROOT / "scripts" / "parse-shenlun-pdf.py"
)
mod = importlib.util.module_from_spec(_spec)
sys.modules["parse_shenlun_pdf"] = mod
_spec.loader.exec_module(mod)

clean_pages = mod.clean_pages


def clean(lines, title_key="读取标题"):
    """单页输入 → 清洗后的行列表。"""
    return clean_pages([lines], title_key)[0]


class TestPageFooterForms(unittest.TestCase):
    def test_di_n_page_footer_2025(self):
        """P1 回归：2025 三卷页脚形态「第N页，共M页」必须清掉"""
        out = clean(["正文第一段。", "第1页，共10页", "正文第二段。"])
        self.assertEqual(out, ["正文第一段。", "正文第二段。"])

    def test_di_n_page_footer_with_spaces(self):
        """PDF 抽取可能带空格，正则需容错"""
        out = clean(["正文。", "第 3 页 ， 共 9 页"])
        self.assertEqual(out, ["正文。"])

    def test_halfwidth_comma_and_lowercase_variant(self):
        out = clean(["正文。", "第2页,共10页"])
        self.assertEqual(out, ["正文。"])

    def test_dash_page_number(self):
        out = clean(["正文。", "- 5 -", "尾段。"])
        self.assertEqual(out, ["正文。", "尾段。"])

    def test_slash_page_number(self):
        out = clean(["正文。", "1 / 14", "尾段。"])
        self.assertEqual(out, ["正文。", "尾段。"])


class TestDoNotOverStrip(unittest.TestCase):
    def test_page_footer_inside_sentence_kept(self):
        """整行不是纯页码时不得删——正文可能引用页码"""
        line = "详见第1页，共10页中的表格说明。"
        self.assertEqual(clean([line]), [line])

    def test_page_footer_with_trailing_text_kept(self):
        """页脚与正文被并到同一行时，fullmatch 不匹配 → 保留，避免误删正文"""
        line = "第1页，共10页据介绍，黄河水利委员会现已基本形成水文预报。"
        self.assertEqual(clean([line]), [line])

    def test_normal_body_lines_untouched(self):
        lines = ["材料一", "近年来，数字经济发展迅速。", "2024 年增长 12 / 15 个百分点。"]
        self.assertEqual(clean(lines), lines)


class TestHeaderAndBlankCollapse(unittest.TestCase):
    def test_repeated_running_header_dropped_after_first_page(self):
        pages = [["读取标题", "正文一。"], ["读取标题", "正文二。"]]
        out = clean_pages(pages, "读取标题")
        self.assertEqual(out, [["读取标题", "正文一。"], ["正文二。"]])

    def test_consecutive_blanks_collapsed(self):
        out = clean(["正文。", "", "", "尾段。"])
        self.assertEqual(out, ["正文。", "", "尾段。"])


class TestNoiseWatermarkLines(unittest.TestCase):
    """P4 回归：推广/来源水印整行必须清掉"""

    def test_seeyee_ad_line_2025(self):
        ad = "TB:关注Seeyee智库，获取持续更新————考公-考研-四六级-事业单位…"
        self.assertEqual(clean(["答案正文。", ad]), ["答案正文。"])

    def test_seeyee_ad_with_space_variant(self):
        """PDF 抽取在英文与中文间插空格：Seeyee 智库"""
        ad = "TB:关注Seeyee 智库，获取持续更新————考公-考研-四六级-事业单位…"
        self.assertEqual(clean(["答案正文。", ad]), ["答案正文。"])

    def test_source_attribution_line_2012(self):
        ad = "来源：F 整理：杨柳（微信：gwy288）"
        self.assertEqual(clean(["解析标题", ad, "一、参考答案："]), ["解析标题", "一、参考答案："])

    def test_bare_contact_line(self):
        self.assertEqual(clean(["正文。", "微信：gwy288"]), ["正文。"])


class TestNoiseMustNotOverStrip(unittest.TestCase):
    """反例：申论材料常讨论政务新媒体/互联网组织，这些正文不得被当广告删掉"""

    def test_material_mentioning_wechat_kept(self):
        lines = [
            "社工第一时间发到微信群，并让商家整改。",
            "创建“临诗渔村”微信公众号、开办网店。",
        ]
        self.assertEqual(clean(lines), lines)

    def test_material_mentioning_qq_group_kept(self):
        line = "他们也可以利用信息技术，在没有领头人的情况下，用QQ群建立维权组织。"
        self.assertEqual(clean([line]), [line])

    def test_material_mentioning_think_tank_kept(self):
        line = "关键还是在于咱们能体现出智库作用。"
        self.assertEqual(clean([line]), [line])

    def test_guidance_to_follow_official_account_kept(self):
        """「扫码关注公众号」若出现在材料正文里不得误删（故未纳入清洗特征）"""
        line = "工作人员引导群众扫码关注公众号获取最新政策。"
        self.assertEqual(clean([line]), [line])

    def test_material_mentioning_willow_kept(self):
        """「杨柳」既可能是署名也可能是正文（两岸杨柳依依）"""
        line = "清澈的万仑河微波澜起，两岸杨柳依依。"
        self.assertEqual(clean([line]), [line])


if __name__ == "__main__":
    unittest.main()
