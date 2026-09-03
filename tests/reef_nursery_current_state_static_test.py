import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HTML = (ROOT / "reef_nursery.html").read_text(encoding="utf-8")
BOOT = (ROOT / "assets/js/reef_nursery_boot.js").read_text(encoding="utf-8")
DOM_GUARD = (ROOT / "assets/js/reef_nursery_training_dom_guard.js").read_text(encoding="utf-8")
RPC_GUARD = (ROOT / "assets/js/reef_nursery_training_rpc_guard.js").read_text(encoding="utf-8")
ENTRY_BRIDGE = (ROOT / "assets/js/reef_nursery_training_entry_bridge.js").read_text(encoding="utf-8")
SERVICE_WORKER = (ROOT / "service-worker.js").read_text(encoding="utf-8")
MIGRATION = (
    ROOT / "supabase/migrations/20260903183000_reef_training_public_photos.sql"
).read_text(encoding="utf-8")


class ReefNurseryTrainingEntryContractTest(unittest.TestCase):
    def test_heavy_current_state_wrapper_is_not_loaded(self):
        self.assertNotIn("reef_nursery_current_state", BOOT)
        self.assertNotIn('"./assets/js/reef_nursery_current_state.js"', SERVICE_WORKER)

    def test_four_locations_are_shared_in_required_order(self):
        locations = [
            '["tumbe_shore", "Tumbe - Shore / Farm"]',
            '["tumbe_offshore", "Tumbe - Offshore Nursery Site"]',
            '["mkwiro_shore", "Mkwiro - Shore / Farm"]',
            '["mkwiro_offshore", "Mkwiro - Offshore Nursery Site"]',
        ]
        positions = [DOM_GUARD.index(token) for token in locations]
        self.assertEqual(positions, sorted(positions))
        for select_id in ("reefLocation", "reefSeaweedLocation", "reefInspectionLocation"):
            self.assertIn(select_id, DOM_GUARD)

    def test_gender_is_no_entry_male_or_female(self):
        visible = [
            '["", "No Entry"]',
            '["male", "Male"]',
            '["female", "Female"]',
        ]
        positions = [DOM_GUARD.index(token) for token in visible]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('option.hidden = value !== current', DOM_GUARD)

    def test_all_action_rows_are_save_submit_clear(self):
        for label in ("Save", "Submit and start new", "Clear"):
            self.assertIn(f'"{label}"', DOM_GUARD)
        self.assertIn("row.insertBefore(save, submit)", DOM_GUARD)
        self.assertIn("row.insertBefore(submit, clear)", DOM_GUARD)
        self.assertIn("consistentActionOrder: true", DOM_GUARD)

    def test_save_allows_missing_times_and_stays_in_place(self):
        self.assertIn('rpc("ag_reef_training_workspace_save"', ENTRY_BRIDGE)
        self.assertIn("saveAllowsIncompleteTimes: true", ENTRY_BRIDGE)
        self.assertIn("history.replaceState", ENTRY_BRIDGE)
        self.assertIn("savePreservesPlace: true", ENTRY_BRIDGE)
        self.assertNotIn("window.location.assign", ENTRY_BRIDGE)
        save_start = ENTRY_BRIDGE.index("async function saveTrainingInPlace")
        submit_start = ENTRY_BRIDGE.index("async function submitTrainingAndStartNew")
        save_body = ENTRY_BRIDGE[save_start:submit_start]
        self.assertNotIn("showValidationError", save_body)

    def test_legacy_authenticated_save_also_uses_draft_rpc(self):
        self.assertIn('save: "ag_reef_training_workspace_save"', RPC_GUARD)
        self.assertIn("workspaceSaveArgs(args)", RPC_GUARD)
        self.assertIn("saveUsesDraftRpc: true", RPC_GUARD)
        self.assertNotIn('ag_save_reef_nursery_draft_v3: "workspace-submit-or-update"', RPC_GUARD)

    def test_submit_still_requires_completion_fields(self):
        for message in (
            "Training date is required before submission.",
            "Start time is required before submission.",
            "Finish time is required before submission.",
            "Select at least one type of session before submission.",
            "Add at least one participant before submission.",
        ):
            self.assertIn(message, ENTRY_BRIDGE)

    def test_training_photos_work_for_public_and_authenticated_entry(self):
        self.assertIn('PHOTO_BUCKET = "reef-nursery-photos"', ENTRY_BRIDGE)
        self.assertIn("ag_reef_training_workspace_attach_photo", ENTRY_BRIDGE)
        self.assertIn("ag_reef_training_workspace_photos", ENTRY_BRIDGE)
        self.assertIn("publicAndAuthenticatedPhotos: true", ENTRY_BRIDGE)
        self.assertNotIn("Sign in again before uploading Training photos", ENTRY_BRIDGE)
        for policy in (
            'create policy "reef nursery workspace photo insert"',
            'create policy "reef nursery workspace photo read"',
            'create policy "reef nursery workspace photo cleanup"',
        ):
            self.assertIn(policy, MIGRATION)
        self.assertGreaterEqual(MIGRATION.count("to anon, authenticated"), 5)
        self.assertNotIn("update storage.buckets", MIGRATION.lower())

    def test_photo_boundary_remains_private_and_bounded(self):
        self.assertIn("p_byte_size not between 1 and 1048576", MIGRATION)
        self.assertIn("Only 8 Training photos can be attached.", MIGRATION)
        self.assertIn("lower(storage.extension(name)) = 'jpg'", MIGRATION)
        self.assertIn("created_at + interval '168 hours'", MIGRATION)
        self.assertIn("not exists (", MIGRATION)

    def test_html_boot_and_cache_are_explicitly_advanced(self):
        self.assertIn('reef_nursery_training_entry_bridge.js?v=2', HTML)
        self.assertIn('reef_nursery_boot.js?v=4', HTML)
        self.assertIn('reef_nursery_training_rpc_guard.js?v=4', BOOT)
        self.assertIn('reef_nursery_training_dom_guard.js?v=7', BOOT)
        self.assertIn('reef_nursery_training_entry_bridge.js?v=2', BOOT)
        self.assertIn('reef_nursery_training_public.js?v=4', BOOT)
        self.assertIn('"./assets/js/reef_nursery_training_entry_bridge.js"', SERVICE_WORKER)
        self.assertIn("seaweed-harvest-collection-v134", SERVICE_WORKER)

    def test_migration_does_not_rewrite_operational_records(self):
        lowered = MIGRATION.lower()
        self.assertNotIn("delete from public.ag_reef", lowered)
        self.assertNotIn("truncate ", lowered)
        self.assertNotIn("drop table", lowered)
        self.assertNotIn("update public.ag_reef_nursery_sessions", lowered)


if __name__ == "__main__":
    unittest.main()
