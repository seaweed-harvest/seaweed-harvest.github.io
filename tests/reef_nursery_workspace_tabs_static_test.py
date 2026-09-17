from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
BOOT = (ROOT / "assets/js/reef_nursery_boot.js").read_text(encoding="utf-8")
WORKSPACE_TABS = (ROOT / "assets/js/reef_nursery_workspace_tabs.js").read_text(encoding="utf-8")


class ReefNurseryWorkspaceTabsStaticTest(unittest.TestCase):
    def test_boot_loads_workspace_tabs_module(self):
        self.assertIn('import("./reef_nursery_workspace_tabs.js?v=1")', BOOT)

    def test_top_level_workspace_labels_are_present(self):
        self.assertIn('trainingWorkspaceTab.textContent = "Nursery Training"', WORKSPACE_TABS)
        self.assertIn('seaweedWorkspaceTab.textContent = "Seaweed Data Collection"', WORKSPACE_TABS)

    def test_existing_seaweed_tab_remains_controller_source_but_is_not_visible_in_training_row(self):
        self.assertIn('const sourceSeaweedTab = document.getElementById("reefSeaweedTab")', WORKSPACE_TABS)
        self.assertIn('sourceSeaweedTab.classList.add("reef-workspace-source-tab")', WORKSPACE_TABS)
        self.assertIn('#reefNurseryTabs .reef-workspace-source-tab', WORKSPACE_TABS)
        self.assertIn('sourceSeaweedTab.click()', WORKSPACE_TABS)

    def test_secondary_tabs_hide_for_seaweed_workspace(self):
        self.assertIn("secondaryTabs.hidden = seaweedActive", WORKSPACE_TABS)
        self.assertIn('sourceSeaweedTab.getAttribute("aria-selected") === "true"', WORKSPACE_TABS)

    def test_training_workspace_remembers_last_secondary_tab(self):
        self.assertIn('let lastTrainingTab = selectedTrainingTab(secondaryTabs) || "session"', WORKSPACE_TABS)
        self.assertIn("lastTrainingTab = tab.dataset.reefTab", WORKSPACE_TABS)
        self.assertIn('data-reef-tab="${lastTrainingTab}"', WORKSPACE_TABS)

    def test_review_mode_can_hide_seaweed_workspace_through_existing_hidden_state(self):
        self.assertIn("const unavailable = sourceSeaweedTab.hidden || sourceSeaweedTab.disabled", WORKSPACE_TABS)
        self.assertIn("seaweedWorkspaceTab.hidden = unavailable", WORKSPACE_TABS)
        self.assertIn('attributeFilter: ["aria-selected", "hidden", "disabled"]', WORKSPACE_TABS)

    def test_keyboard_navigation_stays_within_each_tab_level(self):
        self.assertIn('secondaryTabs.addEventListener("keydown"', WORKSPACE_TABS)
        self.assertIn('workspaceTabs.addEventListener("keydown"', WORKSPACE_TABS)
        self.assertIn("event.stopImmediatePropagation()", WORKSPACE_TABS)


if __name__ == "__main__":
    unittest.main()
