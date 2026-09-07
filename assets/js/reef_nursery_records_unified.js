import { authClient } from "./auth_client.js?v=25";
import { openPhotoPreview, signedPhotoUrl } from "./photo_viewer.js?v=1";
import {
  isCombinedReefRecord, formatSessionTime, competencyBadge,
  reportPhotosMarkup, loadReportThumbnails
} from "./reef_nursery_report_enhancements.js?v=2";

const PAGE_SIZE = 50;
const PHOTO_BUCKET = "reef-nursery-photos";
const TYPE_LABELS = Object.freeze({
  training: "Training",
  seaweed: "Seaweed",
  inspection: "Inspection",
  legacy: "Combined Reef record"
});
const LOCATION_LABELS = Object.freeze({
  mkwiro: "Mkwiro",
  offshore_nursery: "Offshore nursery site",
  shoreline_preparation: "Shoreline preparation area",
  tumbe_offshore: "Tumbe – Offshore Nursery Site",
  tumbe_shore: "Tumbe – Shore",
  mkwiro_offshore: "Mkwiro – Offshore Nursery Site",
  mkwiro_shore: "Mkwiro – Shore"
});
const SESSION_TYPE_LABELS = Object.freeze({
  general_in_water_training: "General in-water training",
  seeding: "Seeding",
  harvesting: "Harvesting",
  line_inspection_maintenance: "Line inspection and maintenance",
  mooring_inspection_maintenance: "Mooring inspection and maintenance",
  nursery_deployment_recovery: "Nursery deployment / recovery",
  other: "Other",
  nursery_deployment: "Nursery deployment",
  boat_water_safety: "Boat and water safety",
  refresher_training: "Refresher training"
});

const state = {
  accessMode: "denied",
  canManageUsers: false,
  search: "",
  recordType: "all",
  page: 0,
  total: 0,
  rows: [],
  loading: false,
  panel: null,
  detailSequence: 0
};
const els = {};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  void init();
}

async function init() {
  state.panel = document.querySelector('[data-reef-training-panel="records"]');
  if (!state.panel) return;

  injectStylesheet();
  replaceLegacyRecordsSurface();
  cacheElements();
  bindEvents();

  try {
    const context = await rpc("ag_reef_records_workspace_context");
    if (!context?.allowed) return;
    state.accessMode = context.access_mode || "public";
    state.canManageUsers = Boolean(context.can_manage_users);
    configureAccess(context);

    const params = new URLSearchParams(window.location.search);
    const requestedLegacyRecord = params.get("legacy_record");
    if (params.get("tab") === "records" || requestedLegacyRecord) {
      await waitForTrainingWorkspace();
      document.querySelector('[data-reef-training-tab="records"]')?.click();
      if (requestedLegacyRecord) await openLegacyDetail(requestedLegacyRecord);
      else await loadRecords();
    }
  } catch (error) {
    setStatus(error.message || "Previous Records could not be opened.", "error");
  }
}

