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
        self.legacy_monthly = read("admin_monthly.html")
        self.script = read("assets/js/records_page.js")
        self.navigation = read("assets/js/app_navigation.js")
        self.pwa_bootstrap = read("assets/js/pwa_bootstrap.js")
        self.service_worker = read("service-worker.js")
        self.reporting = read(
            "supabase/migrations/20260723290000_form_record_reporting.sql"
        )
        self.period_reporting = read(
            "supabase/migrations/20260801090000_record_period_totals.sql"
        )

    def test_form_tabs_match_todays_record_order_and_heading_location(self):
        expected = (
            "Site Water Samples",
            "Intake",
            "Stock",
            "Process",
        )
        self.assertIn('class="today-records-heading form-ledger-heading"', self.records)
        category_tabs = self.records.split('id="formLedgerCategories"', 1)[1].split("</nav>", 1)[0]
        positions = [category_tabs.index(f">{label}</button>") for label in expected]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('data-ledger-category="intake"', self.records)
        self.assertNotIn('href="./admin_ledger.html">2. Intake Collection</a>', self.records)

    def test_record_ledgers_defaults_to_interval_totals_on_desktop(self):
        periods = (
            "Interval Totals",
            "Today's Record",
            "Community Records",
            "Container Lookup",
            "All Records",
        )
        positions = [self.records.index(label) for label in periods]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('id="recordTodayWorkspace"', self.records)
        self.assertIn('id="todayIntakeDate"', self.records)
        self.assertIn('id="todayIntakeRows"', self.records)
        self.assertIn('data-today-default-category="summary"', self.records)
        self.assertIn('mode: "monthly"', self.script)
        self.assertIn('category: "summary"', self.script)
        self.assertIn('MOBILE_RECORDS_QUERY', self.script)
        self.assertIn('state.mode = "today"', self.script)

    def test_standalone_daily_route_remains_available_for_collectors(self):
        self.assertIn('id="todayRecordTabs"', self.today)
        self.assertIn('id="todayIntakeDate"', self.today)
        self.assertIn('id="publicTodayRows"', self.today)
        self.assertIn('src="./assets/js/today_page.js', self.today)

    def test_legacy_summary_route_redirects_to_merged_record_workspace(self):
        self.assertIn('params.get("records") !== "summary"', self.today)
        self.assertIn('new URL("./records.html"', self.today)
        self.assertIn("target.search = params.toString()", self.today)
        self.assertIn("window.location.replace(target.href)", self.today)

    def test_first_party_summary_links_use_merged_record_workspace(self):
        source_paths = [
            *ROOT.glob("*.html"),
            *(ROOT / "assets" / "js").rglob("*.js"),
            *(ROOT / "supabase" / "functions").rglob("*.ts"),
        ]
        offenders = [
            str(path.relative_to(ROOT))
            for path in source_paths
            if "today.html?records=summary" in path.read_text(encoding="utf-8")
        ]
        self.assertEqual([], offenders)

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
        self.assertIn("seaweed-harvest-collection-v140", self.service_worker)

    def test_legacy_collection_route_preserves_filters_and_redirects(self):
        self.assertIn('new URL("./records.html"', self.legacy_collection)
        self.assertIn('target.searchParams.set("category", "intake")', self.legacy_collection)
        self.assertIn("window.location.replace(target.href)", self.legacy_collection)

    def test_legacy_monthly_route_opens_canonical_period_totals(self):
        self.assertIn('new URL("./records.html"', self.legacy_monthly)
        self.assertIn('target.searchParams.set("category", "intake")', self.legacy_monthly)
        self.assertIn('target.searchParams.set("view", "monthly")', self.legacy_monthly)
        self.assertIn("window.location.replace(target.href)", self.legacy_monthly)

    def test_each_operational_form_has_period_reporting_and_calendar(self):
        self.assertIn('id="formLedgerMonthlyPanel"', self.records)
        self.assertIn('id="formLedgerGrouping"', self.records)
        self.assertIn('id="formLedgerPeriodFrom"', self.records)
        self.assertIn('id="formLedgerPeriodTo"', self.records)
        self.assertIn('id="formLedgerCalendar"', self.records)
        self.assertIn('id="operationalSummaryCalendar"', self.records)
        self.assertIn('id="formLedgerDayRecords"', self.records)
        for key in ("process", "site_sample", "stock"):
            self.assertIn(f"{key}:", self.script)
        for phrase in (
            "record_count",
            "period_start",
            "ag_sec_record_period_totals",
            "moonEvents",
        ):
            self.assertIn(phrase, self.script)
        self.assertIn("'period_end'", self.period_reporting)

    def test_period_totals_support_day_week_month_and_year(self):
        for grouping in ("day", "week", "month", "year"):
            self.assertIn(f'<option value="{grouping}"', self.records)
        self.assertIn('p_grouping text default \'day\'', self.period_reporting)
        self.assertIn("date_trunc(v_grouping", self.period_reporting)
        self.assertIn("order by period_start desc", self.period_reporting)

    def test_community_reporting_is_only_available_for_site_samples(self):
        self.assertIn('id="formLedgerCommunityTab"', self.records)
        self.assertIn('id="formLedgerCommunityPanel"', self.records)
        self.assertIn('state.category === "site_sample"', self.script)
        self.assertIn("els.formLedgerCommunityTab.hidden = !formCommunityAvailable", self.script)
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
        self.assertIn("public.ag_require_permission('can_view_data')", self.period_reporting)
        self.assertIn("public.ag_require_active_aggregator()", self.period_reporting)
        self.assertIn(
            "grant execute on function public.ag_sec_record_period_totals",
            self.period_reporting,
        )
        self.assertNotIn("to anon;", self.period_reporting)

    def test_stock_and_site_units_are_normalized_for_summary_values(self):
        self.assertIn("record.weight_unit = 'mL'", self.reporting)
        self.assertIn("record.weight_value / 1000", self.reporting)
        self.assertIn("lower(record.tds_unit) = 'mg/l'", self.reporting)
        self.assertIn("record.tds_value * 1000", self.reporting)


if __name__ == "__main__":
    unittest.main()
