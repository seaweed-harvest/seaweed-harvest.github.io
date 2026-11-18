"""Synthetic desktop/phone check of the shared handover menu (no live login)."""

import re
import shutil
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "assets/js/app_navigation.js").read_text(encoding="utf-8")
source = re.sub(r"^import .*?;\n", "", source, count=1, flags=re.MULTILINE)
source = source.replace("export function", "function")
source = source.replace(
    'void import("./platform_access.js?v=1")',
    "void Promise.resolve({hasApplicationAccess: async () => false})",
)
source = source.replace(
    'void import("./auth_client.js?v=25")',
    "void Promise.resolve({authClient: {rpc: async () => ({data: {can_view: true}, error: null})}})",
)
source += "\nwindow.handoverNav = { populateAppSidebar, setupAppNavigation };"


def profile(code):
    return {
        "app_role": "system_admin",
        "active_aggregator_code": code,
        "is_protected_owner": True,
        "can_access_reef_nursery": code == "COSME",
        "can_view_data": True,
        "can_view_notifications": True,
        "can_view_finance": True,
        "can_view_dashboard": True,
        "can_access_admin": True,
        "organisation_capabilities": {
            "form_green_space": code == "SANDBOX",
            "form_intake_collection": code == "MAWIMBI",
            "form_process_record": code == "MAWIMBI",
            "form_reef_nursery": code == "COSME",
            "form_dryer_table": code == "COSME",
            "tool_qr_tags": True,
            "tool_notifications": True,
            "tool_pricing": True,
        },
    }


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True, executable_path=shutil.which("chromium") or None
    )
    for width in (1440, 390):
        for code in ("SANDBOX", "COSME", "MAWIMBI"):
            page = browser.new_page(viewport={"width": width, "height": 850})
            page.set_content(
                '<header class="app-header"><div class="header-actions"></div></header>'
                '<main class="admin-layout"><aside id="sidebar"></aside></main>'
            )
            page.add_script_tag(content=source)
            page.evaluate(
                """(p) => {
                  window.startOfflineCollectionAutoSync = () => {};
                  const sidebar = document.getElementById('sidebar');
                  handoverNav.populateAppSidebar(sidebar, {profile: p, currentFile: 'home.html'});
                  handoverNav.setupAppNavigation({profile: p, sidebar});
                }""",
                profile(code),
            )
            page.wait_for_function(
                """() => !!document.querySelector('a[href="./cosme_metrics.html"]')"""
            )
            groups = page.evaluate(
                """() => Object.fromEntries([...document.querySelectorAll('#sidebar details.admin-menu-group')]
                  .map(group => [group.querySelector('summary').textContent,
                    [...group.querySelectorAll('a')].map(link => link.textContent)]))"""
            )
            all_labels = [label for links in groups.values() for label in links]
            for hidden in ("Green Space Log", "Finance Review", "Form Manager", "Form Builder", "SMS Settings", "Project Journal"):
                assert hidden not in all_labels, (code, width, hidden)
            assert groups["Tools"].count("Project Summary") == 1, (code, width)
            if code == "SANDBOX":
                assert groups["Forms"] == [], (width, groups["Forms"])
                assert groups["Records"] == ["Ledger Transcriptions"], (width, groups["Records"])
            elif code == "MAWIMBI":
                for label in ("Dataset Dashboard", "Backups", "Mawimbi Process Flow", "Receipts", "Notifications", "Suggestions", "Tags", "Pricing Matrix"):
                    assert label in groups["Tools"], (width, label)
            if width == 390:
                page.locator(".mobile-menu-toggle").click()
                assert page.locator("#sidebar").evaluate(
                    "el => el.classList.contains('is-open')"
                ), (code, width)
            print(f"PASS: {code} menu at {width}px")
            page.close()
    browser.close()
