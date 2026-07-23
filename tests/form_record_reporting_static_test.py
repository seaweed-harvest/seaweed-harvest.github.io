import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


class FormRecordReportingStaticTest(unittest.TestCase):
    def setUp(self):
        self.records = read("records.html")
        self.collection = read("admin_ledger.html")
        self.script = read("assets/js/records_page.js")
        self.reporting = read(
            "supabase/migrations/20260723290000_form_record_reporting.sql"
        )

    def test_form_tabs_match_todays_record_order_and_heading_location(self):
        expected = (
            "1. Site Water Samples",
            "2. Intake Collection",
            "3. Stock Record",
            "4. Process Record",
        )
        for page in (self.records, self.collection):
            self.assertIn('class="today-records-heading form-ledger-heading"', page)
            positions = [page.index(label) for label in expected]
            self.assertEqual(positions, sorted(positions))

    def test_each_operational_form_has_monthly_reporting_and_calendar(self):
        self.assertIn('id="formLedgerMonthlyPanel"', self.records)
        self.assertIn('id="formLedgerCalendar"', self.records)
        self.assertIn('id="formLedgerDayRecords"', self.records)
        for key in ("process", "site_sample", "stock"):
            self.assertIn(f"{key}:", self.script)
        for phrase in (
            "record_count",
            "monthly_rows",
            "daily_rows",
            "ag_form_record_summary",
            "moonEvents",
        ):
            self.assertIn(phrase, self.script)

    def test_community_reporting_is_only_available_for_site_samples(self):
        self.assertIn('id="formLedgerCommunityTab"', self.records)
        self.assertIn('id="formLedgerCommunityPanel"', self.records)
        self.assertIn('state.category === "site_sample"', self.script)
        self.assertIn("els.formLedgerCommunityTab.hidden = !communityAvailable", self.script)
        self.assertIn("'community_rows'", self.reporting)

    def test_reporting_rpc_is_tenant_scoped_and_permission_protected(self):
        self.assertIn("public.ag_require_permission('can_view_data')", self.reporting)
        self.assertIn("public.ag_require_active_aggregator()", self.reporting)
        self.assertIn("record.aggregator_id = v_aggregator_id", self.reporting)
        self.assertIn(
            "grant execute on function public.ag_form_record_summary",
            self.reporting,
        )
        self.assertNotIn("to anon", self.reporting)

    def test_stock_and_site_units_are_normalized_for_summary_values(self):
        self.assertIn("record.weight_unit = 'mL'", self.reporting)
        self.assertIn("record.weight_value / 1000", self.reporting)
        self.assertIn("lower(record.tds_unit) = 'mg/l'", self.reporting)
        self.assertIn("record.tds_value * 1000", self.reporting)


if __name__ == "__main__":
    unittest.main()