function injectStylesheet() {
  const href = new URL("../css/reef_nursery_wp04.css?v=2", import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}

function replaceLegacyRecordsSurface() {
  state.panel.dataset.reefUnifiedRecords = "true";
  state.panel.innerHTML = `
    <div class="reef-panel-heading reef-unified-heading">
      <div>
        <p class="eyebrow">All Reef record types</p>
        <h2>Previous Records</h2>
        <p id="reefUnifiedRecordsAccessHelp" class="reef-help"></p>
      </div>
      <div class="reef-unified-heading-actions">
        <a id="reefUnifiedManageAccounts" class="secondary-action" href="./admin_users.html" hidden>Manage Reef accounts</a>
        <button id="reefUnifiedRecordsRefresh" class="secondary-action" type="button">Refresh</button>
      </div>
    </div>

    <section id="reefUnifiedAccountNote" class="reef-unified-account-note" hidden>
      <strong>Existing Seaweed Harvest accounts</strong>
      <span>Use the existing invite, temporary-password and password-reset tools. Reef access and Dryer Table access are assigned separately for COSME members.</span>
    </section>

    <div class="reef-unified-records-toolbar">
      <label>Record type
        <select id="reefUnifiedRecordsType">
          <option value="all">All records</option>
          <option value="training">Training</option>
          <option value="seaweed">Seaweed</option>
          <option value="inspection">Inspection</option>
          <option value="legacy">Combined Reef records</option>
        </select>
      </label>
      <label>Search
        <input id="reefUnifiedRecordsSearch" type="search" placeholder="Record, person, location or details" autocomplete="off">
      </label>
      <button id="reefUnifiedRecordsSearchButton" type="button">Search</button>
    </div>

    <p id="reefUnifiedRecordsStatus" class="reef-status" aria-live="polite"></p>
    <div class="reef-record-table-wrap">
      <table class="reef-record-table reef-unified-record-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Record</th>
            <th>Date</th>
            <th>Location</th>
            <th>Person / details</th>
            <th>Access</th>
            <th><span class="visually-hidden">Open</span></th>
          </tr>
        </thead>
        <tbody id="reefUnifiedRecordsBody"></tbody>
      </table>
    </div>
    <div class="reef-records-pagination">
      <button id="reefUnifiedRecordsPrevious" class="secondary-action" type="button">Previous</button>
      <span id="reefUnifiedRecordsPage">0 records</span>
      <button id="reefUnifiedRecordsNext" class="secondary-action" type="button">Next</button>
    </div>

    <article id="reefLegacyRecordDetail" class="reef-legacy-record-detail" hidden>
      <div class="reef-panel-heading">
        <div>
          <p id="reefReportKind" class="eyebrow">Reef record report</p>
          <h3 id="reefLegacyRecordTitle">Reef record</h3>
        </div>
        <div class="reef-unified-heading-actions">
          <a id="reefReportEdit" class="secondary-action" hidden>Edit Training record</a>
          <button id="reefLegacyRecordClose" class="secondary-action" type="button">Close</button>
        </div>
      </div>
      <p id="reefLegacyRecordStatus" class="reef-status" aria-live="polite"></p>
      <div id="reefLegacyRecordContent"></div>
    </article>`;
}

function cacheElements() {
  [
    "reefUnifiedRecordsAccessHelp", "reefUnifiedManageAccounts", "reefUnifiedRecordsRefresh",
    "reefUnifiedAccountNote", "reefUnifiedRecordsType", "reefUnifiedRecordsSearch",
    "reefUnifiedRecordsSearchButton", "reefUnifiedRecordsStatus", "reefUnifiedRecordsBody",
    "reefUnifiedRecordsPrevious", "reefUnifiedRecordsPage", "reefUnifiedRecordsNext",
    "reefLegacyRecordDetail", "reefLegacyRecordTitle", "reefLegacyRecordClose",
    "reefLegacyRecordStatus", "reefLegacyRecordContent", "reefReportKind", "reefReportEdit"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  document.querySelector('[data-reef-training-tab="records"]')?.addEventListener("click", () => {
    queueMicrotask(() => { void loadRecords(); });
  });
  els.reefUnifiedRecordsRefresh.addEventListener("click", () => loadRecords());
  els.reefUnifiedRecordsSearchButton.addEventListener("click", searchRecords);
  els.reefUnifiedRecordsSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchRecords();
  });
  els.reefUnifiedRecordsType.addEventListener("change", () => {
    state.recordType = els.reefUnifiedRecordsType.value;
    state.page = 0;
    void loadRecords();
  });
  els.reefUnifiedRecordsBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-unified-record]");
    if (button) void openRecord(button.dataset.recordType, button.dataset.recordId);
  });
  els.reefUnifiedRecordsPrevious.addEventListener("click", () => changePage(-1));
  els.reefUnifiedRecordsNext.addEventListener("click", () => changePage(1));
  els.reefLegacyRecordClose.addEventListener("click", closeLegacyDetail);
  els.reefLegacyRecordContent.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reef-report-photo]");
    if (button) void openPhotoPreview(
      [button.dataset.reefReportPhoto], PHOTO_BUCKET, button.dataset.photoName || "Reef record photo"
    );
  });
}

