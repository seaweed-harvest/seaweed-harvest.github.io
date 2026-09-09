import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(new URL("../assets/js/users_page.js", import.meta.url), "utf8");
const executable = source.replace(/^import[\s\S]*?;\n/gm, "");
function fixture() {
  const context = vm.createContext({ document: { addEventListener() {}, getElementById() { return null; } } });
  vm.runInContext(executable + `\nglobalThis.subject = {
    state, els, canAddOrganisationAccess, isPlatformUserConversion,
    configurePlatformOnlyEditor, renderUserFormAccess, rolePreset, saveUser
  };`, context);
  const h = context.subject;
  const element = () => ({ hidden: false, disabled: false, value: "", dataset: {}, textContent: "" });
  const systemOption = element();
  for (const id of ["saveUser", "editUserRole", "editUserStatus", "editUserName", "editUserCommunity", "editFarmerIdField", "editFarmerId", "editFormAccessFieldset", "editDailySummaryFieldset", "editUserMessage", "editFormAccess"]) h.els[id] = element();
  for (const id of ["editAggregators", "editPermissions", "editDashboardPreferences"]) {
    const fieldset = element();
    h.els[id] = { ...element(), fieldset, closest() { return fieldset; }, querySelectorAll() { return [{value: "cosme"}]; } };
  }
  h.els.editUserRole.querySelector = () => systemOption;
  h.state.actor = {app_role: "system_admin", account_status: "active", can_manage_users: true};
  h.state.editingUser = {id: "synthetic-user", app_role: "platform_user"};
  h.els.editUserRole.value = "platform_user";
  return {h, systemOption};
}

test("active system administrator must deliberately choose an organisation role", () => {
  const {h, systemOption} = fixture();
  h.configurePlatformOnlyEditor(h.state.editingUser);
  assert.equal(h.els.editUserRole.disabled, false);
  assert.equal(h.els.saveUser.hidden, true);
  assert.equal(h.els.editAggregators.fieldset.hidden, true);
  assert.equal(h.els.editDailySummaryFieldset.hidden, true);
  assert.equal(systemOption.disabled, true);
  assert.match(h.els.editUserMessage.textContent, /choose an organisation role/i);
  h.els.editUserRole.value = "field_collector";
  h.configurePlatformOnlyEditor(h.state.editingUser);
  assert.equal(h.isPlatformUserConversion(), true);
  for (const id of ["saveUser", "editFormAccessFieldset", "editDailySummaryFieldset"]) assert.equal(h.els[id].hidden, false);
  for (const id of ["editUserName", "editUserCommunity", "editUserStatus"]) assert.equal(h.els[id].disabled, false);
});

test("ordinary admins, inactive actors, missing management permission and owner label alone cannot convert", () => {
  const actors = [null, {app_role: "company_admin", account_status: "active", can_manage_users: true},
    {app_role: "system_admin", account_status: "suspended", can_manage_users: true},
    {app_role: "system_admin", account_status: "active", can_manage_users: false},
    {is_protected_owner: true, app_role: "company_admin", account_status: "active", can_manage_users: true}];
  for (const actor of actors) {
    const {h} = fixture(); h.state.actor = actor; h.els.editUserRole.value = "field_collector";
    h.configurePlatformOnlyEditor(h.state.editingUser);
    assert.equal(h.isPlatformUserConversion(), false);
    assert.equal(h.els.editUserRole.disabled, true);
    assert.equal(h.els.saveUser.hidden, true);
  }
});

test("platform, unsupported and system roles cannot be submitted as conversions", async () => {
  for (const role of ["platform_user", "system_admin", "", "bogus", "toString"]) {
    const {h} = fixture(); h.els.editUserRole.value = role;
    assert.equal(h.isPlatformUserConversion(), false);
    let prevented = false;
    await h.saveUser({preventDefault() { prevented = true; }});
    assert.equal(prevented, true);
    assert.equal(h.els.editUserMessage.dataset.status, "error");
  }
});

test("switching back to platform-only restores the lock without touching application access", () => {
  const {h} = fixture();
  h.state.editingApplicationAccess = {tide: {enabled: true, role: "user", expires_at: "2026-10-01T00:00:00Z"}};
  const before = JSON.stringify(h.state.editingApplicationAccess);
  h.els.editUserRole.value = "field_collector"; h.configurePlatformOnlyEditor(h.state.editingUser);
  h.els.editUserRole.value = "platform_user"; h.configurePlatformOnlyEditor(h.state.editingUser);
  assert.equal(h.els.saveUser.hidden, true);
  assert.equal(h.els.editUserStatus.disabled, true);
  assert.equal(JSON.stringify(h.state.editingApplicationAccess), before);
});

test("regular and farmer editors reset platform-only disabled state", () => {
  const {h, systemOption} = fixture();
  h.configurePlatformOnlyEditor(h.state.editingUser);
  h.state.editingUser = {app_role: "field_collector"}; h.els.editUserRole.value = "field_collector";
  h.configurePlatformOnlyEditor(h.state.editingUser);
  assert.equal(h.els.editUserName.disabled, false);
  assert.equal(h.els.editUserStatus.disabled, false);
  assert.equal(h.els.editUserRole.disabled, false);
  assert.equal(systemOption.disabled, false);
  h.state.editingUser = {app_role: "farmer_viewer"}; h.els.editUserRole.value = "farmer_viewer";
  h.configurePlatformOnlyEditor(h.state.editingUser);
  assert.equal(h.els.editUserName.disabled, true);
  assert.equal(h.els.editUserCommunity.disabled, true);
  assert.equal(h.els.editFarmerIdField.hidden, false);
  assert.equal(h.els.editFarmerId.required, true);
});

test("new platform form selections default off; explicit Reef Nursery does not enable Dryer", () => {
  const {h} = fixture(); h.els.editUserRole.value = "field_collector";
  h.state.aggregators = [{id: "cosme", aggregator_code: "COSME", organisation_name: "Synthetic COSME", capabilities: {form_reef_nursery: true, form_dryer_table: true}}];
  for (const map of [undefined, {}, {cosme: null}]) {
    h.renderUserFormAccess("edit", map);
    assert.doesNotMatch(h.els.editFormAccess.innerHTML, / checked/);
  }
  h.renderUserFormAccess("edit", {cosme: {form_reef_nursery: true}});
  assert.match(h.els.editFormAccess.innerHTML, /value="form_reef_nursery" checked/);
  assert.doesNotMatch(h.els.editFormAccess.innerHTML, /value="form_dryer_table" checked/);
  h.state.editingUser = {app_role: "field_collector"}; h.renderUserFormAccess("edit");
  assert.match(h.els.editFormAccess.innerHTML, /value="form_dryer_table" checked/);
});

test("Field collector preset grants submission but no administration, finance or backup permission", () => {
  const {h} = fixture();
  assert.deepEqual(Object.entries(h.rolePreset("field_collector")).filter(([,v]) => v).map(([key]) => key), ["can_submit_collection"]);
});

test("organisation save and role changes do not invoke the separate application-access writer", () => {
  const save = source.slice(source.indexOf("async function saveUser("), source.indexOf("async function deleteSelectedUser("));
  assert.match(save, /action: "update"/);
  assert.match(save, /organisation_form_access: readUserFormAccess\("edit"\)/);
  assert.doesNotMatch(save, /saveApplicationAccess|invokePlatformAppUsers|ag_admin_set_user_app_access|expires_at/);
  assert.match(source, /renderDailySummaryInputs\("edit", dailySummaryIds\);\s+configurePlatformOnlyEditor\(state.editingUser\)/);
});
