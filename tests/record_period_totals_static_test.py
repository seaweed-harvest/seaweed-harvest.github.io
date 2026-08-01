import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


class RecordPeriodTotalsStaticTest(unittest.TestCase):
    def setUp(self):
        self.records = read("records.html")
        self.records_script = read("assets/js/records_page.js")
        self.admin_script = read("assets/js/admin_page.js")
        self.migration = read(
            "supabase/migrations/20260801090000_record_period_totals.sql"
        )

    def test_period_controls_are_shared_across_all_record_categories(self):
        for category in ("summary", "intake", "site_sample", "stock", "process"):
            self.assertIn(f"'{category}'", self.migration)
        for element_id in (
            "operationalSummaryGrouping",
            "monthlyGrouping",
            "formLedgerGrouping",
            "operationalSummaryCalendar",
            "monthlyCalendar",
            "formLedgerCalendar",
        ):
            self.assertIn(f'id="{element_id}"', self.records)
        self.assertEqual(1, self.records.count(">Period Totals</button>"))

    def test_day_is_the_default_and_grouping_changes_reload(self):
        self.assertGreaterEqual(
            self.records.count('<option value="day" selected>Day</option>'),
            3,
        )
        self.assertIn(
            'els.formLedgerGrouping.addEventListener("change"',
            self.records_script,
        )
        self.assertIn(
            'els.operationalSummaryGrouping.addEventListener("change"',
            self.records_script,
        )
        self.assertIn(
            'els.monthlyGrouping?.addEventListener("change"',
            self.admin_script,
        )

    def test_period_rpc_only_returns_periods_with_records(self):
        self.assertIn("group by 1", self.migration)
        self.assertNotIn("generate_series", self.migration)
        self.assertIn("order by period_start desc", self.migration)
        self.assertIn("when 'week' then p_period_start + 6", self.migration)

    def test_stock_container_lookup_stays_in_record_period_tabs(self):
        self.assertIn('id="recordContainerLookupTab"', self.records)
        self.assertIn(
            'els.recordContainerLookupTab.hidden = state.category !== "stock"',
            self.records_script,
        )
        self.assertIn(
            'if (nextMode === "container") state.category = "stock"',
            self.records_script,
        )
        self.assertNotIn("Container Lookup</a>", read("assets/js/app_navigation.js"))

    def test_local_page_links_resolve_to_existing_files(self):
        missing = []
        for html_path in ROOT.glob("*.html"):
            source = html_path.read_text(encoding="utf-8")
            for href in re.findall(r'href=["\'](\./[^"\'#?]+)', source):
                target = ROOT / href.removeprefix("./")
                if not target.exists():
                    missing.append(
                        f"{html_path.name}: {href}"
                    )
        self.assertEqual([], missing)


if __name__ == "__main__":
    unittest.main()
