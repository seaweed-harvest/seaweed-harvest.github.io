import {
  authClient,
  currentProfile,
  setupAccountControls
} from "./auth_client.js?v=25";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=15";

import { mkwiroRaftDisplayLabel } from "./reef_mkwiro_raft_labels.js?v=3";
import { initializeSampleRopeDataTable } from "./reef_sample_rope_data_table.js?v=2";

const PAGE_SIZE = 50;
const LOCATION_LABELS = Object.freeze({
  mkwiro: "Mkwiro",
  tumbe: "Tumbe",
  tumbe_offshore: "Tumbe - Offshore Nursery Site",
  tumbe_shore: "Tumbe - Shore",
  mkwiro_offshore: "Mkwiro - Offshore Nursery Site",
  mkwiro_shore: "Mkwiro - Shore"
});
const KIND_LABELS = Object.freeze({
  site_capture: "Site Capture",
  sample_rope_register: "Sample Rope Register",
  legacy_seaweed: "Legacy Seaweed"
});

const state = {
  profile: null,
  search: "",
  page: 0,
  total: 0,
  rows: [],
  loading: false,
  deleting: false,
  canDelete: false,
  selectedRecords: new Map(),
  ropeGrid: null
};
const els = {};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  void init();
}

async function init() {
  cacheElements();
  try {
    // The Reef workspace resolves COSME scope for public visitors without
    // granting any ability to edit or delete records.
    const { data: context, error } = await authClient.rpc("ag_reef_training_workspace_context");
    if (error) throw error;
    if (!context?.allowed) throw new Error(context?.reason || "Nursery records are unavailable.");
    if (context.access_mode === "authenticated") {
      state.profile = await currentProfile();
      state.canDelete = Boolean(state.profile?.is_protected_owner);
    }
    const dashboardHref = state.profile ? "./home.html" : "./reef_nursery.html";
    const sidebar = populateAppSidebar(els.reefSeaweedRecordsSidebar, {
      profile: state.profile, dashboardHref, currentFile: "reef_seaweed_records.html"
    });
    if (state.profile) setupAccountControls(state.profile);
    setupAppNavigation({ profile: state.profile, sidebar, dashboardHref });
    bindEvents();
    state.ropeGrid = initializeSampleRopeDataTable({ authClient, root: els.reefSampleRopeDataTabPanel });
    const flatTabRequested = window.location.hash === "#sample-rope-data";
    selectRecordsTab(flatTabRequested ? "data" : "records");
    document.body.removeAttribute("data-auth-pending");
    await loadRecords();
  } catch (error) {
    // Never silently redirect a public visitor to a sign-in screen.
    document.body.removeAttribute("data-auth-pending");
    setStatus(error.message || "Nursery records could not be opened.", "error");
  }
}

