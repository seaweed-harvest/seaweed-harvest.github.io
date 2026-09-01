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

    def test_dryer_shed_defaults_to_no_configuration(self):
        bootstrap = (ROOT / "assets/js/dryer_table_bootstrap.js").read_text(
            encoding="utf-8"
        )

        self.assertIn("setupDryerShedConfiguration", bootstrap)
        self.assertIn('locationSelect.value === "bati-dryer-shed"', bootstrap)
        self.assertIn('noConfigurationOption.value = "no_configuration"', bootstrap)
        self.assertIn('configurationSelect.disabled = dryerShedSelected', bootstrap)
        self.assertIn('nativeSet.call(configurationSelect, "no_configuration")', bootstrap)
        self.assertIn('noConfigurationOption.hidden = !dryerShedSelected', bootstrap)
        self.assertIn('form?.addEventListener("reset"', bootstrap)
        self.assertIn('Object.defineProperty(locationSelect, "value"', bootstrap)
        self.assertIn('Object.defineProperty(configurationSelect, "value"', bootstrap)

    def test_dryer_shed_backend_accepts_only_no_configuration(self):
        migration = (
            ROOT
            / "supabase/migrations/20260901195500_dryer_shed_no_configuration.sql"
        ).read_text(encoding="utf-8")

        self.assertIn("('bati-dryer-shed', 'ST-0102', 'Dryer Shed')", migration)
        self.assertIn("'no_configuration'::text", migration)
        self.assertIn("if v_location_code = 'bati-dryer-shed' then", migration)
        self.assertIn("<> 'no_configuration'", migration)
        self.assertIn("raise exception 'Dryer Shed must use no configuration'", migration)
        self.assertIn("'cover_open_back_open'", migration)
        self.assertIn("'cover_down_back_closed'", migration)
        self.assertIn("'cover_down_back_open'", migration)
        self.assertIn("elsif coalesce(p_payload->>'drying_configuration', '') not in", migration)


if __name__ == "__main__":
    unittest.main()
