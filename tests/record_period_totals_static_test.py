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
        self.active_days_migration = read(
            "supabase/migrations/20260802090000_period_totals_active_days.sql"
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
        self.assertEqual(1, self.records.count(">Interval Totals</button>"))
        self.assertNotIn(">Period Totals</button>", self.records)

    def test_interval_totals_is_the_default_desktop_record_view(self):
        periods = (
            "Interval Totals",
            "Today's Record",
            "Community Records",
            "Container Lookup",
            "All Records",
        )
        positions = [self.records.index(label) for label in periods]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('data-record-period="monthly" aria-selected="true"', self.records)
        self.assertIn('mode: "monthly"', self.records_script)
        self.assertIn('params.get("view") || "monthly"', self.admin_script)

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

    def test_aggregated_periods_include_active_days_without_date_range_columns(self):
        self.assertIn("'active_day_count'", self.active_days_migration)
        self.assertIn("p_grouping,", self.active_days_migration)
        self.assertIn("'day',", self.active_days_migration)
        self.assertIn('"active_day_count", "Active days"', self.records_script)
        self.assertNotIn('["first_record_date", "First date"', self.records_script)
        self.assertNotIn('["last_record_date", "Last date"', self.records_script)
        self.assertNotIn("<th>Avg kg</th>", self.records)
        self.assertNotIn("<th>First date</th>", self.records)
        self.assertNotIn("<th>Last date</th>", self.records)
        self.assertIn('id="monthlyActiveDaysHeading" hidden', self.records)

    def test_week_rows_use_the_date_without_repeating_week_starting(self):
        self.assertIn('if (grouping === "week") return dateLabel;', self.records_script)
        self.assertIn('if (grouping === "week") return dateLabel;', self.admin_script)
        self.assertNotIn('return `Week starting ${dateLabel}`', self.records_script)

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

    def test_stock_activity_calendar_excludes_retests(self):
        self.assertIn("stockInitialActivityRows(activityReport.rows)", self.records_script)
        self.assertIn("record_count: Number(row.new_count || 0)", self.records_script)

    def test_process_totals_show_liquid_per_received_ratio(self):
        self.assertIn(
            '["liquid_per_received_l_kg", "Liquid (L) / Received (kg)", "number"]',
            self.records_script,
        )
        self.assertIn("liquidL / receivedKg", self.records_script)
        self.assertNotIn("Avg dry pulp/received %", self.records_script)

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
