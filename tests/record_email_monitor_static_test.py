"""Contract guards; functional PostgreSQL assertions also run inside migrations.
Run: python tests/record_email_monitor_static_test.py
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / 'supabase' / 'migrations'

def read(suffix):
    files = list(MIGRATIONS.glob('*_' + suffix + '.sql'))
    if len(files) != 1:
        raise AssertionError(f'Expected one migration for {suffix}, found {len(files)}')
    return files[0].read_text(encoding='utf-8')

class ReportMonitorContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.foundation = read('mawimbi_record_email_request_logging')
        cls.monitor = read('record_email_outcome_monitor')
        cls.isolation = read('isolate_record_email_recovery_failures')
        cls.recovery = read('recover_mawimbi_weekly_report_20260913')

    def test_sql_regressions_are_enabled(self):
        self.assertIn('set local plpgsql.check_asserts = on;', self.monitor)
        self.assertEqual(self.monitor.count('  assert '), 27)
        self.assertEqual(self.isolation.count('  assert '), 3)

    def test_original_schedules_are_not_rescheduled(self):
        self.assertIn('cron.alter_job(v_job.jobid, command :=', self.monitor)
        self.assertIn('if v_count <> 5 then raise exception', self.monitor)
        self.assertNotIn('cron.unschedule', self.monitor)
        self.assertEqual(self.monitor.count('select cron.schedule('), 1)
        self.assertIn("'record-email-outcome-monitor','*/10 * * * *'", self.monitor)

    def test_only_automatic_weekly_sends_can_recover(self):
        self.assertIn("where report_type = 'weekly' and not dry_run", self.isolation)
        self.assertIn("source in ('pg_cron','pg_cron_retry','pg_cron_recovery')", self.isolation)
        self.assertIn('p_attempt_count < 3', self.monitor)
        self.assertIn("interval '15 minutes'", self.monitor)
        self.assertIn("interval '8 days'", self.monitor)
        self.assertIn("p_report_type <> 'weekly'", self.monitor)

    def test_no_forced_resend_or_duplicate_overlap(self):
        for source in (self.monitor, self.recovery):
            self.assertNotRegex(source, r"'force'\s*,\s*true")
            self.assertIn("'force',false", source)
        self.assertIn('pg_advisory_xact_lock', self.monitor)
        self.assertIn("d.status = 'sent'", self.monitor)
        self.assertIn("status = 'queued'", self.monitor)

    def test_missing_responses_do_not_count_as_success(self):
        self.assertIn("set status = 'unknown'", self.isolation)
        self.assertIn("interval '5 minutes'", self.isolation)
        self.assertIn("q.status in ('queued','unknown')", self.isolation)
        self.assertIn("v_body -> 'ok' is distinct from 'true'::jsonb", self.monitor)

    def test_transport_log_does_not_retain_full_report(self):
        allowlist = self.monitor.split('where key in (', 1)[1].split(');', 1)[0]
        for forbidden in ("'summary'", "'recipients'", "'deliveries'", "'headers'", "'body'"):
            self.assertNotIn(forbidden, allowlist)
        self.assertNotIn('decrypted_secret', self.foundation.split('create table')[1].split(');')[0])
        self.assertIn('[redacted-email]', self.monitor)
        self.assertIn('[redacted-token]', self.monitor)

    def test_privileged_helpers_are_not_public(self):
        self.assertIn('enable row level security', self.foundation)
        self.assertIn('from public, anon, authenticated', self.foundation)
        self.assertIn('from public,anon,authenticated', self.monitor)
        self.assertIn('to service_role', self.monitor)
        self.assertIn('set search_path = pg_catalog, public, pg_temp', self.monitor)

    def test_failed_retry_cannot_erase_original_outcome(self):
        capture = self.isolation.index('update public.ag_record_email_requests q')
        guarded = self.isolation.index('-- A recovery enqueue failure')
        handler = self.isolation.index('exception when others then')
        self.assertLess(capture, guarded)
        self.assertLess(guarded, handler)
        self.assertIn("'recovery_enqueue_failed',true", self.isolation)
        self.assertNotIn('SQLERRM', self.isolation)

    def test_operational_data_and_subscriptions_not_mutated(self):
        combined = '\n'.join((self.foundation,self.monitor,self.isolation,self.recovery))
        for table in ('collections','ag_process_records','ag_user_profiles','ag_aggregator_memberships','ag_daily_record_email_deliveries'):
            self.assertNotRegex(combined, rf'(?i)\b(update|delete\s+from|alter\s+table|insert\s+into)\s+public\.{table}\b')

if __name__ == '__main__':
    unittest.main(verbosity=2)
