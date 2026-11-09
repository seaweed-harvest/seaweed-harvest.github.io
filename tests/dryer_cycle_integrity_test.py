import base64
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HELPER = ROOT / "assets/js/dryer_cycle_integrity.js"
FORM = ROOT / "assets/js/dryer_table_form.js"
SHELL = ROOT / "service-worker.js"
AUDIT = ROOT / "supabase/migrations/20261109210000_cosme_dryer_measurement_revisions.sql"
PAYMENT = ROOT / "supabase/migrations/20261109210500_cosme_dryer_payment_anomaly_guard.sql"


def run_cycles():
    encoded = base64.b64encode(HELPER.read_bytes()).decode("ascii")
    source = """
        const m = await import('data:text/javascript;base64,ENCODED');
        const start = '2026-10-26T13:00:00Z';
        const valid = {loading_at:start,unloading_at:'2026-10-29T13:00:00Z',loading_weight_kg:45,unloading_weight_kg:12};
        const cases = [
          valid,
          {...valid,unloading_at:start},
          {...valid,unloading_at:'2026-10-26T13:06:00Z'},
          {...valid,unloading_weight_kg:45},
          {...valid,unloading_weight_kg:46},
          {...valid,unloading_at:null,unloading_weight_kg:null},
          {...valid,loading_weight_kg:0},
          {...valid,loading_at:null,loading_weight_kg:null},
          {...valid,unloading_weight_kg:0}
        ];
        console.log(JSON.stringify(cases.map(c => m.dryingCycleIssue(c))));
    """.replace("ENCODED", encoded)
    result = subprocess.run(["node", "--input-type=module", "-e", source],
                            check=True, capture_output=True, text=True)
    return result.stdout.strip()


class DryerIntegrityTest(unittest.TestCase):
    def test_cycle_validation(self):
        import json
        self.assertEqual(json.loads(run_cycles()), [
            None, "time_order", "short_duration", "no_weight_loss",
            "no_weight_loss", None, "invalid_weight", "missing_loading", None,
        ])

    def test_form_validates_both_capture_and_finalization(self):
        content = FORM.read_text(encoding="utf-8")
        self.assertIn('from "./dryer_cycle_integrity.js?v=1"', content)
        self.assertIn("const issue = dryingCycleIssue(candidate);", content)
        self.assertIn("const issue = dryingCycleIssue(bay);", content)
        self.assertIn('state.pendingAction', content)  # Offline capture preserved.

    def test_future_edits_are_audited_without_secrets(self):
        sql = AUDIT.read_text(encoding="utf-8")
        for table in ("seaweed_drying_bay_records", "seaweed_drying_submissions",
                      "seaweed_drying_reweigh_events", "seaweed_drying_reweigh_bay_records"):
            self.assertIn(table, sql)
        self.assertIn("action in ('baseline','insert','update','delete')", sql)
        self.assertIn("after insert or update or delete", sql)
        self.assertIn("enable row level security", sql)
        self.assertIn("revoke all", sql)
        self.assertNotIn("'upload_token_hash'", sql)
        self.assertIn("deferrable initially deferred", sql)
        self.assertIn("unloading weight must be lower", sql)

    def test_payment_guard_is_at_approval_review_and_settlement(self):
        sql = PAYMENT.read_text(encoding="utf-8")
        self.assertIn("private.seaweed_drying_unverified_day_count", sql)
        for target in ("seaweed_drying_activity_day_decisions",
                       "seaweed_drying_payment_reviews",
                       "seaweed_drying_payment_activity_days"):
            self.assertIn(f"on public.{target}", sql)
        self.assertIn("'needs_confirmation'", sql)
        self.assertIn("before insert", sql)

    def test_offline_shell_includes_validation_module(self):
        shell = SHELL.read_text(encoding="utf-8")
        self.assertIn('"./assets/js/dryer_cycle_integrity.js"', shell)
        self.assertIn("v183-dryer-integrity", shell)


if __name__ == "__main__":
    unittest.main()
