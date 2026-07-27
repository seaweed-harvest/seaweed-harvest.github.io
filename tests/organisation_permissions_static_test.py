import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class OrganisationPermissionsStaticTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migration = (
            ROOT / "supabase/migrations/20260727120000_organisation_permissions.sql"
        ).read_text(encoding="utf-8")
        cls.scoping_migration = (
            ROOT
            / "supabase/migrations/20260727150000_multi_organisation_permission_controls.sql"
        ).read_text(encoding="utf-8")
        cls.user_form_access_migration = (
            ROOT
            / "supabase/migrations/20260727160000_user_organisation_form_access.sql"
        ).read_text(encoding="utf-8")
        cls.page = (ROOT / "admin_users.html").read_text(encoding="utf-8")
        cls.users = (ROOT / "assets/js/users_page.js").read_text(encoding="utf-8")
        cls.navigation = (ROOT / "assets/js/app_navigation.js").read_text(encoding="utf-8")
        cls.auth = (ROOT / "assets/js/auth_client.js").read_text(encoding="utf-8")
        cls.records = (ROOT / "assets/js/records_page.js").read_text(encoding="utf-8")
        cls.shared_css = (ROOT / "assets/css/ag.css").read_text(encoding="utf-8")
        cls.permissions_css = (
            ROOT / "assets/css/permissions.css"
        ).read_text(encoding="utf-8")

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
        self.assertIn('id="organisationPermissionsSelect"', self.page)
        self.assertNotIn("A form and its records are one permission", self.page)

    def test_navigation_filters_forms_records_and_tools(self):
        for capability in (
            "form_site_water_samples",
            "form_intake_collection",
            "form_stock_record",
            "form_process_record",
            "form_reef_nursery",
            "form_dryer_table",
            "form_green_space",
            "tool_qr_tags",
            "tool_sms",
        ):
            self.assertIn(f'capability: "{capability}"', self.navigation)
        self.assertIn('label: "Organisations"', self.navigation)
        self.assertIn('label: "Permissions"', self.navigation)
        self.assertIn("CATEGORY_CAPABILITIES", self.records)
        self.assertIn('label: "Green Space Log"', self.navigation)

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

    def test_multi_organisation_permission_is_explicit_and_scoped(self):
        self.assertIn(
            "can_manage_organisation_permissions",
            self.scoping_migration,
        )
        self.assertIn(
            "ag_admin_organisation_permission_options",
            self.scoping_migration,
        )
        self.assertIn(
            "count(*)\n        from public.ag_organisation_permission_scope",
            self.scoping_migration,
        )
        self.assertIn(
            "Manage organisation permissions",
            self.users,
        )
        self.assertIn(
            "state.organisationPermissionAccess?.can_access",
            self.users,
        )

    def test_user_form_access_is_per_organisation_and_secure(self):
        migration = self.user_form_access_migration
        self.assertIn("add column if not exists form_access jsonb", migration)
        self.assertIn("form_access is null", migration)
        self.assertIn("ag_effective_organisation_capabilities", migration)
        self.assertIn("v_form_access is null", migration)
        self.assertIn(
            "public.ag_effective_organisation_capabilities(\n"
            "    v_organisation_id,\n"
            "    (select auth.uid())",
            migration,
        )
        self.assertIn("ag_admin_user_form_access", migration)
        self.assertIn("to service_role", migration)
        self.assertIn('id="inviteFormAccess"', self.page)
        self.assertIn('id="editFormAccess"', self.page)
        self.assertIn("organisation_form_access: readUserFormAccess", self.users)
        self.assertIn("ag_admin_user_form_access", self.users)
        self.assertIn("form_access: organisationFormAccess", self.admin_users)
        self.assertIn("ag_effective_organisation_capabilities", self.admin_users)
        self.assertIn(
            "You cannot grant form access you do not have",
            self.admin_users,
        )

    def test_sandbox_defaults_to_green_space_only(self):
        sandbox = self.scoping_migration.split("when 'SANDBOX'", 1)[1].split(
            "else jsonb_build_object", 1
        )[0]
        self.assertIn("'form_green_space', true", sandbox)
        for capability in (
            "form_site_water_samples",
            "form_intake_collection",
            "form_stock_record",
            "form_process_record",
            "form_reef_nursery",
            "form_dryer_table",
        ):
            self.assertIn(f"'{capability}', false", sandbox)

    def test_shared_spacing_and_type_tokens_drive_permissions_layout(self):
        for token in (
            "--layout-gap",
            "--page-section-padding",
            "--panel-padding",
            "--form-field-gap",
            "--label-font-size",
            "--section-font-size",
            "--supporting-font-size",
        ):
            self.assertIn(token, self.shared_css)
        for token in (
            "--layout-gap",
            "--panel-padding",
            "--label-font-size",
            "--section-font-size",
            "--supporting-font-size",
        ):
            self.assertIn(f"var({token})", self.permissions_css)
        self.assertIn("--page-section-padding: 12px", self.shared_css)
        self.assertIn("--panel-padding: 14px", self.shared_css)
        self.assertIn(".permission-workspace > .panel", self.permissions_css)


if __name__ == "__main__":
    unittest.main()
