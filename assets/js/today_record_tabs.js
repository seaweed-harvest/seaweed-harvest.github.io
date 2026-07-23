import { authClient, currentSession } from "./auth_client.js";
import { callRpc, selectRows } from "./supabase_client.js";

const CATEGORY_CONFIG = {
  "process-record": {
    rpcType: "process",
    dataKey: "process_records",
    prefix: "todayProcessRecord",
    colspan: 13,
    empty: "No process records were recorded on this date."
  },
  "site-sample": {
    rpcType: "site_sample",
    dataKey: "site_samples",
    prefix: "todaySiteSample",
    colspan: 11,
    empty: "No site samples were recorded on this date."
  },
  "stock-record": {
    rpcType: "stock",
    dataKey: "stock_records",
    prefix: "todayStockRecord",
    colspan: 13,
    empty: "No BioStim stock records were recorded on this date."
  }
};

const state = {
  active: "intake",
  loadedDate: null,
  loading: false,
  species: [],
  communities: [],
  categories: Object.fromEntries(Object.keys(CATEGORY_CONFIG).map((key) => [key, {
    rows: [],
    selected: new Set(),
    editing: new Set(),
    dirty: new Set(),
    drafts: new Map(),
    originals: new Map()
  }]))
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  els.todayRecordTabs = document.getElementById("todayRecordTabs");
  els.todayIntakeDate = document.getElementById("todayIntakeDate");
  if (!els.todayRecordTabs) return;

  Object.values(CATEGORY_CONFIG).forEach((config) => {
    [
      "Count", "Rows", "Status", "Actions", "SelectedCount", "StartEdit",
      "SaveEdits", "DiscardEdits", "DeleteSelected", "SelectAll"
    ].forEach((suffix) => {
      els[`${config.prefix}${suffix}`] = document.getElementById(`${config.prefix}${suffix}`);
    });
    const reloadId = config.prefix === "todayProcessRecord"
      ? "reloadTodayProcessRecords"
      : config.prefix === "todaySiteSample"
        ? "reloadTodaySiteSamples"
        : "reloadTodayStockRecords";
    els[`${config.prefix}Reload`] = document.getElementById(reloadId);
    bindCategory(config);
  });

  els.todayRecordTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-today-record-tab]");
    if (button) void activateTab(button.dataset.todayRecordTab);
  });
  els.todayRecordTabs.addEventListener("keydown", handleTabKeydown);
  if (els.todayIntakeDate?.matches("input[type='date']")) {
    els.todayIntakeDate.addEventListener("change", () => {
      state.loadedDate = null;
      clearAllEditStates();
      if (state.active !== "intake") void loadSupplementalRecords();
    });
  }

  const requested = new URLSearchParams(window.location.search).get("records");
  const category = requested && (requested === "intake" || CATEGORY_CONFIG[requested])
    ? requested
    : "intake";
  void activateTab(category, { updateUrl: false });
}

function bindCategory(config) {
  const rows = els[`${config.prefix}Rows`];
  rows?.addEventListener("change", (event) => handleCategoryChange(config, event));
  rows?.addEventListener("input", (event) => handleDraftInput(config, event));
  els[`${config.prefix}SelectAll`]?.addEventListener("change", () => toggleAll(config));
  els[`${config.prefix}StartEdit`]?.addEventListener("click", () => startEdit(config));
  els[`${config.prefix}SaveEdits`]?.addEventListener("click", () => saveEdits(config));
  els[`${config.prefix}DiscardEdits`]?.addEventListener("click", () => discardEdits(config));
  els[`${config.prefix}DeleteSelected`]?.addEventListener("click", () => deleteSelected(config));
  els[`${config.prefix}Reload`]?.addEventListener("click", () => loadSupplementalRecords({ force: true }));
}

