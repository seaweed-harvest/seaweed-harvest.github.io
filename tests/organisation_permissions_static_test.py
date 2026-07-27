import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class OrganisationPermissionsStaticTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = (
            ROOT / "supabase/migrations/20260727120000_organisation_permissions.sql"
        ).read_text(encoding="utf-8")
        cls.page = (ROOT / "admin_users.html").read_text(encoding="utf-8")
        cls.users = (ROOT / "assets/js/users_page.js").read_text(encoding="utf-8")
        cls.navigation = (ROOT / "assets/js/app_navigation.js").read_text(encoding="utf-8")
        cls.auth = (ROOT / "assets/js/auth_client.js").read_text(encoding="utf-8")
        cls.records = (ROOT / "assets/js/records_page.js").read_text(encoding="utf-8")

    def test_cosme_defaults_to_reef_and_dryer_only(self):
        cosme = self.migration.split("when 'COSME'", 1)[1].split(
            "when 'SANDBOX'", 1
        )[0]
        for capability in (
            "form_site_water_samples",
            "form_intake_collection",
            "form_stock_record",
            "form_process_record",
        ):
            self.assertIn(f"'{capability}', false", cosme)
        self.assertIn("'form_reef_nursery', true", cosme)
        self.assertIn("'form_dryer_table', true", cosme)

    def test_permissions_page_has_organisation_and_user_tabs(self):
        self.assertIn(">Organisation</button>", self.page)
        self.assertIn(">Users</button>", self.page)
        self.assertIn('id="organisationFormPermissions"', self.page)
        self.assertIn('id="organisationToolPermissions"', self.page)
        self.assertIn("ag_admin_organisation_permissions", self.users)
        self.assertIn("ag_admin_save_organisation_permissions", self.users)
        self.assertIn("QR code tags", self.users)
        self.assertIn("Text messaging", self.users)

    def test_navigation_filters_forms_records_and_tools(self):
        for capability in (
            "form_site_water_samples",
            "form_intake_collection",
            "form_stock_record",
            "form_process_record",
            "form_reef_nursery",
            "form_dryer_table",
            "tool_qr_tags",
            "tool_sms",
        ):
            self.assertIn(f'capability: "{capability}"', self.navigation)
        self.assertIn('label: "Organisations"', self.navigation)
        self.assertIn('label: "Permissions"', self.navigation)
        self.assertIn("CATEGORY_CAPABILITIES", self.records)

    def test_browser_and_database_guards_share_capability_names(self):
        self.assertIn("requireOrganisationCapability", self.auth)
        self.assertIn("ag_require_organisation_capability", self.migration)
        for function_name in (
            "ag_submit_collection_v2",
            "ag_submit_site_water_sample_record_v4",
            "ag_submit_stabilization_packing_record_v3",
            "ag_submit_process_record",
            "ag_form_record_ledger",
            "ag_form_record_summary",
        ):
            self.assertIn(f"create function public.{function_name}", self.migration)
        self.assertIn("organisation_capabilities", self.migration)
        self.assertIn("organisation_capabilities", self.auth)


if __name__ == "__main__":
    unittest.main()
