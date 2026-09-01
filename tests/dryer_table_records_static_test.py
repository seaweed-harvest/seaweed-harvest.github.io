import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class DryerTableRecordsStaticTest(unittest.TestCase):
    def setUp(self):
        self.page = (ROOT / "dryer_table_records.html").read_text(encoding="utf-8")
        self.script = (ROOT / "assets/js/dryer_table_records.js").read_text(
            encoding="utf-8"
        )
        self.payment_script = (
            ROOT / "assets/js/dryer_table_payments.js"
        ).read_text(encoding="utf-8")
        self.payment_math = (
            ROOT / "assets/js/dryer_payment_math.js"
        ).read_text(encoding="utf-8")
        self.navigation = (ROOT / "assets/js/app_navigation.js").read_text(
            encoding="utf-8"
        )
        self.ledger_migration = (
            ROOT
            / "supabase/migrations/20260901103000_authenticated_dryer_table_records.sql"
        ).read_text(encoding="utf-8")
        self.scope_migration = (
            ROOT
            / "supabase/migrations/20260901110500_dryer_table_records_rpc_scope.sql"
        ).read_text(encoding="utf-8")
        self.payment_migrations = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (
                ROOT
                / "supabase/migrations/20260901134500_dryer_activity_payment_foundation.sql",
                ROOT
                / "supabase/migrations/20260901134600_dryer_activity_payment_workspace.sql",
                ROOT
                / "supabase/migrations/20260901134700_dryer_activity_payment_transactions.sql",
            )
        )

    def test_page_uses_shared_record_ledger_shell_and_three_tabs(self):
        self.assertIn("form-record-ledgers-page", self.page)
        self.assertIn("form-ledger-panel", self.page)
        self.assertIn("responsive-table-wrap", self.page)
        self.assertIn('data-auth-pending', self.page)
        for label in ("All Records", "Observations", "Payments"):
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
            self.assertRegex(self.page, rf"<th[^>]*>{re.escape(heading)}</th>")

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

    def test_payments_have_activity_days_and_payment_ledger_subtabs(self):
        self.assertIn('id="dryerPaymentsPanel"', self.page)
        self.assertIn("Activity Days", self.page)
        self.assertIn("Payment Ledger", self.page)
        self.assertIn('class="ledger-view-tabs record-period-tabs"', self.page)
        self.assertNotIn("No payment logic is active", self.page)

    def test_activity_day_table_is_compact_but_actionable(self):
        for heading in (
            "Select",
            "Date",
            "Research Assistant",
            "Activity",
            "Status",
            "Work amount",
            "Phone/data",
            "Approved total",
            "Payment",
        ):
            self.assertRegex(self.page, rf"<th[^>]*>{re.escape(heading)}</th>")
        for element_id in (
            "dryerPaymentSelectionPanel",
            "dryerPaymentDate",
            "dryerPaymentReference",
            "dryerRecordSelectedPayment",
            "dryerAdvanceForm",
            "dryerPaymentLedgerRows",
        ):
            self.assertIn(f'id="{element_id}"', self.page)

    def test_payment_summary_keeps_management_view_simple(self):
        for label in (
            "Needs review",
            "Approved unpaid",
            "Phone/data credit",
            "Current amount due",
        ):
            self.assertIn(label, self.page)

    def test_page_requires_cosme_owner_data_access(self):
        self.assertIn("requireAggregatorAccess(", self.script)
        self.assertIn('"COSME"', self.script)
        self.assertIn('"can_view_data"', self.script)
        self.assertIn('"form_dryer_table"', self.script)
        self.assertIn("is_protected_owner !== true", self.script)
        self.assertIn('window.location.replace("./access_pending.html")', self.script)

    def test_payment_module_requires_owner_finance_access(self):
        self.assertIn("export function canUseDryerPayments", self.payment_script)
        self.assertIn("profile?.is_protected_owner === true", self.payment_script)
        self.assertIn('profile?.app_role === "system_admin"', self.payment_script)
        self.assertIn("profile?.can_view_finance === true", self.payment_script)
        self.assertIn("currentProfile", self.payment_script)
        self.assertIn("paymentsTab.hidden = true", self.payment_script)

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
        self.assertIn('option value="event" selected', self.page)
        self.assertIn('option value="table"', self.page)
        self.assertIn('option value="load_date"', self.page)
        for status in ("drying", "complete", "needs_review"):
            self.assertIn(status, self.script)

    def test_drying_event_group_is_submission_based_and_collapsible(self):
        self.assertIn('if (mode === "event")', self.script)
        self.assertIn("row.submission_id", self.script)
        self.assertIn('storageKey: `${mode}:${key}`', self.script)
        self.assertIn("data-dryer-group-toggle", self.script)
        self.assertIn("data-dryer-group-header", self.script)
        self.assertIn("data-dryer-group-row", self.script)
        self.assertIn('aria-expanded="${expanded ? "true" : "false"}"', self.script)
        self.assertIn('expanded ? "▾" : "▸"', self.script)
        self.assertIn("state.expandedGroups", self.script)
        self.assertIn("row.hidden = !expanded", self.script)
        self.assertIn('els.dryerGroupBy.value = "event"', self.script)

    def test_event_label_uses_table_and_loading_time(self):
        self.assertIn(
            'const loadedAt = earliestTimestamp(rows, "loading_at")',
            self.script,
        )
        self.assertIn(
            'return `${table} — ${formatDateTime(eventAt)}`',
            self.script,
        )
        self.assertRegex(
            self.script,
            r'if \(mode === "event"\)[\s\S]*?Number\(first\.bay_number \|\| 0\) - Number\(second\.bay_number \|\| 0\)',
        )

    def test_missing_unload_values_render_as_missing_not_zero(self):
        self.assertIn("function optionalNumber(value)", self.script)
        self.assertIn(
            'value === null || value === undefined || value === ""', self.script
        )
        self.assertRegex(
            self.script,
            r"function formatOptionalKg\(value\)[\s\S]*?number === null[\s\S]*?[\"']-[\"']",
        )
        self.assertRegex(
            self.script,
            r"function formatWeightLoss\(value\)[\s\S]*?number === null \? [\"']-[\"']",
        )
        self.assertRegex(
            self.script,
            r"function formatDryingMinutes\(value\)[\s\S]*?if \(number === null\) return [\"']-[\"']",
        )

    def test_existing_ledger_backend_remains_read_only(self):
        migration = self.ledger_migration.lower()
        self.assertIn(
            "create or replace function public.list_authenticated_seaweed_drying_ledger",
            migration,
        )
        self.assertIn("ag_my_profile", self.ledger_migration)
        self.assertIn("is_protected_owner", self.ledger_migration)
        self.assertIn("active_aggregator_code", self.ledger_migration)
        self.assertIn("form_dryer_table", self.ledger_migration)
        for mutating_pattern in (
            r"insert\s+into\s+public\.seaweed_drying_",
            r"update\s+public\.seaweed_drying_",
            r"delete\s+from\s+public\.seaweed_drying_",
            r"truncate\s+(table\s+)?public\.seaweed_drying_",
            r"alter\s+table\s+public\.seaweed_drying_",
        ):
            self.assertNotRegex(migration, mutating_pattern)

    def test_existing_dryer_bridge_scope_is_preserved(self):
        self.assertIn(
            "revoke execute on function public.list_authenticated_seaweed_drying_ledger(text, integer) from authenticated",
            self.scope_migration.lower(),
        )
        self.assertIn(
            "separate seaweed harvest account project",
            self.scope_migration.lower(),
        )

    def test_contract_rule_is_enforced_in_database(self):
        migrations = self.payment_migrations.lower()
        self.assertRegex(
            migrations,
            r"loading_count\s*>=\s*8\s+or\s+day_row\.unloading_count\s*>=\s*8",
        )
        self.assertIn(
            "500 + greatest(day_row.total_activity_count - 8, 0) * 25",
            migrations,
        )
        self.assertIn(
            "'reference_amount_kes', day_row.total_activity_count * 25",
            migrations,
        )
        self.assertIn(
            "qualifying days must use the calculated contract amount",
            migrations,
        )
        self.assertIn("phone_data_allowance_kes in (0, 100)", migrations)

    def test_payment_tables_are_rls_protected_and_not_directly_exposed(self):
        migrations = self.payment_migrations.lower()
        for table in (
            "seaweed_drying_activity_day_decisions",
            "seaweed_drying_payment_transactions",
            "seaweed_drying_payment_activity_days",
        ):
            self.assertIn(f"alter table public.{table} enable row level security", migrations)
            self.assertIn(f"revoke all on table public.{table} from anon, authenticated", migrations)

    def test_payment_ledger_is_immutable_and_prevents_double_payment(self):
        migrations = self.payment_migrations.lower()
        self.assertIn(
            "constraint seaweed_drying_payment_activity_days_one_payment",
            migrations,
        )
        self.assertIn("unique (activity_day_decision_id)", migrations)
        self.assertIn(
            "this activity day has already been paid and cannot be changed",
            migrations,
        )
        self.assertIn(
            "one or more selected activity days have already been paid",
            migrations,
        )
        self.assertIn(
            "dryer records changed after approval for activity day",
            migrations,
        )
        self.assertNotRegex(
            migrations,
            r"delete\s+from\s+public\.seaweed_drying_payment_",
        )
        self.assertNotRegex(
            migrations,
            r"update\s+public\.seaweed_drying_payment_transactions",
        )

    def test_phone_advance_offsets_phone_only(self):
        migrations = self.payment_migrations.lower()
        self.assertIn(
            "v_credit_applied := least(v_phone_total, greatest(v_credit_balance, 0))",
            migrations,
        )
        self.assertIn(
            "v_transfer_total := v_work_total + v_phone_total - v_credit_applied",
            migrations,
        )
        self.assertIn(
            "else -payment.phone_data_credit_applied_kes",
            migrations,
        )
        self.assertIn(
            "transferamount:workamount+phonedataamount-phonedatacreditapplied",
            self.payment_math.lower().replace(" ", ""),
        )

    def test_payment_rpc_access_uses_existing_guarded_bridge(self):
        migrations = self.payment_migrations.lower()
        self.assertIn("seaweed_harvest_cosme_finance_owner_profile", migrations)
        self.assertIn("ag_my_profile", migrations)
        self.assertIn("active_aggregator_code", migrations)
        self.assertIn("form_dryer_table", migrations)
        self.assertIn("can_view_finance", migrations)
        for rpc in (
            "list_authenticated_seaweed_drying_payment_workspace",
            "save_authenticated_seaweed_drying_activity_day_decision",
            "record_authenticated_seaweed_drying_phone_advance",
            "record_authenticated_seaweed_drying_activity_payment",
        ):
            self.assertIn(f"grant execute on function public.{rpc}", migrations)
            self.assertIn(f"revoke execute on function public.{rpc}", migrations)

    def test_payment_code_does_not_mutate_source_dryer_records(self):
        migrations = self.payment_migrations.lower()
        for pattern in (
            r"insert\s+into\s+public\.seaweed_drying_submissions",
            r"insert\s+into\s+public\.seaweed_drying_bay_records",
            r"update\s+public\.seaweed_drying_submissions",
            r"update\s+public\.seaweed_drying_bay_records",
            r"delete\s+from\s+public\.seaweed_drying_submissions",
            r"delete\s+from\s+public\.seaweed_drying_bay_records",
            r"alter\s+table\s+public\.seaweed_drying_submissions",
            r"alter\s+table\s+public\.seaweed_drying_bay_records",
        ):
            self.assertNotRegex(migrations, pattern)

    def test_public_dryer_form_assets_are_not_replaced_by_payment_work(self):
        dryer_page = (ROOT / "dryer_table.html").read_text(encoding="utf-8")
        dryer_bootstrap = (ROOT / "assets/js/dryer_table_bootstrap.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("dryer_table_form.js", dryer_page)
        self.assertNotIn("dryer_table_payments.js", dryer_page)
        self.assertNotIn("requireAggregatorAccess", dryer_bootstrap)
        self.assertNotIn("window.location.replace", dryer_bootstrap)


if __name__ == "__main__":
    unittest.main()