async function activateTab(category, options = {}) {
  state.active = category;
  document.body.dataset.todayRecordCategory = category;

  document.querySelectorAll("[data-today-record-tab]").forEach((button) => {
    const selected = button.dataset.todayRecordTab === category;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll("[data-today-record-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.todayRecordPanel !== category;
  });

  if (options.updateUrl !== false) {
    const url = new URL(window.location.href);
    if (category === "intake") url.searchParams.delete("records");
    else url.searchParams.set("records", category);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }
  if (category !== "intake") await loadSupplementalRecords();
}

function handleTabKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const buttons = [...els.todayRecordTabs.querySelectorAll("[data-today-record-tab]")];
  const current = buttons.indexOf(document.activeElement);
  if (current < 0) return;
  event.preventDefault();
  let next = current;
  if (event.key === "ArrowLeft") next = (current - 1 + buttons.length) % buttons.length;
  if (event.key === "ArrowRight") next = (current + 1) % buttons.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = buttons.length - 1;
  buttons[next].focus();
  void activateTab(buttons[next].dataset.todayRecordTab);
}

async function loadSupplementalRecords(options = {}) {
  const date = recordDate();
  if (!options.force && state.loadedDate === date) {
    renderCategory(state.active);
    return;
  }
  if (state.loading) return;

  state.loading = true;
  setLoadingState(true);
  try {
    const session = await currentSession();
    if (!session) {
      state.loadedDate = null;
      renderSignedOutState();
      return;
    }

    const result = await callRpc("ag_today_form_records", { p_record_date: date });
    Object.entries(CATEGORY_CONFIG).forEach(([key, config]) => {
      state.categories[key].rows = Array.isArray(result?.[config.dataKey])
        ? result[config.dataKey]
        : [];
      resetEditState(key);
      renderCategory(key);
    });
    state.loadedDate = date;
    await loadEditorOptions();
  } catch (error) {
    state.loadedDate = null;
    renderLoadError(error);
  } finally {
    state.loading = false;
    setLoadingState(false);
  }
}

async function loadEditorOptions() {
  const requests = [];
  if (!state.species.length) {
    requests.push(
      selectRows(
        "ag_public_seaweed_type_settings",
        "select=type_key,label,common_name&order=display_order.asc"
      ).then((rows) => { state.species = rows; })
    );
  }
  if (!state.communities.length) {
    requests.push(
      selectRows(
        "ag_secure_communities",
        "select=id,community_id,community_name&order=community_name.asc"
      ).then((rows) => { state.communities = rows; })
    );
  }
  if (!requests.length) return;
  await Promise.allSettled(requests);
}

function setLoadingState(loading) {
  Object.values(CATEGORY_CONFIG).forEach((config) => {
    const button = els[`${config.prefix}Reload`];
    if (button) button.disabled = loading;
  });
  if (loading && CATEGORY_CONFIG[state.active]) {
    setCategoryStatus(CATEGORY_CONFIG[state.active], "Loading records...");
  }
}

function renderSignedOutState() {
  Object.entries(CATEGORY_CONFIG).forEach(([key, config]) => {
    state.categories[key].rows = [];
    const signIn = `<a href="./login.html?return=${encodeURIComponent(returnPage())}">Sign in</a>`;
    els[`${config.prefix}Count`].textContent = "Sign in";
    els[`${config.prefix}Rows`].innerHTML = emptyRow(
      config.colspan,
      `${signIn} to view ${categoryLabel(key).toLowerCase()}.`
    );
    updateActionUi(key);
    setCategoryStatus(config, "");
  });
}

function renderLoadError(error) {
  const message = !navigator.onLine
    ? "Device offline. Signed-in records will load when reception returns."
    : `Records could not be loaded. ${error?.message || "Try again."}`;
  Object.entries(CATEGORY_CONFIG).forEach(([key, config]) => {
    state.categories[key].rows = [];
    els[`${config.prefix}Count`].textContent = "Unavailable";
    els[`${config.prefix}Rows`].innerHTML = emptyRow(config.colspan, escapeHtml(message));
    updateActionUi(key);
    setCategoryStatus(config, message, "error");
  });
}

function renderCategory(key) {
  const config = CATEGORY_CONFIG[key];
  if (!config) return;
  const category = state.categories[key];
  const count = category.rows.length;
  els[`${config.prefix}Count`].textContent = `${count} row${count === 1 ? "" : "s"}`;
  if (!count) {
    els[`${config.prefix}Rows`].innerHTML = emptyRow(config.colspan, config.empty);
  } else if (key === "process-record") {
    els[`${config.prefix}Rows`].innerHTML = category.rows.map(renderProcessRow).join("");
  } else if (key === "site-sample") {
    els[`${config.prefix}Rows`].innerHTML = category.rows.map(renderSiteSampleRow).join("");
  } else {
    els[`${config.prefix}Rows`].innerHTML = category.rows.map(renderStockRow).join("");
  }
  updateActionUi(key);
  setCategoryStatus(config, "");
}

