import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MobileAppNavigationStaticTest(unittest.TestCase):
    def test_shared_navigation_is_connected_to_admin_and_collection(self):
        admin = (ROOT / "assets/js/admin_page.js").read_text(encoding="utf-8")
        collection = (ROOT / "assets/js/collection_form.js").read_text(encoding="utf-8")
        self.assertIn('from "./app_navigation.js?v=15"', admin)
        self.assertIn("setupAppNavigation({", admin)
        self.assertIn('from "./app_navigation.js?v=15"', collection)
        self.assertIn("setupAppNavigation({", collection)
        self.assertIn("populateAppSidebar", admin)
        self.assertIn("populateAppSidebar", collection)

    def test_primary_navigation_and_drawer_contract(self):
        navigation = (ROOT / "assets/js/app_navigation.js").read_text(encoding="utf-8")
        for label in ("Menu", "Dashboard", "Forms", "Records", "User"):
            self.assertIn(f'"{label}"', navigation)
        self.assertIn("primary.append(brand, menuButton, formsMenu, recordsMenu);", navigation)
        self.assertIn('brandImage.src = "./assets/images/seaweed-harvest-icon-192.png"', navigation)
        self.assertNotIn('const dashboard = primaryButton(', navigation)
        self.assertIn('primaryButton("button", "menu", "Menu")', navigation)
        self.assertIn('quickMenu("clipboard-list", "Forms"', navigation)
        self.assertIn('quickMenu("database", "Records"', navigation)
        self.assertIn('primaryButton("a", "user-round", "User")', navigation)
        self.assertIn('svg.setAttribute("data-lucide", name)', navigation)
        self.assertIn("setDrawerOpen(false);", navigation)
        self.assertIn('profileFallback.classList.add("mobile-profile-link")', navigation)
        self.assertIn('drawer.classList.add("app-navigation-drawer")', navigation)
        self.assertIn('label: "Community Map"', navigation)
        self.assertIn('drawerGroup("User Registry"', navigation)
        self.assertIn('drawerGroup("Tools"', navigation)
        for label in ("Site Water Samples", "Intake", "Stock", "Process"):
            self.assertIn(f'label: "{label}"', navigation)
        for old_label in (
            "1. Site Water Samples",
            "2. Intake Collection",
            "3. Stock Record",
            "4. Process Record",
        ):
            self.assertNotIn(f'label: "{old_label}"', navigation)
        self.assertIn("export function populateAppSidebar", navigation)
        self.assertIn('const SIDEBAR_PINNED_KEY = "seaweed_ag:admin_sidebar_pinned"', navigation)
        self.assertIn('const SIDEBAR_GROUP_KEY_PREFIX = "seaweed_ag:admin_menu:"', navigation)

    def test_mobile_drawer_is_off_canvas_and_header_stays_in_page_flow(self):
        css = (ROOT / "assets/css/ag.css").read_text(encoding="utf-8")
        self.assertIn(".admin-sidebar.app-navigation-drawer-standalone {\n    display: none;", css)
        self.assertIn(".unified-app-header {\n    position: relative;", css)
        self.assertIn("transform: translateX(-105%);", css)
        self.assertIn(".app-navigation-drawer-standalone.is-open", css)
        self.assertIn(".unified-app-header .account-menu-label", css)
        self.assertIn("grid-template-columns: repeat(5, minmax(0, 1fr));", css)
        self.assertIn("grid-template-columns: repeat(4, minmax(0, 1fr));", css)

    def test_navigation_reaches_operational_account_pages(self):
        today = (ROOT / "assets/js/today_page.js").read_text(encoding="utf-8")
        collector = (ROOT / "assets/js/collector_dashboard_page.js").read_text(encoding="utf-8")
        details = (ROOT / "assets/js/my_details_page.js").read_text(encoding="utf-8")
        for source in (today, collector, details):
            self.assertIn('from "./app_navigation.js?v=15"', source)
            self.assertIn("setupAppNavigation({", source)

    def test_my_details_uses_the_shared_desktop_sidebar_and_mobile_drawer(self):
        page = (ROOT / "my_details.html").read_text(encoding="utf-8")
        script = (ROOT / "assets/js/my_details_page.js").read_text(encoding="utf-8")
        self.assertIn('class="app-shell admin-shell admin-layout my-details-shell"', page)
        self.assertIn('id="myDetailsSidebar" class="admin-sidebar"', page)
        self.assertIn("populateAppSidebar(els.myDetailsSidebar", script)
        self.assertIn("setupAppNavigation({ profile, dashboardHref, sidebar })", script)

    def test_navigation_is_available_offline(self):
        worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")
        self.assertRegex(worker, r'CACHE_VERSION = "seaweed-harvest-collection-v\d+"')
        self.assertIn('"./assets/js/app_navigation.js"', worker)

    def test_native_network_indicator_is_offline_only(self):
        native_bootstrap = ROOT / "mobile/src/native_bootstrap.js"
        if not native_bootstrap.exists():
            self.skipTest("Native bootstrap is maintained outside this web repository.")
        bootstrap = native_bootstrap.read_text(encoding="utf-8")
        self.assertIn("indicator.hidden = online", bootstrap)
        self.assertIn('indicator.setAttribute("aria-label", online ? "" : "Offline")', bootstrap)

    def test_native_update_flow_explains_android_install_and_recovers_the_button(self):
        native_bootstrap = ROOT / "mobile/src/native_bootstrap.js"
        if not native_bootstrap.exists():
            self.skipTest("Native bootstrap is maintained outside this web repository.")
        bootstrap = native_bootstrap.read_text(encoding="utf-8")
        self.assertIn('updateButton.textContent = "Download update"', bootstrap)
        self.assertIn("tap the APK notification or open Downloads, then tap Install", bootstrap)
        self.assertIn('updateButton.textContent = "Open download again"', bootstrap)
        self.assertIn("finally {\n      updateButton.disabled = false;", bootstrap)


if __name__ == "__main__":
    unittest.main()
