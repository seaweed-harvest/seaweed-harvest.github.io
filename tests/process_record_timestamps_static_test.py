import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


class ProcessRecordTimestampsStaticTest(unittest.TestCase):
    def setUp(self):
        self.page = read("process_record.html")
        self.script = read("assets/js/process_record_form.js")
        self.migration = read(
            "supabase/migrations/20260803120000_process_record_full_timestamps.sql"
        )

    def test_form_collects_complete_start_and_finish_timestamps(self):
        for element_id in (
            "processDate",
            "processStartTime",
            "processFinishDate",
            "processEndTime",
        ):
            self.assertIn(f'id="{element_id}"', self.page)
        self.assertIn("start_date: els.processDate.value", self.script)
        self.assertIn("start_time: els.processStartTime.value", self.script)
        self.assertIn("finish_date: els.processFinishDate.value", self.script)
        self.assertIn("finish_time: els.processEndTime.value", self.script)

    def test_overnight_sessions_are_validated_as_timestamps(self):
        self.assertIn("processTimestampRange", self.script)
        self.assertIn("defaultFinishDate", self.script)
        self.assertIn("finished_at > started_at", self.migration)
        self.assertIn("v_finish_date + v_finish_time", self.migration)
        self.assertIn(
            "Finish date and time must be later than the start date and time.",
            self.migration,
        )

    def test_submission_rpc_keeps_legacy_columns_compatible(self):
        self.assertIn("create or replace function public.ag_submit_process_record", self.migration)
        self.assertIn("ag_submit_process_record_without_organisation_access", self.migration)
        self.assertIn("'started_at', v_started_at", self.migration)
        self.assertIn("'finished_at', v_finished_at", self.migration)
        self.assertIn("to authenticated", self.migration)


if __name__ == "__main__":
    unittest.main()
