import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class EmailReportSubscriptionsStaticTest(unittest.TestCase):
    def test_migration_adds_weekly_monthly_preferences_and_self_service_rpcs(self):
        migration = read(
            "supabase/migrations/20260802120000_email_report_subscriptions.sql"
        )
        self.assertIn("receive_weekly_summary_email boolean not null default false", migration)
        self.assertIn("receive_monthly_summary_email boolean not null default false", migration)
        self.assertIn("ag_my_report_subscriptions()", migration)
        self.assertIn("ag_save_my_report_subscriptions", migration)
        self.assertIn("membership.user_id = v_actor", migration)
        self.assertIn("report_subscriptions_updated", migration)

    def test_delivery_history_is_idempotent_per_report_type_and_period(self):
        migration = read(
            "supabase/migrations/20260802120000_email_report_subscriptions.sql"
        )
        self.assertIn("report_type text not null default 'daily'", migration)
        self.assertIn("period_start date", migration)
        self.assertIn("('daily', 'weekly', 'monthly')", migration)
        self.assertIn(
            "unique (aggregator_id, report_type, summary_date, recipient_email)",
            migration,
        )

    def test_schedules_use_0800_east_africa_time_for_completed_periods(self):
        migration = read(
            "supabase/migrations/20260802120000_email_report_subscriptions.sql"
        )
        self.assertIn("'weekly-record-email-summary-0800-eat'", migration)
        self.assertIn("'0 5 * * 1'", migration)
        self.assertIn("'report_type', 'weekly'", migration)
        self.assertIn("'monthly-record-email-summary-0800-eat'", migration)
        self.assertIn("'0 5 1 * *'", migration)
        self.assertIn("'report_type', 'monthly'", migration)

    def test_edge_function_builds_daily_weekly_and_monthly_reports(self):
        function = read("supabase/functions/daily-record-email-summary/index.ts")
        self.assertIn('type ReportType = "daily" | "weekly" | "monthly"', function)
        self.assertIn("buildSummariesForPeriod", function)
        self.assertIn("weeklyRows(activeSummaries, period)", function)
        self.assertIn("periodEmailHtml", function)
        self.assertIn("periodActivityTable", function)
        self.assertIn("Active days", function)
        self.assertIn("Active weeks", function)
        self.assertIn("receive_weekly_summary_email", function)
        self.assertIn("receive_monthly_summary_email", function)
        self.assertIn("aggregator_id,report_type,summary_date,recipient_email", function)

    def test_period_report_schedules_are_staggered_and_retried(self):
        migration = read(
            "supabase/migrations/20260803090000_email_report_schedule_reliability.sql"
        )

        self.assertIn("'5 5 * * 1'", migration)
        self.assertIn("'20 5 * * 1'", migration)
        self.assertIn("'10 5 1 * *'", migration)
        self.assertIn("'25 5 1 * *'", migration)
        self.assertIn("weekly-record-email-summary-retry-0820-eat", migration)
        self.assertIn("monthly-record-email-summary-retry-0825-eat", migration)

    def test_missed_weekly_report_has_idempotent_recovery(self):
        migration = read(
            "supabase/migrations/20260803091000_recover_weekly_report_20260802.sql"
        )

        self.assertIn("'report_type', 'weekly'", migration)
        self.assertIn("'summary_date', '2026-08-02'", migration)
        self.assertNotIn("'force', true", migration)

    def test_empty_reporting_periods_are_skipped_before_recipient_delivery(self):
        function = read("supabase/functions/daily-record-email-summary/index.ts")
        guard = 'if (!activeSummaries.length) {'
        self.assertIn(guard, function)
        self.assertIn('report_skipped: true', function)
        self.assertIn('skip_reason: "no_operational_records"', function)
        self.assertLess(function.index(guard), function.index("await loadRecipients"))
        self.assertLess(function.index(guard), function.index("for (const recipient of recipients)"))

    def test_all_reports_link_directly_to_subscription_settings(self):
        function = read("supabase/functions/daily-record-email-summary/index.ts")
        self.assertIn("/report_subscriptions.html", function)
        self.assertGreaterEqual(function.count("Manage report emails"), 3)

    def test_email_header_shows_all_recipient_subscription_preferences(self):
        function = read("supabase/functions/daily-record-email-summary/index.ts")
        self.assertIn("subscriptions: Record<ReportType, boolean>", function)
        self.assertIn("membershipSubscriptions(membership)", function)
        self.assertIn("withSubscriptionPreferences(", function)
        self.assertIn("subscriptionPreferenceHtml(recipient)", function)
        self.assertIn("REPORT EMAILS", function)
        self.assertIn('option("Daily", recipient.subscriptions.daily)', function)
        self.assertIn('option("Weekly", recipient.subscriptions.weekly)', function)
        self.assertIn('option("Monthly", recipient.subscriptions.monthly)', function)
        self.assertIn('enabled ? "&#9745;" : "&#9744;"', function)
        self.assertIn('const color = enabled ? "#466b66" : "#9aa9a6"', function)
        self.assertNotIn('${enabled ? "ON" : "OFF"}', function)
        self.assertIn("subscriptionPreferenceText(recipient)", function)

    def test_self_service_page_shows_three_clear_choices_and_stop_all(self):
        page = read("report_subscriptions.html")
        script = read("assets/js/report_subscriptions_page.js")
        self.assertIn("Email reports", page)
        self.assertIn("Stop all reports", page)
        self.assertIn('reportOption("daily", "Daily", "08:00 next day (Kenya time)"', script)
        self.assertIn('reportOption("weekly", "Weekly", "08:00 Monday (Kenya time)"', script)
        self.assertIn(
            'reportOption("monthly", "Monthly", "08:00 after month end (Kenya time)"',
            script,
        )
        self.assertIn("ag_my_report_subscriptions", script)
        self.assertIn("ag_save_my_report_subscriptions", script)

    def test_subscription_page_is_a_supported_authenticated_route(self):
        auth = read("assets/js/auth_client.js")
        login = read("assets/js/login_page.js")
        details = read("my_details.html")
        worker = read("service-worker.js")
        self.assertIn("Report emails", auth)
        self.assertIn('requestedFile === "report_subscriptions.html"', login)
        self.assertIn("./report_subscriptions.html", details)
        self.assertIn('CACHE_VERSION = "seaweed-harvest-collection-v143"', worker)
        self.assertIn('"./report_subscriptions.html"', worker)
        self.assertIn('"./assets/js/report_subscriptions_page.js"', worker)


if __name__ == "__main__":
    unittest.main()