function renderProcessRow(row) {
  const key = "process-record";
  const category = state.categories[key];
  const id = String(row.id);
  const editing = category.editing.has(id);
  const dirty = category.dirty.has(id);
  const draft = category.drafts.get(id) || processDraft(row);
  return `
    <tr data-form-record-row="${escapeAttribute(id)}" class="${rowClass(editing, dirty)}">
      ${selectionCell(key, row, editing)}
      <td>${editing
        ? `${inputControl(key, id, "start_time", draft.start_time, "time", { required: true })}<span class="inline-time-separator">to</span>${inputControl(key, id, "end_time", draft.end_time, "time", { required: true })}`
        : `${escapeHtml(shortTime(row.start_time))} - ${escapeHtml(shortTime(row.end_time))}`}</td>
      <td><strong>PR-${escapeHtml(String(row.record_number || "").padStart(5, "0"))}</strong></td>
      <td>${editing ? speciesControl(key, id, draft.species) : escapeHtml(speciesLabel(row.species))}</td>
      <td>${editing ? numberControl(key, id, "received_seaweed_kg", draft.received_seaweed_kg) : escapeHtml(formatNumber(row.received_seaweed_kg))}</td>
      <td>${editing ? numberControl(key, id, "blended_seaweed_kg", draft.blended_seaweed_kg) : escapeHtml(formatNumber(row.blended_seaweed_kg))}</td>
      <td>${editing ? numberControl(key, id, "wet_pulp_kg", draft.wet_pulp_kg) : escapeHtml(formatNumber(row.wet_pulp_kg))}</td>
      <td>${editing ? numberControl(key, id, "pressed_liquid_l", draft.pressed_liquid_l) : escapeHtml(formatNumber(row.pressed_liquid_l))}</td>
      <td>${editing ? numberControl(key, id, "dry_pulp_kg", draft.dry_pulp_kg) : escapeHtml(formatNumber(row.dry_pulp_kg))}</td>
      <td>${editing ? numberControl(key, id, "lost_seaweed_kg", draft.lost_seaweed_kg) : escapeHtml(formatNumber(row.lost_seaweed_kg))}</td>
      <td>${editing ? inputControl(key, id, "number_of_presses", draft.number_of_presses, "number", { min: 1, step: 1 }) : escapeHtml(formatNumber(row.number_of_presses))}</td>
      <td>${editing ? inputControl(key, id, "recorded_by_name", draft.recorded_by_name, "text", { required: true, maxlength: 160 }) : escapeHtml(row.recorded_by_name || "-")}</td>
      <td>${editing ? inputControl(key, id, "notes", draft.notes, "text", { maxlength: 1000 }) : escapeHtml(row.notes || "-")}</td>
    </tr>`;
}

function renderSiteSampleRow(row) {
  const key = "site-sample";
  const category = state.categories[key];
  const id = String(row.id);
  const editing = category.editing.has(id);
  const dirty = category.dirty.has(id);
  const draft = category.drafts.get(id) || siteSampleDraft(row);
  return `
    <tr data-form-record-row="${escapeAttribute(id)}" class="${rowClass(editing, dirty)}">
      ${selectionCell(key, row, editing)}
      <td>${editing ? inputControl(key, id, "sample_time", draft.sample_time, "time", { required: true }) : escapeHtml(formatTime(row.sampled_at))}</td>
      <td>${editing ? communityControl(key, id, draft.community_record_id) : escapeHtml(joinValues(row.community_id_snapshot, row.community_name_snapshot))}</td>
      <td>${editing ? tideControl(key, id, draft.tide_stage) : escapeHtml(tideLabel(row.tide_stage))}</td>
      <td>${editing ? numberControl(key, id, "temperature_c", draft.temperature_c) : escapeHtml(measurement(row.temperature_c, "C"))}</td>
      <td>${editing ? measurementEditor(key, id, "salinity_value", draft.salinity_value, "salinity_unit", draft.salinity_unit, ["PSU", "ppt"]) : escapeHtml(measurement(row.salinity_value, row.salinity_unit))}</td>
      <td>${editing ? measurementEditor(key, id, "tds_value", draft.tds_value, "tds_unit", draft.tds_unit, ["mg/L", "g/L", "ppt"]) : escapeHtml(measurement(row.tds_value, row.tds_unit))}</td>
      <td>${editing ? numberControl(key, id, "electrical_conductivity_ms_cm", draft.electrical_conductivity_ms_cm) : escapeHtml(measurement(row.electrical_conductivity_ms_cm, "mS/cm"))}</td>
      <td>${editing ? booleanControl(key, id, "e_coli_sample_taken", draft.e_coli_sample_taken) : escapeHtml(booleanLabel(row.e_coli_sample_taken))}</td>
      <td>${editing ? inputControl(key, id, "recorded_by_name", draft.recorded_by_name, "text", { required: true, maxlength: 160 }) : escapeHtml(row.recorded_by_name || "-")}</td>
      <td>${editing ? inputControl(key, id, "notes", draft.notes, "text", { maxlength: 1000 }) : escapeHtml(row.notes || "-")}</td>
    </tr>`;
}