function cacheElements() {
  [
    "reefSeaweedRecordsSidebar",
    "reloadReefSeaweedRecords",
    "reefSeaweedRecordsSearch",
    "reefRecordsListTab",
    "reefSampleRopeDataTab",
    "reefRecordsListPanel",
    "reefSampleRopeDataTabPanel",
    "searchReefSeaweedRecords",
    "clearReefSeaweedRecordsSearch",
    "reefSeaweedRecordRows",
    "previousReefSeaweedRecords",
    "reefSeaweedRecordsPage",
    "nextReefSeaweedRecords",
    "reefSeaweedRecordsStatus",
    "reefSeaweedRecordDetail",
    "reefSeaweedRecordDetailTitle",
    "closeReefSeaweedRecordDetail",
    "reefSeaweedRecordDetailStatus",
    "reefSeaweedRecordDetailContent"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  els.reloadReefSeaweedRecords.addEventListener("click", () => loadRecords());
  els.searchReefSeaweedRecords.addEventListener("click", applySearch);
  els.clearReefSeaweedRecordsSearch.addEventListener("click", () => {
    els.reefSeaweedRecordsSearch.value = "";
    applySearch();
  });
  els.reefSeaweedRecordsSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applySearch();
  });
  els.previousReefSeaweedRecords.addEventListener("click", () => changePage(-1));
  els.nextReefSeaweedRecords.addEventListener("click", () => changePage(1));
  els.reefSeaweedRecordRows.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-reef-seaweed-record]");
    if (deleteButton) {
      void deleteRecord(
        deleteButton.dataset.kind,
        deleteButton.dataset.key,
        deleteButton.dataset.number
      );
      return;
    }

    const button = event.target.closest("[data-open-reef-seaweed-record]");
    if (!button) return;
    void openRecord(button.dataset.kind, button.dataset.key, button.dataset.number);
  });
  els.reefSeaweedRecordRows.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-select-reef-record]");
    if (!checkbox) return;
    toggleSelectedRecord(checkbox.dataset.kind, checkbox.dataset.key,
      checkbox.dataset.number, checkbox.checked);
  });
  els.reefSeaweedRecordDetailContent.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-reef-selection]");
    if (!remove) return;
    removeSelectedRecord(remove.dataset.removeReefSelection);
  });
  els.closeReefSeaweedRecordDetail.addEventListener("click", closeDetail);
  els.reefRecordsListTab.addEventListener("click", () => selectRecordsTab("records"));
  els.reefSampleRopeDataTab.addEventListener("click", () => selectRecordsTab("data"));
}

function selectRecordsTab(selected) {
  const dataTab = selected === "data";
  els.reefRecordsListPanel.hidden = dataTab;
  els.reefSampleRopeDataTabPanel.hidden = !dataTab;
  els.reefRecordsListTab.setAttribute("aria-selected", String(!dataTab));
  els.reefSampleRopeDataTab.setAttribute("aria-selected", String(dataTab));
  els.reefRecordsListTab.classList.toggle("is-active", !dataTab);
  els.reefSampleRopeDataTab.classList.toggle("is-active", dataTab);
  if (dataTab && state.ropeGrid && !state.ropeGrid.state.loaded) void state.ropeGrid.refresh();
}

async function loadRecords() {
  if (state.loading) return;
  state.loading = true;
  setLoading(true);
  setStatus("Loading seaweed records...");
  try {
    const listRpc = state.profile
      ? "ag_reef_seaweed_records_page"
      : "ag_public_cosme_reef_seaweed_records_page";
    const { data, error } = await authClient.rpc(listRpc, {
      p_search: state.search || null,
      p_limit: PAGE_SIZE,
      p_offset: state.page * PAGE_SIZE
    });
    if (error) throw error;
    state.rows = Array.isArray(data) ? data : [];
    state.total = Number(state.rows[0]?.total_count || 0);
    if (state.page > 0 && !state.rows.length && state.total > 0) {
      state.page = Math.max(0, Math.ceil(state.total / PAGE_SIZE) - 1);
      state.loading = false;
      setLoading(false);
      await loadRecords();
      return;
    }
    renderRows();
    setStatus("");
  } catch (error) {
    state.rows = [];
    state.total = 0;
    renderRows();
    setStatus(error.message || "Seaweed records could not be loaded.", "error");
  } finally {
    state.loading = false;
    setLoading(false);
  }
}

