import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
BOOT = (ROOT / "assets/js/reef_nursery_boot.js").read_text(encoding="utf-8")
DOM_GUARD = (ROOT / "assets/js/reef_nursery_training_dom_guard.js").read_text(encoding="utf-8")
RPC_GUARD = (ROOT / "assets/js/reef_nursery_training_rpc_guard.js").read_text(encoding="utf-8")
SERVICE_WORKER = (ROOT / "service-worker.js").read_text(encoding="utf-8")


class ReefNurserySimpleSaveContractTest(unittest.TestCase):
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

    def test_actions_use_existing_form_handlers(self):
        for label in ("Save", "Submit and start new", "Clear"):
            self.assertIn(f'"{label}"', DOM_GUARD)
        self.assertIn("form.requestSubmit()", DOM_GUARD)
        self.assertIn("document.getElementById(config.saveId)?.click()", DOM_GUARD)
        self.assertIn("document.getElementById(config.clearId)?.click()", DOM_GUARD)
        self.assertNotIn("ag_reef_seaweed_workspace_save", DOM_GUARD)
        self.assertNotIn("ag_reef_inspection_workspace_save", DOM_GUARD)

    def test_save_does_not_navigate_away(self):
        self.assertNotIn("window.location.assign", DOM_GUARD)
        self.assertIn("savePreservesTabAndScroll: true", DOM_GUARD)
        self.assertIn("window.scrollTo", DOM_GUARD)

    def test_authenticated_training_save_commits_not_drafts(self):
        self.assertNotIn('save: "ag_reef_training_workspace_save"', RPC_GUARD)
        self.assertIn("workspace-submit-or-update", RPC_GUARD)
        self.assertIn("WORKSPACE_RPCS.update", RPC_GUARD)
        self.assertIn("WORKSPACE_RPCS.submit", RPC_GUARD)

    def test_cache_is_advanced_for_the_option_contract(self):
        self.assertIn("seaweed-harvest-collection-v131", SERVICE_WORKER)
        self.assertIn('reef_nursery_training_dom_guard.js?v=5', BOOT)
        self.assertIn('reef_nursery_training_rpc_guard.js?v=3', BOOT)


if __name__ == "__main__":
    unittest.main()
