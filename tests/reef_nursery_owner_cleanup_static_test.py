import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CLEANUP = (ROOT / "assets/js/reef_nursery_cleanup.js").read_text(encoding="utf-8")
BOOT = (ROOT / "assets/js/reef_nursery_boot.js").read_text(encoding="utf-8")
SERVICE_WORKER = (ROOT / "service-worker.js").read_text(encoding="utf-8")
MIGRATION = (
    ROOT / "supabase/migrations/20260903195000_reef_nursery_owner_cleanup.sql"
).read_text(encoding="utf-8")


class ReefNurseryOwnerCleanupStaticTest(unittest.TestCase):
    def test_previous_records_clutter_is_hidden(self):
        for element_id in (
            "reefUnifiedRecordsAccessHelp",
            "reefUnifiedManageAccounts",
            "reefUnifiedRecordsRefresh",
            "reefUnifiedAccountNote",
        ):
            self.assertIn(f'hideElement("{element_id}")', CLEANUP)
        self.assertIn(".reef-unified-heading-actions", CLEANUP)

    def test_delete_is_protected_owner_soft_delete_only(self):
        self.assertIn("profile.is_protected_owner", MIGRATION)
        self.assertIn("'can_delete_records', v_can_delete_records", MIGRATION)
        self.assertIn("ag_reef_records_workspace_delete", MIGRATION)
        for table in (
            "public.ag_reef_nursery_sessions",
            "public.ag_reef_seaweed_records",
            "public.ag_reef_inspection_records",
        ):
            self.assertIn(f"update {table}", MIGRATION.lower())
        self.assertIn("deleted_at = v_deleted_at", MIGRATION)
        self.assertIn("deleted_by_user_id = v_actor_id", MIGRATION)
        self.assertNotIn("delete from", MIGRATION.lower())
        self.assertNotIn("truncate ", MIGRATION.lower())
        self.assertIn(
            "grant execute on function public.ag_reef_records_workspace_delete(text, uuid) to authenticated",
            MIGRATION.lower(),
        )
        self.assertNotIn(
            "grant execute on function public.ag_reef_records_workspace_delete(text, uuid) to anon",
            MIGRATION.lower(),
        )

    def test_owner_delete_buttons_cover_only_active_record_types(self):
        self.assertIn('new Set(["training", "seaweed", "inspection"])', CLEANUP)
        self.assertIn("data-delete-unified-record", CLEANUP)
        self.assertIn('textContent = "Delete"', CLEANUP)
        self.assertIn('textContent = `Delete ${target.number}?`', CLEANUP)
        self.assertIn("ag_reef_records_workspace_delete", CLEANUP)

    def test_clear_is_replaced_with_new_record(self):
        for button_id in (
            "newReefNursery",
            "newReefSeaweed",
            "newReefInspection",
        ):
            self.assertIn(button_id, CLEANUP)
        self.assertIn('button.textContent = "New record"', CLEANUP)
        self.assertIn("reef-original-clear-action", CLEANUP)
        self.assertIn("original.click()", CLEANUP)

    def test_unsaved_prompt_has_three_clear_choices(self):
        for label in (
            "Save and start new",
            "Discard and start new",
            "Cancel",
        ):
            self.assertIn(label, CLEANUP)
        self.assertIn("This record has unsaved changes.", CLEANUP)
        self.assertIn("beginSaveThenNew(type)", CLEANUP)
        self.assertIn("save.click()", CLEANUP)
        self.assertIn("resetToNewRecord(type)", CLEANUP)

    def test_cleanup_runtime_is_registered_and_cached(self):
        self.assertIn('import("./reef_nursery_cleanup.js?v=1")', BOOT)
        self.assertIn('"./assets/js/reef_nursery_cleanup.js"', SERVICE_WORKER)
        self.assertIn("seaweed-harvest-collection-v134", SERVICE_WORKER)

    def test_contract_is_explicit(self):
        for token in (
            "previousRecordsHelpRemoved: true",
            "previousRecordsRefreshRemoved: true",
            "protectedOwnerSoftDelete: true",
            "clearReplacedWithNewRecord: true",
        ):
            self.assertIn(token, CLEANUP)


if __name__ == "__main__":
    unittest.main()
