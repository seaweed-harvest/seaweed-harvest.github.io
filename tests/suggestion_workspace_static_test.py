import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SuggestionWorkspaceStaticTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "admin_suggestions.html").read_text(encoding="utf-8")
        cls.script = (ROOT / "assets/js/admin_suggestions.js").read_text(encoding="utf-8")
        cls.navigation = (ROOT / "assets/js/app_navigation.js").read_text(encoding="utf-8")
        cls.config = (ROOT / "assets/js/config.js").read_text(encoding="utf-8")
        cls.worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")
        cls.workspace_migration = (
            ROOT / "supabase/migrations/20260724100000_site_feedback_workspace.sql"
        ).read_text(encoding="utf-8")
        cls.automation_migration = (
            ROOT / "supabase/migrations/20260728120000_authenticated_suggestion_automation.sql"
        ).read_text(encoding="utf-8")
        cls.open_filter_migration = (
            ROOT / "supabase/migrations/20260724110000_site_feedback_open_filter.sql"
        ).read_text(encoding="utf-8")

    def test_owner_has_a_private_mobile_accessible_suggestion_workspace(self):
        self.assertIn('id="suggestionsList"', self.page)
        self.assertIn('id="suggestionPhotoDialog"', self.page)
        self.assertIn("profile?.is_protected_owner === true", self.navigation)
        self.assertNotIn("PROTECTED_OWNER_EMAIL", self.navigation)
        self.assertIn('label: "Suggestions"', self.navigation)
        self.assertIn("./admin_suggestions.html", self.navigation)
        self.assertIn('authClient.rpc("ag_owner_site_feedback"', self.script)
        self.assertIn('authClient.rpc("ag_owner_update_site_feedback"', self.script)
        self.assertIn("authClient.storage.from(PHOTO_BUCKET)", self.script)
        self.assertIn("data-delete-suggestion", self.script)
        self.assertIn('action: "delete"', self.script)
        self.assertIn('action: "approve_implementation"', self.script)
        self.assertIn('action: "retry_assessment"', self.script)
        self.assertIn("Retry AI review", self.script)
        self.assertIn('<option value="open" selected>Open suggestions</option>', self.page)
        self.assertIn("p_status text default 'open'", self.open_filter_migration)
        self.assertIn("feedback.status <> 'closed'", self.open_filter_migration)

    def test_feedback_photos_and_review_decisions_are_private(self):
        self.assertIn("'site-feedback-photos'", self.workspace_migration)
        self.assertIn(
            "'site-feedback-photos',\n  'site-feedback-photos',\n  false,",
            self.workspace_migration,
        )
        self.assertIn("review_decision", self.automation_migration)
        self.assertIn("ag_owner_site_feedback", self.automation_migration)
        self.assertIn("ag_owner_update_site_feedback", self.automation_migration)
        self.assertIn("bmichael@cascadiaseaweed.com", self.automation_migration)
        self.assertIn(
            "ag_is_current_user_trusted_product_owner()",
            self.automation_migration,
        )
        self.assertIn("implementation_approved_by", self.automation_migration)
        self.assertIn("to authenticated", self.automation_migration)
        self.assertNotIn("suggestion-type suggestion-type-", self.script)

    def test_cascadia_product_branding_is_not_in_the_current_interface(self):
        self.assertNotIn("site_branding", self.config)
        self.assertNotIn("site_branding", self.worker)
        self.assertNotIn("cascadia-seaweed-logo.png", self.worker)
        self.assertFalse((ROOT / "assets/js/site_branding.js").exists())
        self.assertFalse((ROOT / "assets/images/cascadia-seaweed-logo.png").exists())


if __name__ == "__main__":
    unittest.main()