function renderRows() {
  if (!state.rows.length) {
    els.reefSeaweedRecordRows.innerHTML = '<tr><td colspan="9" class="empty-state">No matching seaweed records found.</td></tr>';
  } else {
    els.reefSeaweedRecordRows.innerHTML = state.rows.map((record) => {
      const kindClass = record.record_kind === "sample_rope_register"
        ? " is-sample"
        : record.record_kind === "legacy_seaweed" ? " is-legacy" : "";
      const site = formatSite(record);
      const details = [record.summary, record.recorded_by_name].filter(Boolean).join(" · ");
      return `
        <tr>
          <td data-label="Show"><input type="checkbox" data-select-reef-record data-kind="${escapeHtml(record.record_kind)}" data-key="${escapeHtml(record.record_key)}" data-number="${escapeHtml(record.record_number || "")}" aria-label="Show ${escapeHtml(record.record_number || KIND_LABELS[record.record_kind] || "record")}" ${state.selectedRecords.has(selectionKey(record.record_kind, record.record_key)) ? "checked" : ""}></td>
          <td data-label="Type"><span class="reef-record-kind${kindClass}">${escapeHtml(KIND_LABELS[record.record_kind] || humanize(record.record_kind))}</span></td>
          <td data-label="Record"><strong>${escapeHtml(record.record_number || "-")}</strong></td>
          <td data-label="Date">${escapeHtml(formatDate(record.record_date))}</td>
          <td data-label="Location / Site">${escapeHtml(site)}</td>
          <td data-label="Species">${escapeHtml(record.species || "-")}</td>
          <td data-label="Details">${escapeHtml(details || "-")}</td>
          <td data-label="Updated">${escapeHtml(formatDateTime(record.updated_at))}</td>
          <td>${recordActions(record)}</td>
        </tr>`;
    }).join("");
  }

  const start = state.total ? state.page * PAGE_SIZE + 1 : 0;
  const end = Math.min((state.page + 1) * PAGE_SIZE, state.total);
  els.reefSeaweedRecordsPage.textContent = state.total ? `${start}-${end} of ${state.total}` : "0 records";
  els.previousReefSeaweedRecords.disabled = state.loading || state.page === 0;
  els.nextReefSeaweedRecords.disabled = state.loading || end >= state.total;
}

function recordActions(record) {
  const open = `<button type="button" data-open-reef-seaweed-record data-kind="${escapeHtml(record.record_kind)}" data-key="${escapeHtml(record.record_key)}" data-number="${escapeHtml(record.record_number || "")}">Open</button>`;
  if (!state.canDelete) return `<div class="reef-record-actions">${open}</div>`;
  const remove = `<button class="reef-delete-record-button" type="button" data-delete-reef-seaweed-record data-kind="${escapeHtml(record.record_kind)}" data-key="${escapeHtml(record.record_key)}" data-number="${escapeHtml(record.record_number || "")}">Delete</button>`;
  return `<div class="reef-record-actions">${open}${remove}</div>`;
}

function applySearch() {
  state.search = els.reefSeaweedRecordsSearch.value.trim();
  state.page = 0;
  void loadRecords();
}

function changePage(direction) {
  const next = state.page + direction;
  if (next < 0 || next * PAGE_SIZE >= state.total) return;
  state.page = next;
  void loadRecords();
}

function selectionKey(kind, key) {
  return `${kind}:${key}`;
}

function syncSelectionCheckboxes() {
  document.querySelectorAll("[data-select-reef-record], [data-select-reef-site]").forEach((input) => {
    const kind = input.dataset.kind || "sample_rope_register";
    const key = input.dataset.key || input.dataset.selectReefSite;
    input.checked = state.selectedRecords.has(selectionKey(kind, key));
  });
}

function toggleSelectedRecord(kind, key, recordNumber, selected) {
  if (!kind || !key) return;
  if (!["sample_rope_register", "site_capture", "legacy_seaweed"].includes(kind)) return;
  if (!selected) {
    removeSelectedRecord(selectionKey(kind, key));
    return;
  }
  const id = selectionKey(kind, key);
  if (state.selectedRecords.has(id)) {
    syncSelectionCheckboxes();
    return;
  }
  const item = { id, kind, key, recordNumber: recordNumber || key, status: "loading", html: "" };
  state.selectedRecords.set(id, item);
  renderSelectedRecords();
  syncSelectionCheckboxes();
  void loadSelectedRecord(item);
}

function openRecord(kind, key, recordNumber) {
  toggleSelectedRecord(kind, key, recordNumber, true);
}

