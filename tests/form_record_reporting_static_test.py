import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


class FormRecordReportingStaticTest(unittest.TestCase):
    def setUp(self):
        self.records = read("records.html")
        self.today = read("today.html")
        self.legacy_collection = read("admin_ledger.html")
        self.script = read("assets/js/records_page.js")
        self.navigation = read("assets/js/app_navigation.js")
        self.pwa_bootstrap = read("assets/js/pwa_bootstrap.js")
        self.service_worker = read("service-worker.js")
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
        self.assertIn('class="today-records-heading form-ledger-heading"', self.records)
        positions = [self.records.index(label) for label in expected]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('data-ledger-category="intake"', self.records)
        self.assertNotIn('href="./admin_ledger.html">2. Intake Collection</a>', self.records)

    def test_record_ledgers_defaults_to_embedded_daily_workspace(self):
        periods = (
            "Today's Record",
            "Monthly Records",
            "Community Records",
            "All Records",
        )
        positions = [self.records.index(label) for label in periods]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('id="recordTodayWorkspace"', self.records)
        self.assertIn('id="todayIntakeDate"', self.records)
        self.assertIn('id="todayIntakeRows"', self.records)
        self.assertIn('data-today-default-category="summary"', self.records)
        self.assertIn('mode: "today"', self.script)
        self.assertIn('category: "summary"', self.script)
        self.assertIn('MOBILE_RECORDS_QUERY', self.script)

    def test_standalone_daily_route_remains_available_for_collectors(self):
        self.assertIn('id="todayRecordTabs"', self.today)
        self.assertIn('id="todayIntakeDate"', self.today)
        self.assertIn('id="publicTodayRows"', self.today)
        self.assertIn('src="./assets/js/today_page.js', self.today)

    def test_daily_navigation_uses_merged_ledger_for_authorised_users(self):
        self.assertIn('hasPermission(profile, "can_view_data")', self.navigation)
        self.assertIn(
            '"./records.html?view=today&category=intake"',
            self.navigation,
        )
        self.assertIn("linkMatchesCurrentRoute", self.navigation)
        self.assertIn('currentFile !== "records.html"', self.navigation)

    def test_pwa_refreshes_stale_application_shell_after_deployment(self):
        self.assertIn('updateViaCache: "none"', self.pwa_bootstrap)
        self.assertIn(
            "Boolean(navigator.serviceWorker.controller)",
            self.pwa_bootstrap,
        )
        self.assertIn('"controllerchange"', self.pwa_bootstrap)
        self.assertIn("window.location.reload()", self.pwa_bootstrap)
        self.assertIn('cache: "no-store"', self.service_worker)
        self.assertIn("seaweed-harvest-collection-v130", self.service_worker)

    def test_legacy_collection_route_preserves_filters_and_redirects(self):
        self.assertIn('new URL("./records.html"', self.legacy_collection)
        self.assertIn('target.searchParams.set("category", "intake")', self.legacy_collection)
        self.assertIn("window.location.replace(target.href)", self.legacy_collection)

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
