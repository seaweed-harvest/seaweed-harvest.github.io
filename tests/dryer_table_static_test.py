import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class DryerTableStaticTest(unittest.TestCase):
    def test_drying_trials_panel_is_retained_but_hidden(self):
        page = (ROOT / "dryer_table.html").read_text(encoding="utf-8")
        panel = re.search(r'<details\s+id="dryingTrials"[^>]*>', page)

        self.assertIsNotNone(panel)
        self.assertRegex(panel.group(0), r'\bhidden\b')
        self.assertIn("Drying Trials", page)


if __name__ == "__main__":
    unittest.main()