function removeSelectedRecord(id) {
  state.selectedRecords.delete(id);
  syncSelectionCheckboxes();
  renderSelectedRecords();
}

function renderSelectedRecords() {
  const selected = [...state.selectedRecords.values()];
  els.reefSeaweedRecordDetail.hidden = selected.length === 0;
  if (!selected.length) {
    els.reefSeaweedRecordDetailContent.replaceChildren();
    setDetailStatus("");
    return;
  }
  els.reefSeaweedRecordDetailTitle.textContent = `Selected records (${selected.length})`;
  els.reefSeaweedRecordDetailContent.innerHTML = `
    <div class="reef-selected-records-grid">
      ${selected.map((item) => `<section class="reef-selected-record-card" data-selected-id="${escapeHtml(item.id)}">
        <div class="reef-selected-record-card-heading">
          <h4>${escapeHtml(item.recordNumber)}</h4>
          <button type="button" data-remove-reef-selection="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.recordNumber)} from view">Remove</button>
        </div>
        ${item.status === "loading" ? '<p class="field-hint">Loading record…</p>' :
          item.status === "error" ? `<p class="admin-status" data-status="error">${escapeHtml(item.message || "Could not load record.")}</p>` : item.html}
        ${selected.length === 1 && item.kind === "sample_rope_register" && item.status === "ready"
          ? (item.photoStatus === "ready" ? item.photoHtml
            : item.photoStatus === "error" ? `<p class="admin-status" data-status="error">${escapeHtml(item.photoError || "Photos unavailable.")}</p>`
            : '<p class="field-hint">Loading stage photos…</p>') : ""}
      </section>`).join("")}
    </div>`;
  // Photos intentionally load only when precisely one register is selected;
  // comparison views remain compact even when several sites have photos.
  if (selected.length === 1 && selected[0].kind === "sample_rope_register" &&
      selected[0].status === "ready" && !selected[0].photoStatus) {
    void loadSingleRegisterPhotos(selected[0]);
  }
}

async function loadSingleRegisterPhotos(item) { 
  item.photoStatus = "loading";
  const stageLabels = {initial:"Initial",week_2:"Week 2",week_4:"Week 4",week_6:"Week 6"};
  try {
    const {data,error}=await authClient.rpc("ag_reef_sample_rope_stage_photos",{p_site_code:item.key});
    if(error) throw error;
    const photos=Array.isArray(data)?data:[];
    if(!photos.length) {
      item.photoHtml="";
    } else {
      const ready=await Promise.all(photos.map(async photo=>{
        const result=await authClient.storage.from("reef-seaweed-record-photos")
          .createSignedUrl(photo.storage_path,3600);
        if(result.error) throw result.error;
        return {...photo,url:result.data.signedUrl};
      }));
      item.photoHtml=`<section class="reef-rope-photo-gallery">
        <h5>Stage photos</h5>
        ${["initial","week_2","week_4","week_6"].map(stage=>{
          const group=ready.filter(photo=>photo.stage===stage);
          if(!group.length) return "";
          return `<div class="reef-rope-photo-stage">
            <h6>${stageLabels[stage]}</h6>
            <div class="reef-rope-photo-thumbnails">${group.map(photo=>
              `<a href="${escapeHtml(photo.url)}" target="_blank" rel="noopener noreferrer">
                <img loading="lazy" src="${escapeHtml(photo.url)}" alt="${escapeHtml(stageLabels[stage])} Sample Rope photo dated ${escapeHtml(photo.date)}">
                <small>${escapeHtml(formatDate(photo.date))}</small>
              </a>`).join("")}</div>
          </div>`;
        }).join("")}
      </section>`;
    }
    item.photoStatus="ready";
  } catch(error){
    item.photoStatus="error";
    item.photoError=error.message || "Could not load photo attachments.";
  }
  if(state.selectedRecords.get(item.id)===item) renderSelectedRecords();
}

