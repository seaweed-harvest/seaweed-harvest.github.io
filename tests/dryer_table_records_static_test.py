import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class DryerTableRecordsStaticTest(unittest.TestCase):
    def setUp(self):
        self.page = (ROOT / "dryer_table_records.html").read_text(encoding="utf-8")
        self.script = (ROOT / "assets/js/dryer_table_records.js").read_text(encoding="utf-8")
        self.navigation = (ROOT / "assets/js/app_navigation.js").read_text(encoding="utf-8")
        self.migration = (
            ROOT
            / "supabase/migrations/20260901103000_authenticated_dryer_table_records.sql"
        ).read_text(encoding="utf-8")

    def test_page_uses_shared_record_ledger_shell_and_three_tabs(self):
        self.assertIn("form-record-ledgers-page", self.page)
        self.assertIn("form-ledger-panel", self.page)
        self.assertIn("responsive-table-wrap", self.page)
        self.assertIn('data-auth-pending', self.page)
        for label in ("All Records", "Observations", "Payment Register"):
            self.assertIn(label, self.page)

    def test_all_records_columns_match_agreed_bay_summary(self):
        for heading in (
            "Table",
            "Bay",
            "Status",
            "Loaded",
            "Wet kg",
            "Unloaded",
            "Dry kg",
            "Weight loss",
            "Drying time",
            "Photos",
        ):
            self.assertRegex(self.page, rf"<th>{re.escape(heading)}</th>")

    def test_observations_are_separate_from_main_ledger(self):
        self.assertIn('id="dryerObservationsPanel"', self.page)
        for heading in (
            "General observations",
            "Working well",
            "Not working",
        ):
            self.assertIn(f"<th>{heading}</th>", self.page)
        all_panel = re.search(
            r'<section id="dryerAllPanel".*?</section>', self.page, re.DOTALL
        )
        self.assertIsNotNone(all_panel)
        self.assertNotIn("General observations", all_panel.group(0))

    def test_payment_register_is_placeholder_only(self):
        payment_panel = re.search(
            r'<section id="dryerPaymentsPanel".*?</section>', self.page, re.DOTALL
        )
        self.assertIsNotNone(payment_panel)
        self.assertIn("No payment logic is active", payment_panel.group(0))
        self.assertNotRegex(payment_panel.group(0), r"KES|KSH|rate|amount|paid date")

    def test_page_requires_cosme_owner_data_access(self):
        self.assertIn('requireAggregatorAccess(', self.script)
        self.assertIn('"COSME"', self.script)
        self.assertIn('"can_view_data"', self.script)
        self.assertIn('"form_dryer_table"', self.script)
        self.assertIn('is_protected_owner !== true', self.script)
        self.assertIn('window.location.replace("./access_pending.html")', self.script)

    def test_navigation_is_owner_cosme_and_capability_gated(self):
        owner_gate = re.search(
            r'isProtectedOwner\(profile\) \? \[\{ label: "Dryer Table Records".*?\}\] : \[\]\)',
            self.navigation,
        )
        self.assertIsNotNone(owner_gate)
        nav_text = owner_gate.group(0)
        self.assertIn('requiredAggregator: "COSME"', nav_text)
        self.assertIn('permission: "can_view_data"', nav_text)
        self.assertIn('capability: "form_dryer_table"', nav_text)

    def test_filters_grouping_and_status_semantics_are_present(self):
        for control in (
            "dryerTableFilter",
            "dryerFromDate",
            "dryerToDate",
            "dryerStatusFilter",
            "dryerGroupBy",
        ):
            self.assertIn(f'id="{control}"', self.page)
        self.assertIn('option value="table" selected', self.page)
        self.assertIn('option value="load_date"', self.page)
        for status in ("drying", "complete", "needs_review"):
            self.assertIn(status, self.script)
        self.assertIn("Wet loaded:", self.script)
        self.assertIn("Dry unloaded:", self.script)
        self.assertIn("Currently drying:", self.script)
        self.assertIn("Completed cycles:", self.script)

    def test_backend_is_read_only_and_validates_account_project_token(self):
        self.assertIn("create or replace function public.list_authenticated_seaweed_drying_ledger", self.migration.lower())
        self.assertIn("ag_my_profile", self.migration)
        self.assertIn("is_protected_owner", self.migration)
        self.assertIn("active_aggregator_code", self.migration)
        self.assertIn("form_dryer_table", self.migration)
        self.assertIn("raise exception 'Authentication required.'", self.migration)
        self.assertIn("revoke all on function", self.migration.lower())
        self.assertIn("grant execute", self.migration.lower())
        for mutating_pattern in (
            r"insert\s+into\s+public\.seaweed_drying_",
            r"update\s+public\.seaweed_drying_",
            r"delete\s+from\s+public\.seaweed_drying_",
            r"truncate\s+(table\s+)?public\.seaweed_drying_",
            r"alter\s+table\s+public\.seaweed_drying_",
        ):
            self.assertNotRegex(self.migration.lower(), mutating_pattern)

    def test_public_dryer_form_assets_are_not_replaced_by_ledger(self):
        dryer_page = (ROOT / "dryer_table.html").read_text(encoding="utf-8")
        dryer_bootstrap = (ROOT / "assets/js/dryer_table_bootstrap.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("dryer_table_form.js", dryer_page)
        self.assertNotIn("dryer_table_records.js", dryer_page)
        self.assertNotIn("requireAggregatorAccess", dryer_bootstrap)
        self.assertNotIn("window.location.replace", dryer_bootstrap)


if __name__ == "__main__":
    unittest.main()