function renderStockRow(row) {
  const key = "stock-record";
  const category = state.categories[key];
  const id = String(row.id);
  const editing = category.editing.has(id);
  const dirty = category.dirty.has(id);
  const draft = category.drafts.get(id) || stockDraft(row);
  return `
    <tr data-form-record-row="${escapeAttribute(id)}" class="${rowClass(editing, dirty)}">
      ${selectionCell(key, row, editing)}
      <td>${escapeHtml(formatTime(row.created_at))}</td>
      <td>${editing ? inputControl(key, id, "carton_serial", draft.carton_serial, "text", { required: true, maxlength: 30, pattern: "[0-9]+" }) : `<strong>${escapeHtml(row.carton_serial || "-")}</strong>`}</td>
      <td>${escapeHtml(stockEntryLabel(row))}</td>
      <td>${editing ? speciesControl(key, id, draft.species) : escapeHtml(speciesLabel(row.species))}</td>
      <td>${editing ? measurementEditor(key, id, "weight_value", draft.weight_value, "weight_unit", draft.weight_unit, ["L", "mL"], true) : escapeHtml(measurement(row.weight_value, row.weight_unit))}</td>
      <td>${editing ? booleanControl(key, id, "stabilizer_added", draft.stabilizer_added) : escapeHtml(booleanLabel(row.stabilizer_added))}</td>
      <td>${editing ? measurementEditor(key, id, "chemical_dose_value", draft.chemical_dose_value, "chemical_dose_unit", draft.chemical_dose_unit, ["g/container"]) : escapeHtml(measurement(row.chemical_dose_value, row.chemical_dose_unit))}</td>
      <td>${editing ? measurementEditor(key, id, "salinity_value", draft.salinity_value, "salinity_unit", draft.salinity_unit, ["PSU", "ppt"]) : escapeHtml(measurement(row.salinity_value, row.salinity_unit))}</td>
      <td>${editing ? numberControl(key, id, "ph_value", draft.ph_value) : escapeHtml(formatNumber(row.ph_value))}</td>
      <td>${editing ? numberControl(key, id, "electrical_conductivity_ms_cm", draft.electrical_conductivity_ms_cm) : escapeHtml(measurement(row.electrical_conductivity_ms_cm, "mS/cm"))}</td>
      <td>${editing ? inputControl(key, id, "recorded_by_name", draft.recorded_by_name, "text", { required: true, maxlength: 160 }) : escapeHtml(row.recorded_by_name || "-")}</td>
      <td>${editing ? inputControl(key, id, "notes", draft.notes, "text", { maxlength: 1000 }) : escapeHtml(row.notes || "-")}</td>
    </tr>`;
}

function selectionCell(key, row, editing) {
  const category = state.categories[key];
  const id = String(row.id);
  const enabled = row.can_edit || row.can_delete;
  return `<td class="selection-cell"><input type="checkbox" data-form-record-select="${escapeAttribute(id)}" aria-label="Select record" ${category.selected.has(id) ? "checked" : ""} ${!enabled || editing ? "disabled" : ""}></td>`;
}

