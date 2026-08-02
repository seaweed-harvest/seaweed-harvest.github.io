import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class DailyRecordEmailSummaryStaticTest(unittest.TestCase):
    def test_database_stores_tenant_recipient_preferences_and_delivery_history(self):
        migration = read(
            "supabase/migrations/20260731100000_daily_record_email_summary.sql"
        )
        self.assertIn("receive_daily_summary_email boolean not null default false", migration)
        self.assertIn("ag_daily_record_email_deliveries", migration)
        self.assertIn(
            "unique (aggregator_id, summary_date, recipient_email)",
            migration,
        )
        self.assertIn("ag_admin_daily_summary_recipient_state", migration)
        self.assertIn("aggregator.aggregator_code = 'MAWIMBI'", migration)
        self.assertIn(
            "lower(profile.email) = 'bmichael@cascadiaseaweed.com'",
            migration,
        )

    def test_schedule_runs_at_0800_east_africa_time(self):
        migration = read(
            "supabase/migrations/20260731100000_daily_record_email_summary.sql"
        )
        self.assertIn("'daily-record-email-summary-0800-eat'", migration)
        self.assertIn("'0 5 * * *'", migration)
        self.assertIn("/functions/v1/daily-record-email-summary", migration)
        self.assertIn("'aggregator_code', 'MAWIMBI'", migration)
        self.assertIn("daily_aggregation_summary_secret", migration)

    def test_edge_function_uses_previous_nairobi_day_and_resend(self):
        function = read(
            "supabase/functions/daily-record-email-summary/index.ts"
        )
        self.assertIn('shiftDate(nairobiDate(), -1)', function)
        self.assertIn('timeZone: "Africa/Nairobi"', function)
        self.assertIn('Deno.env.get("RESEND_API_KEY")', function)
        self.assertIn('fetch("https://api.resend.com/emails"', function)
        self.assertIn('"Idempotency-Key"', function)
        self.assertIn("ag_daily_record_email_deliveries", function)
        self.assertIn("receive_daily_summary_email", function)
        self.assertIn('body.action === "delivery_status"', function)
        self.assertIn("last_event: result.last_event", function)
        self.assertIn(
            "100 - ((processTotals.dry / processTotals.wet) * 100)",
            function,
        )

    def test_email_contains_all_four_operational_sections(self):
        function = read(
            "supabase/functions/daily-record-email-summary/index.ts"
        )
        for label in (
            'emailSection("Facility Process Record"',
            'emailSection("Intake Collection"',
            'emailSection("Stock Record"',
            'emailSection("Site Water Samples"',
            'metric("Total paid"',
            'metric("Wet/dry extraction"',
            'metric("Stock L / intake kg"',
        ):
            self.assertIn(label, function)
        self.assertLess(
            function.index('emailSection("Intake Collection"'),
            function.index('emailSection("Stock Record"'),
        )
        self.assertLess(
            function.index('emailSection("Stock Record"'),
            function.index('emailSection("Facility Process Record"'),
        )
        self.assertLess(
            function.index('emailSection("Facility Process Record"'),
            function.index('emailSection("Site Water Samples"'),
        )
        self.assertIn(
            'metric("Retested containers", formatInteger(summary.stock_retested_container_count))',
            function,
        )
        self.assertNotIn('metric("Stock records"', function)
        self.assertIn(
            "/records.html?records=summary&date=${summaryDate}",
            function,
        )
        self.assertNotIn("/today.html?records=summary", function)

    def test_email_rebuilds_four_previous_days_and_omits_empty_history(self):
        function = read(
            "supabase/functions/daily-record-email-summary/index.ts"
        )
        self.assertIn("[1, 2, 3, 4].map", function)
        self.assertIn(".filter(hasOperationalRecords)", function)
        self.assertIn("recent_summaries: recentSummaries", function)
        self.assertIn("Recent daily records", function)
        self.assertIn("recentSummaries.map", function)
        for label in (
            'metric("Total intake weight"',
            'metric("Total paid"',
            'metric("Stock volume"',
            'metric("Processing time"',
            'metric("Collections"',
            'metric("Site samples"',
            'metric("Communities"',
        ):
            self.assertIn(label, function)

    def test_stock_summary_counts_distinct_retested_containers(self):
        function = read(
            "supabase/functions/daily-record-email-summary/index.ts"
        )
        self.assertIn("stock_retested_container_count: number", function)
        self.assertIn('String(row.record_type || "initial").toLowerCase() === "retest"', function)
        self.assertIn("countRetestedContainers(", function)
        self.assertIn('.eq("record_type", "retest")', function)
        self.assertIn("summary.stock_retested_container_count = await", function)

    def test_email_uses_compact_regular_weight_values_and_date_links(self):
        function = read(
            "supabase/functions/daily-record-email-summary/index.ts"
        )
        self.assertIn("padding:6px 9px", function)
        self.assertIn("font-weight:700;text-transform:uppercase", function)
        self.assertIn("font-weight:400;line-height:1.2", function)
        self.assertIn(">open daily record</a>)", function)
        self.assertIn("border-top:2px solid #0f766e", function)
        self.assertNotIn("display:inline-block;padding:11px 17px", function)

    def test_intake_summaries_put_activity_before_grade_row(self):
        function = read(
            "supabase/functions/daily-record-email-summary/index.ts"
        )
        email_intake = function.split(
            'emailSection("Intake Collection"', 1
        )[1].split('emailSection("Stock Record"', 1)[0]
        self.assertLess(
            email_intake.index('metric("Farmers"'),
            email_intake.index('metric("Grade A"'),
        )
        script = read("assets/js/today_record_tabs.js")
        site_intake = script.split(
            'summaryGroup("Intake collection"', 1
        )[1].split('summaryGroup("Site water samples"', 1)[0]
        self.assertLess(
            site_intake.index('metric("Farmers"'),
            site_intake.index('metric("Grade A"'),
        )

    def test_email_branding_uses_current_logo_and_concise_footer(self):
        expected_logo = (
            "https://seaweed-harvest.com/assets/images/"
            "seaweed-harvest-logo.png"
        )
        expected_footer = "by Cascadia Nature-based Solutions."
        for path in (
            "supabase/templates/invite.html",
            "supabase/templates/confirmation.html",
            "supabase/templates/recovery.html",
        ):
            template = read(path)
            self.assertIn(expected_logo, template)
            self.assertIn(expected_footer, template)
            self.assertNotIn("&#127807;", template)

        function = read(
            "supabase/functions/daily-record-email-summary/index.ts"
        )
        self.assertIn(
            "${APP_SITE_URL}/assets/images/seaweed-harvest-logo.png",
            function,
        )
        self.assertIn(expected_footer, function)
        self.assertIn('colspan="4"', function)

    def test_user_management_exposes_per_organisation_recipient_selection(self):
        page = read("admin_users.html")
        script = read("assets/js/users_page.js")

        self.assertIn('id="inviteDailySummaries"', page)
        self.assertIn('id="editDailySummaries"', page)
        self.assertIn("08:00 Kenya time", page)
        self.assertIn("Daily email", page)
        self.assertIn("ag_admin_daily_summary_recipient_state", script)
        self.assertIn("renderDailySummaryInputs", script)
        self.assertIn("daily_summary_aggregator_ids", script)

    def test_today_summary_uses_facility_process_record_name(self):
        script = read("assets/js/today_record_tabs.js")
        self.assertIn('summaryGroup("Facility Process Record"', script)
        self.assertIn('data-today-record-tab="process-record"', read("today.html"))
        self.assertIn(">4. Process Record</button>", read("today.html"))

    def test_function_is_publicly_routable_but_secret_authenticated(self):
        config = read("supabase/config.toml")
        function = read(
            "supabase/functions/daily-record-email-summary/index.ts"
        )
        self.assertIn("[functions.daily-record-email-summary]", config)
        self.assertIn("verify_jwt = false", config)
        self.assertIn("x-daily-email-summary-secret", function)
        self.assertIn("DAILY_RECORD_EMAIL_MANUAL_SECRET", function)
        self.assertIn("x-daily-email-manual-secret", function)
        self.assertIn("Unauthorized daily summary invocation", function)

    def test_cache_version_is_advanced_for_summary_label_update(self):
        worker = read("service-worker.js")
        self.assertIn(
            'CACHE_VERSION = "seaweed-harvest-collection-v138"',
            worker,
        )


if __name__ == "__main__":
    unittest.main()
