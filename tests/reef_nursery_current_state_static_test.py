import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CURRENT_STATE = (ROOT / "assets/js/reef_nursery_current_state.js").read_text(encoding="utf-8")
BOOT = (ROOT / "assets/js/reef_nursery_boot.js").read_text(encoding="utf-8")
DOM_GUARD = (ROOT / "assets/js/reef_nursery_training_dom_guard.js").read_text(encoding="utf-8")
RPC_GUARD = (ROOT / "assets/js/reef_nursery_training_rpc_guard.js").read_text(encoding="utf-8")
MIGRATION_FILES = [
    ROOT / "supabase/migrations/20260903173000_reef_nursery_locations_and_draft_schema.sql",
    ROOT / "supabase/migrations/20260903173100_reef_nursery_training_draft_validator.sql",
    ROOT / "supabase/migrations/20260903173110_reef_nursery_record_validators.sql",
    ROOT / "supabase/migrations/20260903173120_reef_nursery_inspection_draft_validator.sql",
    ROOT / "supabase/migrations/20260903173200_reef_nursery_training_save.sql",
    ROOT / "supabase/migrations/20260903173300_reef_nursery_record_saves.sql",
    ROOT / "supabase/migrations/20260903173400_reef_nursery_record_submits.sql",
    ROOT / "supabase/migrations/20260903173500_reef_nursery_record_state_and_grants.sql",
]
MIGRATION = "\n".join(path.read_text(encoding="utf-8") for path in MIGRATION_FILES)
SERVICE_WORKER = (ROOT / "service-worker.js").read_text(encoding="utf-8")


class ReefNurseryCurrentStateContractTest(unittest.TestCase):
    def test_four_locations_are_shared_in_required_order(self):
        locations = [
            ("tumbe_shore", "Tumbe - Shore / Farm"),
            ("tumbe_offshore", "Tumbe - Offshore Nursery"),
            ("mkwiro_shore", "Mkwiro - Shore / Farm"),
            ("mkwiro_offshore", "Mkwiro - Offshore Nursery"),
        ]
        positions = []
        for value, label in locations:
            token = f'["{value}", "{label}"]'
            self.assertIn(token, CURRENT_STATE)
            positions.append(CURRENT_STATE.index(token))
            self.assertIn(f"'{value}'", MIGRATION)
        self.assertEqual(positions, sorted(positions))

    def test_current_state_actions_cover_all_three_record_types(self):
        for form_id in ("reefNurseryForm", "reefSeaweedForm", "reefInspectionForm"):
            self.assertIn(form_id, CURRENT_STATE)
        for label in ("Save", "Submit and start new", "Clear"):
            self.assertIn(f'"{label}"', CURRENT_STATE)
        for rpc in (
            "ag_reef_training_workspace_save",
            "ag_reef_seaweed_workspace_save",
            "ag_reef_inspection_workspace_save",
            "ag_reef_seaweed_workspace_submit_current",
            "ag_reef_inspection_workspace_submit_current",
        ):
            self.assertIn(rpc, CURRENT_STATE)
            self.assertIn(f"public.{rpc}", MIGRATION)

    def test_public_and_authenticated_execute_grants_are_present(self):
        for rpc in (
            "ag_reef_training_workspace_save",
            "ag_reef_seaweed_workspace_save",
            "ag_reef_inspection_workspace_save",
            "ag_reef_seaweed_workspace_submit_current",
            "ag_reef_inspection_workspace_submit_current",
            "ag_reef_workspace_record_state",
            "ag_reef_records_workspace_records_v2",
        ):
            start = MIGRATION.index(f"grant execute on function public.{rpc}")
            grant = MIGRATION[start : start + 300]
            self.assertIn("to anon, authenticated", grant)

    def test_gender_defaults_to_no_entry_and_preserves_legacy_rows(self):
        visible = [
            '["", "No Entry"]',
            '["male", "Male"]',
            '["female", "Female"]',
        ]
        positions = [CURRENT_STATE.index(token) for token in visible]
        self.assertEqual(positions, sorted(positions))
        for legacy in ("other", "prefer_not_to_say"):
            self.assertIn(f'["{legacy}",', CURRENT_STATE)
            self.assertIn(f"'{legacy}'", MIGRATION)

    def test_legacy_locations_remain_compatible(self):
        for legacy in ("mkwiro", "offshore_nursery", "shoreline_preparation"):
            self.assertIn(f'["{legacy}",', CURRENT_STATE)
            self.assertIn(f"'{legacy}'", MIGRATION)
        self.assertNotIn("update public.ag_reef_nursery_sessions\nset location", MIGRATION.lower())

    def test_drafts_do_not_reset_public_edit_deadline(self):
        self.assertIn("v_saved.created_at + interval '168 hours'", MIGRATION)
        self.assertNotIn("set created_at", MIGRATION.lower())
        self.assertIn("submitted_at = null", MIGRATION.lower())

    def test_seaweed_draft_photo_stays_local_until_submit(self):
        self.assertIn("indexedDB.open", CURRENT_STATE)
        self.assertIn("saveSeaweedDraftPhotoLocal", CURRENT_STATE)
        self.assertIn("loadSeaweedDraftPhotoLocal", CURRENT_STATE)
        self.assertIn("persistSeaweedPhoto(savedId", CURRENT_STATE)
        save_start = CURRENT_STATE.index("async function saveSeaweedCurrentState")
        submit_start = CURRENT_STATE.index("async function submitSeaweedAndStartNew")
        save_body = CURRENT_STATE[save_start:submit_start]
        self.assertNotIn("persistSeaweedPhoto", save_body)
        self.assertIn("saveSeaweedDraftPhotoLocal", save_body)

    def test_boot_and_cache_include_current_state_module(self):
        self.assertIn('import("./reef_nursery_current_state.js?v=1")', BOOT)
        self.assertIn('"./assets/js/reef_nursery_current_state.js"', SERVICE_WORKER)
        self.assertIn('seaweed-harvest-collection-v129', SERVICE_WORKER)
        self.assertIn("saveCurrentStateAvailable: true", DOM_GUARD)
        self.assertIn('save: "ag_reef_training_workspace_save"', RPC_GUARD)

    def test_no_delete_or_production_data_rewrite_is_added(self):
        lowered = MIGRATION.lower()
        self.assertNotIn("delete from public.ag_reef", lowered)
        self.assertNotIn("truncate ", lowered)
        self.assertNotIn("drop table", lowered)
        self.assertNotIn("drop function", lowered)
        self.assertNotIn("record_status is distinct from 'submitted'", lowered)


if __name__ == "__main__":
    unittest.main()