function handleCategoryChange(config, event) {
  const key = keyForConfig(config);
  const checkbox = event.target.closest("[data-form-record-select]");
  if (checkbox) {
    if (checkbox.checked) state.categories[key].selected.add(checkbox.dataset.formRecordSelect);
    else state.categories[key].selected.delete(checkbox.dataset.formRecordSelect);
    updateActionUi(key);
    return;
  }
  handleDraftInput(config, event);
}

function handleDraftInput(config, event) {
  const control = event.target.closest("[data-form-record-field]");
  if (!control) return;
  const key = keyForConfig(config);
  const category = state.categories[key];
  const id = control.dataset.formRecordId;
  const draft = category.drafts.get(id);
  if (!draft) return;
  draft[control.dataset.formRecordField] = control.type === "checkbox"
    ? control.checked
    : control.value;
  if (draftsEqual(draft, category.originals.get(id))) category.dirty.delete(id);
  else category.dirty.add(id);
  const row = els[`${config.prefix}Rows`].querySelector(`[data-form-record-row="${cssEscape(id)}"]`);
  row?.classList.toggle("today-row-dirty", category.dirty.has(id));
  updateActionUi(key);
}

function toggleAll(config) {
  const key = keyForConfig(config);
  const category = state.categories[key];
  const selectAll = els[`${config.prefix}SelectAll`];
  category.rows.forEach((row) => {
    const id = String(row.id);
    if (!(row.can_edit || row.can_delete)) return;
    if (selectAll.checked) category.selected.add(id);
    else category.selected.delete(id);
  });
  renderCategory(key);
}

function startEdit(config) {
  const key = keyForConfig(config);
  const category = state.categories[key];
  category.editing.clear();
  category.dirty.clear();
  category.drafts.clear();
  category.originals.clear();
  category.rows.forEach((row) => {
    const id = String(row.id);
    if (!category.selected.has(id) || !row.can_edit) return;
    const draft = draftFor(key, row);
    category.editing.add(id);
    category.drafts.set(id, structuredClone(draft));
    category.originals.set(id, structuredClone(draft));
  });
  if (!category.editing.size) {
    setCategoryStatus(config, "The selected records cannot be edited.", "error");
    return;
  }
  renderCategory(key);
  els[`${config.prefix}Rows`].querySelector("[data-form-record-field]")?.focus();
}

async function saveEdits(config) {
  const key = keyForConfig(config);
  const category = state.categories[key];
  if (!category.dirty.size) return;
  const invalid = [...els[`${config.prefix}Rows`].querySelectorAll("[data-form-record-field]")]
    .find((control) => !control.checkValidity());
  if (invalid) {
    invalid.reportValidity();
    return;
  }

  const updates = category.rows
    .filter((row) => category.dirty.has(String(row.id)))
    .map((row) => serializeDraft(key, row, category.drafts.get(String(row.id))));
  els[`${config.prefix}SaveEdits`].disabled = true;
  setCategoryStatus(config, `Saving ${updates.length} change${updates.length === 1 ? "" : "s"}...`);
  try {
    const result = await callRpc("ag_update_daily_form_records", {
      p_record_type: config.rpcType,
      p_updates: updates
    });
    state.loadedDate = null;
    await loadSupplementalRecords({ force: true });
    setCategoryStatus(config, `${Number(result?.updated_count || updates.length)} record${updates.length === 1 ? "" : "s"} saved.`);
  } catch (error) {
    setCategoryStatus(config, error.message || "Changes could not be saved.", "error");
    updateActionUi(key);
  }
}

function discardEdits(config) {
  const key = keyForConfig(config);
  resetEditState(key);
  renderCategory(key);
  setCategoryStatus(config, "Changes discarded.");
}