async function loadSelectedRecord(item) {
  try {
    let html;
    if (item.kind === "sample_rope_register") {
      html = await loadSampleRegisterCard(item.key);
      item.recordNumber = mkwiroRaftDisplayLabel(item.key) || item.recordNumber;
    } else if (item.kind === "site_capture") {
      html = await loadSiteCaptureCard(item.key);
    } else {
      // Legacy entries are read-only public summaries, not editable records.
      const record = state.rows.find((row) => row.record_kind === item.kind && row.record_key === item.key);
      html = [
        detailItem("Date", formatDate(record?.record_date)),
        detailItem("Location", LOCATION_LABELS[record?.location] || humanize(record?.location)),
        detailItem("Species", record?.species),
        detailItem("Recorded by", record?.recorded_by_name),
        detailItem("Summary", record?.summary)
      ].join("");
      if (state.profile) {
        html += `<p><a href="./reef_nursery.html?tab=seaweed&seaweed_record=${encodeURIComponent(item.key)}">Open original record</a></p>`;
      }
    }
    if (state.selectedRecords.get(item.id) !== item) return;
    item.html = html;
    item.status = "ready";
  } catch (error) {
    if (state.selectedRecords.get(item.id) !== item) return;
    item.message = error?.message || "Could not load record.";
    item.status = "error";
  }
  renderSelectedRecords();
}

async function loadSiteCaptureCard(captureId) {
  const { data, error } = await authClient.rpc(
    state.profile ? "ag_reef_site_capture_record_detail" : "ag_public_cosme_reef_site_capture_detail", {
    p_capture_id: captureId
  });
  if (error) throw error;
  const record = Array.isArray(data) ? data[0] : data;
  if (!record) throw new Error("Seaweed Site Capture was not found.");


  const health = record.health_environment && typeof record.health_environment === "object"
    ? record.health_environment
    : {};
  const condition = health.condition && typeof health.condition === "object" ? health.condition : {};
  const observations = Array.isArray(health.health_observations) ? health.health_observations : [];
  const environment = health.environment && typeof health.environment === "object" ? health.environment : {};
  const conditionSummary = Object.entries(condition)
    .filter(([, value]) => value?.rating)
    .map(([key, value]) => `${humanize(key)}: ${humanize(value.rating)}${value.note ? ` (${value.note})` : ""}`)
    .join("; ");
  const environmentSummary = Object.entries(environment)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `${humanize(key)}: ${value}`)
    .join("; ");

  return `
    <div class="reef-detail-grid">
      ${detailItem("Date / time", formatDateTime(record.observed_at))}
      ${detailItem("Location", LOCATION_LABELS[record.location] || humanize(record.location))}
      ${detailItem("Site", mkwiroRaftDisplayLabel(record.site_code, record.site_name) || [record.site_code, record.site_name].filter(Boolean).join(" - "))}
      ${detailItem("Recorder", record.recorded_by_name)}
      ${detailItem("Monitoring team", record.monitoring_team === "other" ? record.monitoring_team_other : humanize(record.monitoring_team))}
      ${detailItem("Species", humanize(record.species))}
      ${detailItem("Number of lines", record.line_count)}
      ${detailItem("Seed total weight", formatWeight(record.seed_weight_value, record.seed_weight_unit))}
      ${detailItem("Harvest total weight", formatWeight(record.harvest_weight_value, record.harvest_weight_unit))}
    </div>
    ${conditionSummary ? detailSection("Seaweed condition", conditionSummary) : ""}
    ${observations.length ? detailSection("Health observations", observations.map(humanize).join(", ")) : ""}
    ${environmentSummary ? detailSection("Environment", environmentSummary) : ""}
    ${record.general_notes ? detailSection("General notes", record.general_notes) : ""}
    ${record.photo ? detailSection("Photo", record.photo.original_name || "Photo attached") : ""}`;
}

