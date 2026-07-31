import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class TodaySummaryTypographyStaticTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = (ROOT / "assets/css/ag.css").read_text(encoding="utf-8")

    def rule(self, selector):
        matches = re.findall(rf"{re.escape(selector)}\s*\{{([^}}]*)\}}", self.css)
        self.assertTrue(matches, selector)
        return next((rule for rule in matches if "font-weight:" in rule), matches[0])

    def test_metric_labels_are_darker_and_bold(self):
        rule = self.rule(".operational-summary-metric span")
        self.assertIn("color: var(--text-sec);", rule)
        self.assertIn("font-weight: 700;", rule)

    def test_all_summary_outputs_use_regular_weight(self):
        for selector in (
            ".operational-summary-metric strong",
            ".operational-summary-community-lines",
            ".operational-summary-metric small",
        ):
            self.assertIn("font-weight: 400;", self.rule(selector), selector)


if __name__ == "__main__":
    unittest.main()