async function deleteSelected(config) {
  const key = keyForConfig(config);
  const category = state.categories[key];
  const ids = category.rows
    .filter((row) => category.selected.has(String(row.id)) && row.can_delete)
    .map((row) => row.id);
  if (!ids.length || category.editing.size) return;
  const label = `${ids.length} ${categoryLabel(key).toLowerCase()} record${ids.length === 1 ? "" : "s"}`;
  if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;

  els[`${config.prefix}DeleteSelected`].disabled = true;
  setCategoryStatus(config, `Deleting ${label}...`);
  try {
    const result = await callRpc("ag_delete_daily_form_records", {
      p_record_type: config.rpcType,
      p_record_ids: ids
    });
    const photoPaths = Array.isArray(result?.deleted_photo_paths)
      ? result.deleted_photo_paths
      : [];
    if (photoPaths.length) {
      await authClient.storage.from("process-record-photos").remove(photoPaths);
    }
    state.loadedDate = null;
    await loadSupplementalRecords({ force: true });
    const count = Number(result?.deleted_count || ids.length);
    setCategoryStatus(config, `${count} record${count === 1 ? "" : "s"} deleted.`);
  } catch (error) {
    setCategoryStatus(config, error.message || "Selected records could not be deleted.", "error");
    updateActionUi(key);
  }
}

function updateActionUi(key) {
  const config = CATEGORY_CONFIG[key];
  const category = state.categories[key];
  const selected = category.selected.size;
  const editing = category.editing.size > 0;
  const actions = els[`${config.prefix}Actions`];
  if (!actions) return;
  actions.hidden = !selected && !editing;
  els[`${config.prefix}SelectedCount`].textContent = `${selected} selected`;
  els[`${config.prefix}StartEdit`].hidden = editing;
  els[`${config.prefix}StartEdit`].disabled = !category.rows.some(
    (row) => category.selected.has(String(row.id)) && row.can_edit
  );
  els[`${config.prefix}DeleteSelected`].hidden = editing;
  els[`${config.prefix}DeleteSelected`].disabled = !category.rows.some(
    (row) => category.selected.has(String(row.id)) && row.can_delete
  );
  els[`${config.prefix}SaveEdits`].hidden = !editing;
  els[`${config.prefix}SaveEdits`].disabled = !category.dirty.size;
  els[`${config.prefix}DiscardEdits`].hidden = !editing;

  const eligible = category.rows.filter((row) => row.can_edit || row.can_delete);
  const selectedEligible = eligible.filter((row) => category.selected.has(String(row.id))).length;
  const selectAll = els[`${config.prefix}SelectAll`];
  if (selectAll) {
    selectAll.checked = eligible.length > 0 && selectedEligible === eligible.length;
    selectAll.indeterminate = selectedEligible > 0 && selectedEligible < eligible.length;
    selectAll.disabled = editing || !eligible.length;
  }
}

function resetEditState(key) {
  const category = state.categories[key];
  category.selected.clear();
  category.editing.clear();
  category.dirty.clear();
  category.drafts.clear();
  category.originals.clear();
}

function clearAllEditStates() {
  Object.keys(CATEGORY_CONFIG).forEach(resetEditState);
}

function draftFor(key, row) {
  if (key === "process-record") return processDraft(row);
  if (key === "site-sample") return siteSampleDraft(row);
  return stockDraft(row);
}

function processDraft(row) {
  return {
    start_time: shortTime(row.start_time),
    end_time: shortTime(row.end_time),
    species: row.species || "",
    received_seaweed_kg: nullableValue(row.received_seaweed_kg),
    blended_seaweed_kg: nullableValue(row.blended_seaweed_kg),
    wet_pulp_kg: nullableValue(row.wet_pulp_kg),
    pressed_liquid_l: nullableValue(row.pressed_liquid_l),
    dry_pulp_kg: nullableValue(row.dry_pulp_kg),
    lost_seaweed_kg: nullableValue(row.lost_seaweed_kg),
    number_of_presses: nullableValue(row.number_of_presses),
    recorded_by_name: row.recorded_by_name || "",
    notes: row.notes || ""
  };
}

function siteSampleDraft(row) {
  return {
    sample_time: timeInputValue(row.sampled_at),
    community_record_id: row.community_record_id || "",
    tide_stage: row.tide_stage || "",
    temperature_c: nullableValue(row.temperature_c),
    salinity_value: nullableValue(row.salinity_value),
    salinity_unit: row.salinity_unit || "PSU",
    tds_value: nullableValue(row.tds_value),
    tds_unit: row.tds_unit || "mg/L",
    electrical_conductivity_ms_cm: nullableValue(row.electrical_conductivity_ms_cm),
    e_coli_sample_taken: row.e_coli_sample_taken === null ? "" : String(Boolean(row.e_coli_sample_taken)),
    recorded_by_name: row.recorded_by_name || "",
    notes: row.notes || ""
  };
}

