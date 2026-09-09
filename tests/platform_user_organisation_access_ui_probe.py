"""Offline Chromium interaction probe; synthetic accounts and stubbed network only.
Run: python tests/platform_user_organisation_access_ui_probe.py
Requires the existing Playwright/Chromium test environment, not a live login.
"""
from pathlib import Path
import json
import re
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = re.sub(r'<script\b[^>]*>[\s\S]*?</script>|<link\b[^>]*>', '', (ROOT / 'admin_users.html').read_text())
SOURCE = re.sub(r'^import[\s\S]*?;\n', '', (ROOT / 'assets/js/users_page.js').read_text(), flags=re.M)
SOURCE = SOURCE.replace('document.addEventListener("DOMContentLoaded", init);', '')
STUBS = r'''
const APP_CONFIG = {};
const DASHBOARD_OPTIONS = Object.fromEntries(["admin", "collector", "farmer"].map(kind => [kind, [{key: "synthetic_widget", label: "Test widget"}]]));
window.saved = []; window.appWrites = []; window.failSave = false;
window.retainedTide = {tide: {enabled: true, role: "user", display_name: "Tide Planner", route_path: "/tide/", expires_at: "2026-10-01T00:00:00Z"}};
const authClient = {rpc: async (name) => {
  if (name === "ag_admin_user_form_access") return {data: {}, error: null};
  if (name === "ag_admin_user_app_access") return {data: structuredClone(window.retainedTide), error: null};
  window.appWrites.push(name); throw new Error("Unexpected RPC: " + name);
}};
const invokeAdminUsers = async (payload) => {
  if (window.failSave) throw new Error("Synthetic save rejection");
  if (payload.action !== "update") throw new Error("Unexpected admin action");
  window.saved.push(structuredClone(payload)); return {ok: true};
};
const invokePlatformAppUsers = async () => { throw new Error("Unexpected Tide write"); };
const currentProfile = async () => null;
const isAuthSessionError = () => false;
const requireAdminAccess = async () => null;
const selectRows = async () => [];
'''
SETUP = r'''
for (const element of document.querySelectorAll("[id]")) els[element.id] = element;
state.actor = {id: "synthetic-owner", app_role: "system_admin", account_status: "active", can_manage_users: true};
state.users = [
  {id: "synthetic-platform", email: "tester@example.invalid", display_name: "Synthetic Tester", app_role: "platform_user", account_status: "active", aggregator_ids: []},
  {id: "synthetic-regular", email: "regular@example.invalid", display_name: "Synthetic Regular", app_role: "field_collector", account_status: "active", aggregator_ids: ["cosme"]},
  {id: "synthetic-farmer", email: "farmer@example.invalid", display_name: "Synthetic Farmer", app_role: "farmer_viewer", farmer_id: "RID0001", account_status: "active", aggregator_ids: ["cosme"]}
];
state.aggregators = [{id: "cosme", aggregator_code: "COSME", organisation_name: "Synthetic COSME", capabilities: {form_reef_nursery: true, form_dryer_table: true}}];
loadPageData = async () => {};
buildPermissionInputs(els.invitePermissions, "invite");
buildPermissionInputs(els.editPermissions, "edit");
buildEditRoleOptions(); bindEvents(); renderUsers();
window.probe = {state, els, saveUser, configurePlatformOnlyEditor};
'''


