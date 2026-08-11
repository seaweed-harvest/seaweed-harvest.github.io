import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class DryerTableStaticTest(unittest.TestCase):
    def test_drying_trials_panel_is_retained_but_hidden(self):
        page = (ROOT / "dryer_table.html").read_text(encoding="utf-8")
        panel = re.search(r'<details\s+id="dryingTrials"[^>]*>', page)

        self.assertIsNotNone(panel)
        self.assertRegex(panel.group(0), r'\bhidden\b')
        self.assertIn("Drying Trials", page)

    def test_dryer_table_supports_public_entry_without_login_redirect(self):
        bootstrap = (ROOT / "assets/js/dryer_table_bootstrap.js").read_text(
            encoding="utf-8"
        )

        self.assertNotIn("requireAggregatorAccess", bootstrap)
        self.assertIn('callPublicRpc("ag_public_form_entry_context"', bootstrap)
        self.assertIn('p_form_key: "form_dryer_table"', bootstrap)
        self.assertIn('p_organisation_code: "COSME"', bootstrap)
        self.assertIn("optionalSignedInProfile", bootstrap)
        self.assertNotIn("window.location.replace", bootstrap)

    def test_cosme_dryer_table_is_configured_as_public(self):
        migration = (
            ROOT
            / "supabase/migrations/20260811173000_public_cosme_dryer_table.sql"
        ).read_text(encoding="utf-8")

        self.assertIn("'form_dryer_table'", migration)
        self.assertIn("'public'", migration)
        self.assertIn("upper(organisation.aggregator_code) = 'COSME'", migration)


if __name__ == "__main__":
    unittest.main()