function stockDraft(row) {
  return {
    carton_serial: row.carton_serial || "",
    species: row.species || "",
    weight_value: nullableValue(row.weight_value),
    weight_unit: row.weight_unit || "L",
    stabilizer_added: String(Boolean(row.stabilizer_added)),
    chemical_dose_value: nullableValue(row.chemical_dose_value),
    chemical_dose_unit: row.chemical_dose_unit || "g/container",
    salinity_value: nullableValue(row.salinity_value),
    salinity_unit: row.salinity_unit || "PSU",
    ph_value: nullableValue(row.ph_value),
    electrical_conductivity_ms_cm: nullableValue(row.electrical_conductivity_ms_cm),
    recorded_by_name: row.recorded_by_name || "",
    notes: row.notes || ""
  };
}

function serializeDraft(key, row, draft) {
  const base = { id: row.id, expected_updated_at: row.updated_at };
  if (key === "process-record") {
    return {
      ...base,
      start_time: draft.start_time,
      end_time: draft.end_time,
      species: draft.species,
      received_seaweed_kg: numberOrNull(draft.received_seaweed_kg),
      blended_seaweed_kg: numberOrNull(draft.blended_seaweed_kg),
      wet_pulp_kg: numberOrNull(draft.wet_pulp_kg),
      pressed_liquid_l: numberOrNull(draft.pressed_liquid_l),
      dry_pulp_kg: numberOrNull(draft.dry_pulp_kg),
      lost_seaweed_kg: numberOrNull(draft.lost_seaweed_kg),
      number_of_presses: integerOrNull(draft.number_of_presses),
      recorded_by_name: draft.recorded_by_name.trim(),
      notes: textOrNull(draft.notes)
    };
  }
  if (key === "site-sample") {
    return {
      ...base,
      sampled_at: new Date(`${recordDate()}T${draft.sample_time}:00+03:00`).toISOString(),
      community_record_id: draft.community_record_id,
      tide_stage: textOrNull(draft.tide_stage),
      temperature_c: numberOrNull(draft.temperature_c),
      salinity_value: numberOrNull(draft.salinity_value),
      salinity_unit: draft.salinity_unit,
      tds_value: numberOrNull(draft.tds_value),
      tds_unit: draft.tds_unit,
      electrical_conductivity_ms_cm: numberOrNull(draft.electrical_conductivity_ms_cm),
      e_coli_sample_taken: draft.e_coli_sample_taken === "" ? null : draft.e_coli_sample_taken === "true",
      recorded_by_name: draft.recorded_by_name.trim(),
      notes: textOrNull(draft.notes)
    };
  }
  return {
    ...base,
    carton_serial: draft.carton_serial.trim(),
    species: draft.species,
    weight_value: numberOrNull(draft.weight_value),
    weight_unit: draft.weight_unit,
    stabilizer_added: draft.stabilizer_added === "true",
    chemical_dose_value: numberOrNull(draft.chemical_dose_value),
    chemical_dose_unit: draft.chemical_dose_unit,
    salinity_value: numberOrNull(draft.salinity_value),
    salinity_unit: draft.salinity_unit,
    ph_value: numberOrNull(draft.ph_value),
    electrical_conductivity_ms_cm: numberOrNull(draft.electrical_conductivity_ms_cm),
    recorded_by_name: draft.recorded_by_name.trim(),
    notes: textOrNull(draft.notes)
  };
}

function inputControl(key, id, field, value, type = "text", options = {}) {
  const attributes = [
    `type="${type}"`,
    `value="${escapeAttribute(value)}"`,
    `data-form-record-id="${escapeAttribute(id)}"`,
    `data-form-record-field="${escapeAttribute(field)}"`,
    options.required ? "required" : "",
    options.min !== undefined ? `min="${options.min}"` : "",
    options.max !== undefined ? `max="${options.max}"` : "",
    options.step !== undefined ? `step="${options.step}"` : "",
    options.maxlength ? `maxlength="${options.maxlength}"` : "",
    options.pattern ? `pattern="${escapeAttribute(options.pattern)}"` : ""
  ].filter(Boolean).join(" ");
  return `<input class="today-inline-editor form-record-inline-editor" ${attributes}>`;
}