async function loadSampleRegisterCard(siteCode) {
  const { data, error } = await authClient.rpc("ag_reef_sample_rope_register", {
    p_site_code: siteCode
  });
  if (error) throw error;
  return renderSampleRegisterCard(data || {}, siteCode, null);
}

const SAMPLE_MEASUREMENT_STAGES = Object.freeze([
  ["initial", "Initial Weight (kg)", "initial_weight_kg", "date_seeded"],
  ["week_2", "Wk2", "week_2_kg", "week_2_date"],
  ["week_4", "Wk4", "week_4_kg", "week_4_date"],
  ["week_6", "Wk6", "week_6_kg", "week_6_date"]
]);

function measurementDate(row, stage, dateKey) {
  return row[dateKey] || row.measurement_provenance?.[stage]?.date || null;
}

function sampleStageHeading([stage, label]) {
  return `<th class="reef-register-stage-heading" data-stage="${escapeHtml(stage)}">${escapeHtml(label)}</th>`;
}

function sampleStageDateHeading(rows, [stage, , weightKey, dateKey]) {
  const measured = rows.filter(row => row[weightKey] !== null && row[weightKey] !== undefined && row[weightKey] !== "");
  const dates = [...new Set(measured.map(row => measurementDate(row, stage, dateKey)).filter(Boolean))];
  const missing = measured.some(row => !measurementDate(row, stage, dateKey));
  const label = !dates.length ? "—" : dates.length > 1 ? "Multiple dates" :
    `${formatDate(dates[0])}${missing ? " (some undated)" : ""}`;
  const title = dates.length > 1 ? ` title="${escapeHtml(dates.map(formatDate).join(", "))}"` : "";
  return `<th class="reef-register-date-cell"${title}>${escapeHtml(label)}</th>`;
}

function sampleStageCell(row, [stage, , weightKey, dateKey]) {
  const date = measurementDate(row, stage, dateKey);
  return `<td${date ? ` title="${escapeHtml(formatDate(date))}"` : ""}>${escapeHtml(displayNumber(row[weightKey]))}</td>`;
}

function renderSampleRegisterCard(register, code, kindLabel) {
  const rows = Array.isArray(register.rows) ? register.rows : [];
  const name = mkwiroRaftDisplayLabel(register.site_code || code, register.site_name)
    || [register.site_code || code, register.site_name].filter(Boolean).join(" - ");
  const hasMeasurements = rows.some((row) =>
    SAMPLE_MEASUREMENT_STAGES.some(([, , field]) => row[field] !== null && row[field] !== undefined && row[field] !== "")
  );
  return `<section class="reef-sample-comparison-card" aria-label="${escapeHtml(name)} Sample Rope Register">
    <div class="reef-sample-comparison-head">
      ${kindLabel ? `<span class="reef-record-kind is-sample">${escapeHtml(kindLabel)}</span>` : ""}
      <p class="field-hint">${escapeHtml(LOCATION_LABELS[register.location] || humanize(register.location))} · ${escapeHtml(humanize(register.structure_type || ""))}</p>
    </div>
    ${!hasMeasurements ? '<p class="reef-sample-empty-note">No rope measurements recorded yet for this site.</p>' : ""}
    <div class="responsive-table-wrap reef-sample-card-table-wrap">
      <table class="management-table admin-data-table reef-sample-detail-table">
        <thead>
          <tr><th rowspan="2">Sample Rope</th><th rowspan="2">Species</th>
            <th rowspan="2">Rope Weight (kg)</th>
            ${SAMPLE_MEASUREMENT_STAGES.map(sampleStageHeading).join("")}
            <th rowspan="2">Previous cycles</th>
          </tr>
          <tr class="reef-register-date-row">
            ${SAMPLE_MEASUREMENT_STAGES.map(stage => sampleStageDateHeading(rows, stage)).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map((row) => `<tr>
            <td>Rope ${escapeHtml(row.rope_number)}</td>
            <td>${escapeHtml(row.species ? humanize(row.species) : "-")}</td>
            <td>${escapeHtml(displayNumber(row.rope_weight_kg))}</td>
            ${SAMPLE_MEASUREMENT_STAGES.map((stage) => sampleStageCell(row, stage)).join("")}
            <td>${escapeHtml(String(row.history_count || 0))}</td>
          </tr>`).join("") : '<tr><td colspan="8" class="empty-state">No sample ropes available.</td></tr>'}
        </tbody>
      </table>
    </div>
  </section>`;
}