def exercise(browser, width):
    page = browser.new_page(viewport={"width": width, "height": 950})
    page.set_default_timeout(5000)
    page.route('**/*', lambda route: route.abort())
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(HTML)
    page.add_script_tag(content=STUBS + SOURCE + SETUP)
    def open_user(kind):
        page.locator(f'[data-edit-user="synthetic-{kind}"]').click()
        page.wait_for_function(f'probe.els.editUserId.value === "synthetic-{kind}" && !probe.els.userEditorPanel.hidden')
    open_user('platform')
    assert page.locator('#editUserRole').is_enabled()
    assert page.locator('#saveUser').is_hidden()
    assert page.locator('#editDailySummaryFieldset').is_hidden()
    assert page.locator('#editApplicationAccessFieldset').is_visible()
    assert page.locator('#editUserRole option[value="system_admin"]').evaluate("e => e.disabled")

    # The original change listener must reveal the existing form controls.
    page.locator('#editUserRole').select_option('field_collector')
    assert page.locator('#saveUser').is_visible()
    assert page.locator('#editUserName').is_enabled()
    page.locator('#saveUser').click()
    assert 'Select at least one organisation' in page.locator('#editUserMessage').inner_text()
    assert page.evaluate('saved.length') == 0
    page.locator('[data-aggregator-access="edit"][value="cosme"]').check()
    reef = page.locator('[data-user-form-access="edit"][value="form_reef_nursery"]')
    dryer = page.locator('[data-user-form-access="edit"][value="form_dryer_table"]')
    assert not reef.is_checked() and not dryer.is_checked()
    reef.check()
    page.locator('#editUserRole').select_option('platform_user')
    assert page.locator('#saveUser').is_hidden()
    page.locator('#editUserRole').select_option('field_collector')
    assert reef.is_checked() and not dryer.is_checked()

    # A rejected save is visible and retains the selection for retry.
    page.evaluate('failSave = true')
    page.locator('#saveUser').click()
    page.wait_for_function('probe.els.editUserMessage.textContent === "Synthetic save rejection"')
    assert reef.is_checked() and page.locator('#userEditorPanel').is_visible()
    page.evaluate('failSave = false')
    page.locator('#saveUser').click()
    page.wait_for_function('saved.length === 1 && probe.els.userEditorPanel.hidden')
    payload = page.evaluate('saved[0]')
    assert payload['user_id'] == 'synthetic-platform'
    assert payload['app_role'] == 'field_collector'
    assert payload['aggregator_ids'] == ['cosme']
    assert [key for key, value in payload['organisation_form_access']['cosme'].items() if value] == ['form_reef_nursery']
    assert [key for key, value in payload['permissions'].items() if value] == ['can_submit_collection']
    assert payload['daily_summary_aggregator_ids'] == []
    assert page.evaluate('appWrites.length') == 0
    assert 'expires_at' not in payload
    assert page.evaluate('retainedTide.tide.expires_at') == '2026-10-01T00:00:00Z'

    # Editor state must not leak from an application-only account to regular/farmer users.
    open_user('platform'); open_user('regular')
    assert page.locator('#editUserName').is_enabled()
    assert page.locator('#editUserStatus').is_enabled()
    assert page.locator('#saveUser').is_visible()
    assert page.locator('#editUserRole option[value="platform_user"]').count() == 0
    open_user('farmer')
    assert page.locator('#editUserName').is_disabled()
    assert page.locator('#editUserCommunity').is_disabled()
    assert page.locator('#editFarmerIdField').is_visible()

    # A normal organisation administrator cannot adopt an unrelated platform user.
    page.evaluate('probe.state.actor = {app_role: "company_admin", account_status: "active", can_manage_users: true}')
    open_user('platform')
    assert page.locator('#editUserRole').is_disabled()
    assert page.locator('#saveUser').is_hidden()
    page.evaluate('probe.els.editUserRole.value = "field_collector"; probe.configurePlatformOnlyEditor(probe.state.editingUser)')
    page.evaluate('probe.saveUser({preventDefault(){}})')
    assert page.evaluate('saved.length') == 1
    assert page.locator('#saveUser').is_hidden()
    assert not errors, errors
    page.close()
    return {"viewport": width, "result": "passed", "page_errors": errors}


if __name__ == '__main__':
    with sync_playwright() as playwright:
        chromium = shutil.which('chromium') or shutil.which('chromium-browser')
        options = {"headless": True, "args": ["--no-sandbox"]}
        if chromium:
            options['executable_path'] = chromium
        browser = playwright.chromium.launch(**options)
        try:
            print(json.dumps([exercise(browser, width) for width in (1440, 390)], indent=2))
        finally:
            browser.close()
