import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NAVIGATION = ROOT / "assets" / "js" / "app_navigation.js"


class ReefNurseryPublicNavigationStaticTest(unittest.TestCase):
    def test_navigation_builders_receive_the_current_page(self):
        source = NAVIGATION.read_text(encoding="utf-8")
        self.assertIn("const forms = formLinks(profile, currentFile);", source)
        self.assertIn("const records = recordLinks(profile, currentFile);", source)
        self.assertIn('drawerGroup("Forms", formLinks(profile, currentFile)', source)
        self.assertIn('drawerGroup("Records", recordLinks(profile, currentFile)', source)

    def test_anonymous_reef_page_does_not_fall_back_to_mawimbi_navigation(self):
        source = NAVIGATION.read_text(encoding="utf-8")
        self.assertIn('return !profile && currentFile === "reef_nursery.html";', source)
        self.assertIn("publicFallback: !anonymousReefNursery", source)
        self.assertIn("!isAnonymousReefNurseryPage(profile, currentFile)", source)

    def test_anonymous_reef_page_keeps_its_own_form_link(self):
        source = NAVIGATION.read_text(encoding="utf-8")
        self.assertIn("if (anonymousReefNursery) {", source)
        self.assertIn(
            'links.push({ label: "Reef Nursery", href: "./reef_nursery.html", publicFallback: true });',
            source,
        )

    def test_empty_shared_navigation_groups_are_hidden(self):
        source = NAVIGATION.read_text(encoding="utf-8")
        self.assertGreaterEqual(source.count("details.hidden = links.length === 0;"), 2)

    def test_link_builder_behavior_for_public_reef_and_existing_contexts(self):
        probe = textwrap.dedent(
            r"""
            const fs = require("fs");
            const vm = require("vm");
            let source = fs.readFileSync(process.argv[1], "utf8");
            source = source.replace(/^import .*?;\n/, "");
            source = source.replace(/export function/g, "function");
            source += "\n;globalThis.__navTest = { formLinks, recordLinks };\n";

            const context = {
              URL,
              URLSearchParams,
              startOfflineCollectionAutoSync: () => {},
              window: {
                location: {
                  href: "https://example.test/reef_nursery.html",
                  pathname: "/reef_nursery.html",
                  search: ""
                }
              },
              document: {},
              localStorage: { getItem: () => null, setItem: () => {} }
            };
            context.globalThis = context;
            vm.createContext(context);
            new vm.Script(source, { filename: "app_navigation.js" }).runInContext(context);

            const labels = (links) => links.map((link) => link.label);
            const { formLinks, recordLinks } = context.__navTest;
            const cosme = {
              app_role: "aggregator_admin",
              can_access_reef_nursery: true,
              can_view_data: true,
              active_aggregator_code: "COSME",
              organisation_capabilities: {
                form_reef_nursery: true,
                form_dryer_table: true,
                form_intake_collection: false
              }
            };

            process.stdout.write(JSON.stringify({
              anonymousReefForms: labels(formLinks(null, "reef_nursery.html")),
              anonymousReefRecords: labels(recordLinks(null, "reef_nursery.html")),
              anonymousCollectionForms: labels(formLinks(null, "collection.html")),
              anonymousCollectionRecords: labels(recordLinks(null, "collection.html")),
              signedInCosmeForms: labels(formLinks(cosme, "reef_nursery.html")),
              signedInCosmeRecords: labels(recordLinks(cosme, "reef_nursery.html"))
            }));
            """
        )
        result = subprocess.run(
            ["node", "-e", probe, str(NAVIGATION)],
            check=True,
            capture_output=True,
            text=True,
        )
        data = json.loads(result.stdout)
        self.assertEqual(data["anonymousReefForms"], ["Reef Nursery"])
        self.assertEqual(data["anonymousReefRecords"], [])
        self.assertEqual(data["anonymousCollectionForms"], ["Intake"])
        self.assertEqual(data["anonymousCollectionRecords"], ["Today's Intake"])
        self.assertEqual(data["signedInCosmeForms"], ["Reef Nursery", "Dryer Table"])
        self.assertEqual(data["signedInCosmeRecords"], ["Photos", "Reef Nursery Records"])


if __name__ == "__main__":
    unittest.main()