async function deleteRecord(kind, key, recordNumber) {
  if (!state.canDelete || state.deleting || !kind || !key) return;

  const label = recordNumber || KIND_LABELS[kind] || "this record";
  const confirmed = window.confirm(
    `Delete ${label}?\n\nThis record will be removed from active Nursery - Seaweed records. It can be recovered administratively if deleted by mistake.`
  );
  if (!confirmed) return;

  state.deleting = true;
  setStatus(`Deleting ${label}...`);
  try {
    const { error } = await authClient.rpc("ag_reef_seaweed_records_page_delete", {
      p_record_kind: kind,
      p_record_key: key
    });
    if (error) throw error;

    if (state.selectedRecords.has(selectionKey(kind, key))) removeSelectedRecord(selectionKey(kind, key));
    await loadRecords();
    setStatus(`${label} deleted.`, "success");
  } catch (error) {
    const message = error?.message || `${label} could not be deleted.`;
    if (/already been deleted|not found/i.test(message)) {
      await loadRecords();
      setStatus(`${label} is no longer in active records.`, "success");
    } else {
      setStatus(message, "error");
    }
  } finally {
    state.deleting = false;
  }
}

function closeDetail() {
  state.selectedRecords.clear();
  syncSelectionCheckboxes();
  renderSelectedRecords();
}

function setLoading(loading) {
  els.reloadReefSeaweedRecords.disabled = loading;
  els.searchReefSeaweedRecords.disabled = loading;
  els.clearReefSeaweedRecordsSearch.disabled = loading;
  els.reefSeaweedRecordsSearch.disabled = loading;
  if (loading) {
    els.previousReefSeaweedRecords.disabled = true;
    els.nextReefSeaweedRecords.disabled = true;
  }
}

function setStatus(message, kind = "") {
  els.reefSeaweedRecordsStatus.textContent = message || "";
  if (kind) els.reefSeaweedRecordsStatus.dataset.status = kind;
  else delete els.reefSeaweedRecordsStatus.dataset.status;
}

function setDetailStatus(message, kind = "") {
  els.reefSeaweedRecordDetailStatus.textContent = message || "";
  if (kind) els.reefSeaweedRecordDetailStatus.dataset.status = kind;
  else delete els.reefSeaweedRecordDetailStatus.dataset.status;
}

function formatSite(record) {
  if (record.site_code) {
    const prefix = LOCATION_LABELS[record.location] || humanize(record.location);
    const site = mkwiroRaftDisplayLabel(record.site_code, record.site_name) || [record.site_code, record.site_name].filter(Boolean).join(" - ");
    return [prefix, site].filter(Boolean).join(" · ");
  }
  return LOCATION_LABELS[record.location] || humanize(record.location) || "-";
}

function detailItem(label, value) {
  const display = value === null || value === undefined || value === "" ? "-" : String(value);
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(display)}</strong></div>`;
}

function detailSection(title, value) {
  return `<section class="reef-detail-section"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(value)}</p></section>`;
}

function formatWeight(value, unit) {
  if (value === null || value === undefined || value === "") return "-";
  return `${displayNumber(value)} ${unit || "kg"}`;
}

function displayNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString("en-GB", { maximumFractionDigits: 3 });
}

function formatDate(value) {
  if (!value) return "-";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T12:00:00+03:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function humanize(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}