function numberControl(key, id, field, value) {
  return inputControl(key, id, field, value, "number", { min: 0, step: 0.001 });
}

function selectControl(key, id, field, value, options) {
  return `<select class="today-inline-editor form-record-inline-editor" data-form-record-id="${escapeAttribute(id)}" data-form-record-field="${escapeAttribute(field)}">${options.map((option) => `<option value="${escapeAttribute(option.value)}" ${String(option.value) === String(value) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>`;
}

function speciesControl(key, id, value) {
  return selectControl(key, id, "species", value, state.species.map((row) => ({
    value: row.type_key,
    label: row.common_name ? `${row.label} (${row.common_name})` : row.label
  })));
}

function communityControl(key, id, value) {
  return selectControl(key, id, "community_record_id", value, state.communities.map((row) => ({
    value: row.id,
    label: `${row.community_id} - ${row.community_name}`
  })));
}

function tideControl(key, id, value) {
  return selectControl(key, id, "tide_stage", value, [
    { value: "", label: "Not set" },
    { value: "spring_low", label: "Spring low" },
    { value: "spring_high", label: "Spring high" }
  ]);
}

function booleanControl(key, id, field, value) {
  return selectControl(key, id, field, String(value), [
    { value: "", label: "Not set" },
    { value: "true", label: "Yes" },
    { value: "false", label: "No" }
  ]);
}

function measurementEditor(key, id, valueField, value, unitField, unit, units, required = false) {
  return `<span class="form-record-measure-editor">${inputControl(key, id, valueField, value, "number", { min: required ? 0.001 : 0, step: 0.001, required })}${selectControl(key, id, unitField, unit, units.map((item) => ({ value: item, label: item })))}</span>`;
}

function recordDate() {
  if (els.todayIntakeDate?.matches("input[type='date']") && els.todayIntakeDate.value) {
    return els.todayIntakeDate.value;
  }
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Africa/Nairobi"
  }).format(new Date());
}

function keyForConfig(config) {
  return Object.keys(CATEGORY_CONFIG).find((key) => CATEGORY_CONFIG[key] === config);
}

function returnPage() {
  const file = window.location.pathname.split("/").pop() || "today.html";
  return `${file}${window.location.search}`;
}

function categoryLabel(key) {
  if (key === "process-record") return "Process records";
  if (key === "site-sample") return "Site samples";
  return "Stock records";
}

function stockEntryLabel(row) {
  const type = row.record_type === "retest" ? "Retest" : "New";
  return row.test_sequence ? `${type} ${row.test_sequence}` : type;
}

function speciesLabel(value) {
  const match = state.species.find((row) => row.type_key === value);
  return match?.label || titleCase(value);
}

function tideLabel(value) {
  if (value === "spring_low") return "Spring low";
  if (value === "spring_high") return "Spring high";
  return "-";
}

function booleanLabel(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "-";
}

function measurement(value, unit) {
  const number = formatNumber(value);
  return number === "-" ? "-" : `${number}${unit ? ` ${unit}` : ""}`;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-KE", { maximumFractionDigits: 3 })
    : "-";
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-KE", {
    hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi"
  }).format(date);
}

function timeInputValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi"
  }).format(date);
}

function shortTime(value) {
  return String(value || "").slice(0, 5);
}

function joinValues(...values) {
  return values.filter(Boolean).join(" - ") || "-";
}

function titleCase(value) {
  return String(value || "-").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nullableValue(value) {
  return value === null || value === undefined ? "" : String(value);
}

function numberOrNull(value) {
  if (String(value ?? "").trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.trunc(number);
}

function textOrNull(value) {
  return String(value || "").trim() || null;
}

function draftsEqual(first, second) {
  return JSON.stringify(first || {}) === JSON.stringify(second || {});
}

function rowClass(editing, dirty) {
  return [editing ? "today-row-editing" : "", dirty ? "today-row-dirty" : ""]
    .filter(Boolean)
    .join(" ");
}

function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}" class="empty-state">${message}</td></tr>`;
}

function setCategoryStatus(config, message, type = "") {
  const element = els[`${config.prefix}Status`];
  if (!element) return;
  element.textContent = message || "";
  if (type) element.dataset.status = type;
  else delete element.dataset.status;
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
