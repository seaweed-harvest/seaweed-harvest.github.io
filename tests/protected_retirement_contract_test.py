"""Deterministic handover checks, with no live data or credentials."""

from pathlib import Path
import json
import unittest


ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class ProtectedRetirementContractTest(unittest.TestCase):
    def test_green_space_application_is_not_publicly_linked(self):
        self.assertFalse(any(path.is_file() for path in (ROOT / "green-space").rglob("*")))
        nav = read("assets/js/app_navigation.js")
        auth = read("assets/js/auth_client.js")
        login = read("assets/js/login_page.js")
        self.assertNotIn("green-space/", nav)
        self.assertNotIn('label: "Green Space Log"', nav)
        self.assertNotIn("green-space/ledger.html", auth)
        self.assertNotIn("green-space/ledger.html", login)

    def test_no_green_space_role_or_capability_in_admin_ui(self):
        users = read("assets/js/users_page.js")
        page = read("admin_users.html")
        for token in ("green_space_teacher", "form_green_space", "can_manage_green_space"):
            self.assertNotIn(token, users)
        self.assertNotIn('value="green_space_teacher"', page)
        self.assertNotIn('value="BATI"', page)
        self.assertIn('value="SANDBOX"> Sandbox', page)

    def test_benched_experiments_are_absent_from_user_settings(self):
        users = read("assets/js/users_page.js")
        permissions = users.split("const permissionDefinitions = [", 1)[1].split("];", 1)[0]
        tools = users.split("const organisationCapabilityDefinitions = {", 1)[1].split("const state =", 1)[0]
        for key in ("can_view_notifications", "can_manage_notifications", "can_manage_sms_settings"):
            self.assertNotIn(key, permissions)
        for key in ("tool_qr_tags", "tool_sms", "tool_form_builder", "tool_notifications"):
            self.assertNotIn(key, tools)
        self.assertIn('"tool_pricing"', tools)

    def test_farmer_preferences_offer_email_but_not_sms(self):
        html = read("my_details.html")
        controller = read("assets/js/my_details_page.js")
        self.assertIn('<option value="email">Email</option>', html)
        for token in ('<option value="sms">', '<option value="both">', 'id="myReceiptPhone"', 'id="myReceiptNotifications"'):
            self.assertNotIn(token, html)
        self.assertIn('p_receipt_email: els.myReceiptEmail.value.trim() || null', controller)
        self.assertIn('p_receipt_phone: storedReceiptPhone', controller)
        self.assertIn('p_allow_transaction_notifications: storedTransactionNotifications', controller)

    def test_login_fallback_never_opens_benched_tools(self):
        auth = read("assets/js/auth_client.js")
        routing = auth.split("export function routeForProfile(profile)", 1)[1].split("function currentPage()", 1)[0]
        for retired in ("./admin_builder.html", "./admin_notifications.html", "./admin_seaweedke.html"):
            self.assertNotIn(retired, routing)
        self.assertIn('return "./my_details.html";', routing)

    def test_bati_farming_community_and_sandbox_ledger_are_retained(self):
        self.assertIn('Bati (Table 1)', read("dryer_table.html"))
        self.assertIn("historical_records.html", read("assets/js/app_navigation.js"))
        self.assertTrue((ROOT / "assets/js/historical_records_page.js").exists())
        self.assertIn("ag_historical_ledger_rows", read("scripts/retire_bati_organisation_and_green_space.sql"))

    def test_sql_is_read_only_post_retirement_verification(self):
        sql = read("scripts/retire_bati_organisation_and_green_space.sql")
        self.assertIn("59f5db4c-c85f-4a49-ae4e-11232e95ac02", sql)
        self.assertIn("aggregator_code = 'BATI'", sql)
        self.assertIn("green_storage_bucket_absent", sql)
        self.assertIn("sandbox_historical_ledger_preserved", sql)
        self.assertIn("mawimbi_collections_preserved", sql)
        self.assertIn("mawimbi_receipts_preserved", sql)
        self.assertIn("shared_communities_preserved", sql)
        self.assertIn("shared_farmers_preserved", sql)
        for forbidden in (
            "delete from", "update public.", "truncate ", "drop table",
            "commit;", "delete from storage.objects",
        ):
            self.assertNotIn(forbidden, sql.lower())

    def test_feedback_and_app_routing_are_retired(self):
        app_map = json.loads(read(".automation/app-map.yml"))
        harvest = app_map["targets"]["seaweed-harvest"]
        self.assertEqual(harvest["source_app_values"], ["aggregation"])
        self.assertNotIn("green_space", harvest["applications"])
        feedback = read("supabase/functions/site-feedback/index.ts")
        self.assertIn('["aggregation", "tide"]', feedback)
        self.assertNotIn('"green_space"', feedback)


if __name__ == "__main__":
    unittest.main()
