import base64
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class DryerMainCutoverStaticTest(unittest.TestCase):
    def test_dryer_config_uses_matching_main_project_public_key(self):
        source = (ROOT / "assets/js/dryer_table_config.js").read_text(encoding="utf-8")
        self.assertIn('supabaseUrl: "https://wwzmajhdusfyfskppupg.supabase.co"', source)
        match = re.search(r'supabaseAnonKey: "([^"]+)"', source)
        self.assertIsNotNone(match)
        payload = match.group(1).split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        self.assertEqual(claims["ref"], "wwzmajhdusfyfskppupg")
        self.assertEqual(claims["role"], "anon")
        self.assertNotIn("iyoihlwtvdshtlzjdoed", source)

    def test_authenticated_reports_send_the_main_account_token(self):
        for filename, variable in (
            ("dryer_table_records.js", "accountToken"),
            ("dryer_table_analysis.js", "token"),
            ("dryer_table_payments.js", "accountToken"),
        ):
            with self.subTest(filename=filename):
                source = (ROOT / "assets/js" / filename).read_text(encoding="utf-8")
                self.assertIn(f'Authorization: `Bearer ${{{variable}}}`', source)
                self.assertNotIn('Authorization: `Bearer ${DRYING_FORM_CONFIG.supabaseAnonKey}`', source)

    def test_legacy_admin_delete_is_hidden_until_replaced(self):
        page = (ROOT / "dryer_table.html").read_text(encoding="utf-8")
        self.assertRegex(page, r'<button id="openRecordsDelete"[^>]*\bhidden\b')


if __name__ == "__main__":
    unittest.main()