function configureAccess(context) {
  const authenticated = state.accessMode === "authenticated";
  els.reefUnifiedRecordsAccessHelp.textContent = authenticated
    ? "Signed-in COSME Reef access shows the complete live history for Training, Seaweed, Inspection and combined Reef records."
    : "Records created during the last 7 days are openly listed and editable. Older records require an authorised COSME Reef account.";
  els.reefUnifiedManageAccounts.hidden = !state.canManageUsers;
  els.reefUnifiedAccountNote.hidden = !authenticated;
  if (state.canManageUsers) {
    els.reefUnifiedManageAccounts.href = context.account_management_url
      ? `./${String(context.account_management_url).replace(/^\.\//, "")}`
      : "./admin_users.html";
  }
}

async function waitForTrainingWorkspace() {
  const workspace = document.getElementById("reefTrainingWorkspace");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (workspace && !workspace.hidden) return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

async function loadRecords() {
  if (state.loading || state.accessMode === "denied") return;
  state.loading = true;
  setLoading(true);
  setStatus("Loading all Reef records…");
  try {
    const data = await rpc("ag_reef_records_workspace_records", {
      p_search: state.search || null,
      p_record_type: state.recordType,
      p_limit: PAGE_SIZE,
      p_offset: state.page * PAGE_SIZE
    });
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
    setStatus(error.message || "Previous Records could not be loaded.", "error");
  } finally {
    state.loading = false;
    setLoading(false);
  }
}

function renderRows() {
  els.reefUnifiedRecordsBody.replaceChildren();
  if (!state.rows.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="7">No matching live Reef records found.</td>';
    els.reefUnifiedRecordsBody.append(row);
  } else {
    state.rows.forEach((record) => {
      const row = document.createElement("tr");
      const access = state.accessMode === "authenticated"
        ? '<span class="reef-access-pill is-signed-in">Signed-in history</span>'
        : `<span class="reef-access-pill">Open until ${escapeHtml(formatDateTime(record.public_edit_until))}</span>`;
      const readOnly = record.read_only
        ? '<span class="reef-unified-read-only">Read-only</span>'
        : "";
      row.innerHTML = `
        <td data-label="Type"><span class="reef-record-type is-${escapeHtml(record.record_type)}">${escapeHtml(TYPE_LABELS[record.record_type] || record.record_type)}</span>${readOnly}</td>
        <td data-label="Record"><strong>${escapeHtml(record.record_number || "-")}</strong></td>
        <td data-label="Date">${escapeHtml(formatDate(record.record_date))}</td>
        <td data-label="Location">${escapeHtml(LOCATION_LABELS[record.location] || record.location || "-")}</td>
        <td data-label="Person / details"><strong>${escapeHtml(record.recorded_by_name || "-")}</strong><span class="reef-record-summary">${escapeHtml(formatSummary(record))}</span></td>
        <td data-label="Access">${access}</td>
        <td><button class="secondary-action" type="button" data-open-unified-record data-record-type="${escapeHtml(record.record_type)}" data-record-id="${escapeHtml(record.record_id)}">Open</button></td>`;
      els.reefUnifiedRecordsBody.append(row);
    });
  }

  const start = state.total ? state.page * PAGE_SIZE + 1 : 0;
  const end = Math.min((state.page + 1) * PAGE_SIZE, state.total);
  els.reefUnifiedRecordsPage.textContent = state.total ? `${start}-${end} of ${state.total}` : "0 records";
  els.reefUnifiedRecordsPrevious.disabled = state.page === 0;
  els.reefUnifiedRecordsNext.disabled = end >= state.total;
}

function formatSummary(record) {
  if (record.summary) return record.record_type === "training" && record.record_status === "draft"
    ? `Draft · ${record.summary}` : record.summary;
  if (record.record_type === "training" && record.record_status) return formatRecordStatus(record.record_status);
  return "";
}

function searchRecords() {
  state.search = els.reefUnifiedRecordsSearch.value.trim();
  state.page = 0;
  void loadRecords();
}

function changePage(direction) {
  const next = state.page + direction;
  if (next < 0 || next * PAGE_SIZE >= state.total) return;
  state.page = next;
  void loadRecords();
}

async function openRecord(recordType, recordId) {
  if (!recordId) return;
  if (recordType === "legacy" || recordType === "training") {
    await openLegacyDetail(recordId);
    return;
  }
  const routes = {
    seaweed: `./reef_nursery.html?tab=seaweed&seaweed_record=${encodeURIComponent(recordId)}`,
    inspection: `./reef_nursery.html?tab=inspection&inspection_record=${encodeURIComponent(recordId)}`
  };
  if (routes[recordType]) window.location.assign(routes[recordType]);
}

async function openLegacyDetail(sessionId) {
  const sequence = ++state.detailSequence;
  els.reefLegacyRecordDetail.hidden = false;
  els.reefLegacyRecordTitle.textContent = "Reef record";
  els.reefReportKind.textContent = "Reef record report";
  els.reefReportEdit.hidden = true;
  els.reefReportEdit.removeAttribute("href");
  els.reefLegacyRecordContent.replaceChildren();
  setLegacyStatus("Loading Reef record…");
  try {
    const data = await rpc("ag_reef_records_workspace_legacy_detail", { p_session_id: sessionId });
    if (sequence !== state.detailSequence) return;
    renderLegacyDetail(data);
    // Retain existing saved report URLs; the route name is not a record type.
    history.replaceState(
      {},
      "",
      `./reef_nursery.html?tab=records&legacy_record=${encodeURIComponent(sessionId)}`
    );
    setLegacyStatus("");
    els.reefLegacyRecordDetail.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (sequence !== state.detailSequence) return;
    if (shouldRequireLogin(error)) {
      routeToLoginForLegacy(sessionId);
      return;
    }
    setLegacyStatus(error.message || "The Reef record could not be opened.", "error");
  }
}

function renderLegacyDetail(data) {
  const combined = isCombinedReefRecord(data);
  els.reefReportKind.textContent = combined ? "Combined Reef record — read-only" : "Training report";
  els.reefLegacyRecordTitle.textContent = `${data.record_number || "Reef record"} — ${formatRecordStatus(data.record_status)}`;
  els.reefReportEdit.hidden = combined || data.read_only !== false || !data.session_id;
  els.reefReportEdit.textContent = data.record_status === "draft" ? "Continue draft" : "Edit Training record";
  if (!els.reefReportEdit.hidden) {
    els.reefReportEdit.href = `./reef_nursery.html?record=${encodeURIComponent(data.session_id)}`;
  }
  const participants = Array.isArray(data.participants) ? data.participants : [];
  const training = Array.isArray(data.training_delivered) ? data.training_delivered : [];
  const competencies = Array.isArray(data.practical_competencies) ? data.practical_competencies : [];
  const raftSeaweed = Array.isArray(data.legacy_raft_seaweed) ? data.legacy_raft_seaweed : [];
  const photos = Array.isArray(data.photos) ? data.photos : [];

  els.reefLegacyRecordContent.innerHTML = `
    <section class="reef-legacy-summary-grid">
      ${summaryItem("Session date", formatDate(data.training_date))}
      ${summaryItem("Start time", formatSessionTime(data.start_time))}
      ${summaryItem("End time", formatSessionTime(data.finish_time))}
      ${summaryItem("Location", LOCATION_LABELS[data.location] || data.location)}
      ${summaryItem("Trainer / recorder", data.trainer_name || data.recorded_by_name)}
      ${summaryItem("Session", formatSessionTypes(data.session_types, data.other_session_type))}
    </section>
    <section class="reef-legacy-summary-grid reef-report-audit" aria-label="Record history">
      ${summaryItem("Record created (Kenya time)", formatDateTime(data.created_at))}
      ${summaryItem("Last saved (Kenya time)", formatDateTime(data.updated_at))}
      ${summaryItem("Submitted (Kenya time)", data.record_status === "draft" ? "Not submitted — draft" : (data.submitted_at ? formatDateTime(data.submitted_at) : "Time not recorded"))}
    </section>
    ${combined ? '<p class="reef-legacy-read-only-note">This record includes session-linked Seaweed or Inspection details. It is preserved together and shown read-only.</p>' : ""}
    ${legacyTextSection("Session notes", [
      ["Supporting staff", data.supporting_staff],
      ["Weather and sea conditions", data.weather_sea_conditions],
      ["Nursery reference", data.nursery_reference]
    ])}
    ${participants.length ? legacyParticipants(participants) : ""}
    ${training.length ? legacyTraining(training) : ""}
    ${competencies.length ? legacyCompetencies(competencies) : ""}
    ${data.legacy_general_seaweed ? legacySeaweed("General Seaweed record", [data.legacy_general_seaweed]) : ""}
    ${raftSeaweed.length ? legacySeaweed("Per-raft Seaweed records", raftSeaweed) : ""}
    ${data.legacy_inspection ? legacyInspection(data.legacy_inspection) : ""}
    ${reportPhotosMarkup(photos)}`;

  void loadReportThumbnails(els.reefLegacyRecordContent, (path) => signedPhotoUrl(PHOTO_BUCKET, path));
}

function summaryItem(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`;
}

function legacyTextSection(title, entries) {
  const visible = entries.filter(([, value]) => value !== null && value !== undefined && String(value).trim());
  if (!visible.length) return "";
  return `<section class="reef-legacy-section"><h4>${escapeHtml(title)}</h4>${visible.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("")}</section>`;
}

function legacyParticipants(participants) {
  return `<section class="reef-legacy-section"><h4>Participants</h4><div class="reef-legacy-list">${participants.map((participant) => `
    <article><strong>${escapeHtml(participant.participant_name || `Participant ${participant.participant_order || ""}`)}</strong>
      <span>${escapeHtml(participant.gender || "Gender not recorded")}</span>
      ${participant.farmer_reference_phone ? `<span>${escapeHtml(participant.farmer_reference_phone)}</span>` : ""}
    </article>`).join("")}</div></section>`;
}

function legacyTraining(sections) {
  return `<section class="reef-legacy-section"><h4>Training delivered</h4>${sections.map((section) => `
    <article class="reef-legacy-subsection"><strong>${escapeHtml(section.section_label || section.section_key)}</strong>
      <ul>${(Array.isArray(section.activities) ? section.activities : []).map((activity) => `<li>${escapeHtml(activity.activity_label)}</li>`).join("")}</ul>
      ${section.other_text ? `<p>Other: ${escapeHtml(section.other_text)}</p>` : ""}
    </article>`).join("")}</section>`;
}

function legacyCompetencies(items) {
  return `<section class="reef-legacy-section"><h4>Competency assessments</h4><div class="reef-legacy-list">${items.map((item) => `
    <article><strong>${escapeHtml(item.activity_label || item.activity_id || "Activity")}</strong>
      <span class="reef-competency-line">Group: ${competencyBadge(item.group_level)}</span>
      ${(Array.isArray(item.participant_overrides) ? item.participant_overrides : []).map((override) => `<span class="reef-competency-line">${escapeHtml(override.participant_name || `Participant ${override.participant_order}`)}: ${competencyBadge(override.competency_level)}</span>`).join("")}
    </article>`).join("")}</div></section>`;
}

function legacySeaweed(title, records) {
  return `<section class="reef-legacy-section"><h4>${escapeHtml(title)}</h4><div class="reef-legacy-list">${records.map((record) => `
    <article><strong>${record.raft_number ? `Raft #${escapeHtml(record.raft_number)}` : "General record"}</strong>
      ${legacyValue("Seaweed health", record.seaweed_health)}
      ${legacyValue("Seed weight", formatWeight(record.seed_weight_value, record.seed_weight_unit))}
      ${legacyValue("Harvest weight", formatWeight(record.harvest_weight_value, record.harvest_weight_unit))}
      ${legacyValue("Equipment replaced", record.equipment_replaced)}
    </article>`).join("")}</div></section>`;
}

function legacyInspection(inspection) {
  return `<section class="reef-legacy-section"><h4>Legacy raft inspection</h4>
    ${legacyValue("Overall condition", inspection.overall_condition)}
    ${legacyValue("Seaweed lines and attachments", inspection.seaweed_lines_attachments)}
    ${legacyValue("HDPE floating frame", inspection.hdpe_floating_frame)}
    ${legacyValue("Rigging harness / bridle", inspection.rigging_harness_bridle)}
  </section>`;
}

function legacyValue(label, value) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

function closeLegacyDetail() {
  state.detailSequence += 1;
  els.reefReportEdit.hidden = true;
  els.reefReportEdit.removeAttribute("href");
  els.reefLegacyRecordDetail.hidden = true;
  els.reefLegacyRecordContent.replaceChildren();
  history.replaceState({}, "", "./reef_nursery.html?tab=records");
}

function setLoading(loading) {
  els.reefUnifiedRecordsRefresh.disabled = loading;
  els.reefUnifiedRecordsSearchButton.disabled = loading;
  els.reefUnifiedRecordsType.disabled = loading;
  els.reefUnifiedRecordsPrevious.disabled = loading || state.page === 0;
  els.reefUnifiedRecordsNext.disabled = loading || (state.page + 1) * PAGE_SIZE >= state.total;
}

function setStatus(message, kind = "") {
  els.reefUnifiedRecordsStatus.textContent = message || "";
  if (kind) els.reefUnifiedRecordsStatus.dataset.status = kind;
  else delete els.reefUnifiedRecordsStatus.dataset.status;
}

function setLegacyStatus(message, kind = "") {
  els.reefLegacyRecordStatus.textContent = message || "";
  if (kind) els.reefLegacyRecordStatus.dataset.status = kind;
  else delete els.reefLegacyRecordStatus.dataset.status;
}

function shouldRequireLogin(error) {
  return state.accessMode !== "authenticated"
    && (String(error?.code || "") === "42501"
      || /older than 7 days|sign in|authorised cosme reef|expired/i.test(String(error?.message || "")));
}

function routeToLoginForLegacy(sessionId) {
  const returnPage = `reef_nursery.html?tab=records&legacy_record=${encodeURIComponent(sessionId)}`;
  window.location.assign(`./login.html?return=${encodeURIComponent(returnPage)}`);
}

async function rpc(name, args = {}) {
  const { data, error } = await authClient.rpc(name, args);
  if (error) throw error;
  if (name === "ag_reef_records_workspace_records") return data;
  return Array.isArray(data) ? data[0] || {} : data;
}

function formatRecordStatus(value) {
  if (value === "draft") return "Draft";
  if (value === "test") return "Review";
  return "Submitted";
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day)));
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

function formatSessionTypes(values, otherSessionType = "") {
  return (Array.isArray(values) ? values : []).map((value) => (
    value === "other" && otherSessionType
      ? `Other: ${otherSessionType}`
      : (SESSION_TYPE_LABELS[value] || value)
  )).join(", ");
}

function formatWeight(value, unit) {
  if (value === null || value === undefined || value === "") return "";
  return `${value} ${unit || "kg"}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}
