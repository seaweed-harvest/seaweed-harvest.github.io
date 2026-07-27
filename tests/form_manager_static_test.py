import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(relative):
    return (ROOT / relative).read_text(encoding="utf-8")


class FormManagerStaticTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = read("admin_forms.html")
        cls.script = read("assets/js/form_manager_page.js")
        cls.navigation = read("assets/js/app_navigation.js")
        cls.admin = read("assets/js/admin_page.js")
        cls.migration = read(
            "supabase/migrations/20260727170000_form_manager_and_sharing.sql"
        )
        cls.collection_edge = read(
            "supabase/functions/public-collection/index.ts"
        )
        cls.photo_edge = read(
            "supabase/functions/public-collection-photo/index.ts"
        )
        cls.green_edge = read(
            "supabase/functions/green-space-log/index.ts"
        )

    def test_manager_is_a_separate_tools_page(self):
        self.assertIn("<h2>Form Manager</h2>", self.page)
        self.assertIn('label: "Form Manager"', self.navigation)
        self.assertIn('label: "Form Builder"', self.navigation)
        self.assertIn('"admin_forms.html": "can_manage_settings"', self.admin)
        self.assertIn('"admin_forms.html": "tool_form_builder"', self.admin)

    def test_ui_separates_entry_access_from_private_records(self):
        self.assertIn("<strong>Entry</strong>", self.page)
        self.assertIn("<strong>Records</strong> stay private", self.page)
        self.assertIn('["link", "Anyone with link"]', self.script)
        self.assertIn('["review", "Review link"]', self.script)
        self.assertIn('["paused", "Paused"]', self.script)
        self.assertIn('recordsValue.textContent = "Private"', self.script)

    def test_database_owns_access_modes_and_revocable_links(self):
        for table in (
            "ag_form_access_settings",
            "ag_form_share_links",
            "ag_shared_form_submissions",
            "ag_form_share_rate_limits",
        ):
            self.assertIn(f"create table if not exists public.{table}", self.migration)
        for function in (
            "ag_admin_form_manager",
            "ag_admin_save_form_access",
            "ag_admin_regenerate_form_share_link",
            "ag_public_form_entry_context",
            "ag_public_shared_form_submission",
        ):
            self.assertIn(f"function public.{function}", self.migration)
        self.assertIn("where active;", self.migration)
        self.assertIn("records_private", self.migration)

    def test_public_writes_recheck_form_access_on_server(self):
        self.assertIn("requirePublicCollectionEntry", self.collection_edge)
        self.assertIn("ag_public_form_entry_context", self.collection_edge)
        self.assertIn("requirePublicCollectionEntry", self.photo_edge)
        self.assertIn("ag_public_form_entry_context", self.photo_edge)
        self.assertIn("requireGreenSpaceEntry", self.green_edge)
        self.assertIn("ag_public_form_entry_context", self.green_edge)

    def test_reef_review_submissions_are_isolated(self):
        reef = read("assets/js/reef_nursery_form.js")
        page = read("reef_nursery.html")
        self.assertIn("Review copy", page)
        self.assertIn("ag_public_shared_form_submission", reef)
        self.assertIn("It will not change COSME operational records.", page)
        self.assertIn("Test submission", reef)


if __name__ == "__main__":
    unittest.main()
