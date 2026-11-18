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

    def test_bati_farming_community_and_sandbox_ledger_are_retained(self):
        self.assertIn('Bati (Table 1)', read("dryer_table.html"))
        self.assertIn("historical_records.html", read("assets/js/app_navigation.js"))
        self.assertTrue((ROOT / "assets/js/historical_records_page.js").exists())
        self.assertIn("ag_historical_ledger_rows", read("scripts/retire_bati_organisation_and_green_space.sql"))

    def test_sql_targets_only_one_organisation_and_experiment(self):
        sql = read("scripts/retire_bati_organisation_and_green_space.sql")
        self.assertIn("59f5db4c-c85f-4a49-ae4e-11232e95ac02", sql)
        self.assertIn("aggregator_code = 'BATI'", sql)
        self.assertIn("shared.community_id = bc.community_id", sql)
        self.assertIn("shared.farmer_id = bf.farmer_id", sql)
        self.assertIn("v_preserved_mawimbi_collections", sql)
        self.assertIn("v_preserved_mawimbi_receipts", sql)
        self.assertIn("v_preserved_cosme_memberships", sql)
        self.assertIn("v_preserved_ledger <> 1704", sql)
        self.assertIn("raise exception 'BATI counts changed since audit; aborting.'", sql)
        self.assertIn("commit;", sql)
        for forbidden in (
            "delete from public.collections", "delete from public.ag_communities",
            "delete from public.ag_farmers", "delete from public.ag_historical_ledger_rows",
        ):
            self.assertNotIn(forbidden, sql.lower())
        self.assertNotIn("delete from storage.objects", sql.lower())

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
