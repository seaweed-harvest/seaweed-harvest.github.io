import {
  authClient,
  hasOrganisationCapability,
  requireAggregatorAccess,
  setupAccountControls
} from "./auth_client.js?v=25";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=15";

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
  canDelete: false
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
    const access = await requireAggregatorAccess(
      "COSME",
      "can_access_reef_nursery",
      "reef_seaweed_records.html"
    );
    if (!access) return;
    state.profile = access.profile;
    state.canDelete = Boolean(state.profile?.is_protected_owner);
    if (!hasOrganisationCapability(state.profile, "form_reef_nursery")) {
      window.location.replace("./access_pending.html");
      return;
    }

    const sidebar = populateAppSidebar(els.reefSeaweedRecordsSidebar, {
      profile: state.profile,
      dashboardHref: "./home.html",
      currentFile: "reef_seaweed_records.html"
    });
    setupAccountControls(state.profile);
    setupAppNavigation({
      profile: state.profile,
      sidebar,
      dashboardHref: "./home.html"
    });
    bindEvents();
    document.body.removeAttribute("data-auth-pending");
    await loadRecords();
  } catch (error) {
    window.location.replace(`./login.html?return=${encodeURIComponent("reef_seaweed_records.html")}&error=${encodeURIComponent(error.message || "Sign in required")}`);
  }
}

function cacheElements() {
  [
    "reefSeaweedRecordsSidebar",
    "reloadReefSeaweedRecords",
    "reefSeaweedRecordsSearch",
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
  els.closeReefSeaweedRecordDetail.addEventListener("click", closeDetail);
}

async function loadRecords() {
  if (state.loading) return;
  state.loading = true;
  setLoading(true);
  setStatus("Loading seaweed records...");
  try {
    const { data, error } = await authClient.rpc("ag_reef_seaweed_records_page", {
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
    els.reefSeaweedRecordRows.innerHTML = '<tr><td colspan="8" class="empty-state">No matching seaweed records found.</td></tr>';
  } else {
    els.reefSeaweedRecordRows.innerHTML = state.rows.map((record) => {
      const kindClass = record.record_kind === "sample_rope_register"
        ? " is-sample"
        : record.record_kind === "legacy_seaweed" ? " is-legacy" : "";
      const site = formatSite(record);
      const details = [record.summary, record.recorded_by_name].filter(Boolean).join(" · ");
      return `
        <tr>
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
  closeDetail();
  void loadRecords();
}

function changePage(direction) {
  const next = state.page + direction;
  if (next < 0 || next * PAGE_SIZE >= state.total) return;
  state.page = next;
  closeDetail();
  void loadRecords();
}

async function openRecord(kind, key, recordNumber) {
  if (!kind || !key) return;
  if (kind === "legacy_seaweed") {
    window.location.assign(`./reef_nursery.html?tab=seaweed&seaweed_record=${encodeURIComponent(key)}`);
    return;
  }

  els.reefSeaweedRecordDetail.hidden = false;
  els.reefSeaweedRecordDetailTitle.textContent = recordNumber || KIND_LABELS[kind] || "Seaweed record";
  els.reefSeaweedRecordDetailContent.replaceChildren();
  setDetailStatus("Loading record...");
  try {
    if (kind === "site_capture") await openSiteCapture(key);
    else if (kind === "sample_rope_register") await openSampleRegister(key);
    setDetailStatus("");
    els.reefSeaweedRecordDetail.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setDetailStatus(error.message || "That record could not be opened.", "error");
  }
}

async function openSiteCapture(captureId) {
  const { data, error } = await authClient.rpc("ag_reef_site_capture_record_detail", {
    p_capture_id: captureId
  });
  if (error) throw error;
  const record = Array.isArray(data) ? data[0] : data;
  if (!record) throw new Error("Seaweed Site Capture was not found.");
  els.reefSeaweedRecordDetailTitle.textContent = record.record_number || "Seaweed Site Capture";

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

  els.reefSeaweedRecordDetailContent.innerHTML = `
    <div class="reef-detail-grid">
      ${detailItem("Date / time", formatDateTime(record.observed_at))}
      ${detailItem("Location", LOCATION_LABELS[record.location] || humanize(record.location))}
      ${detailItem("Site", [record.site_code, record.site_name].filter(Boolean).join(" - "))}
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

async function openSampleRegister(siteCode) {
  const { data, error } = await authClient.rpc("ag_reef_sample_rope_register", {
    p_site_code: siteCode
  });
  if (error) throw error;
  const register = data || {};
  const rows = Array.isArray(register.rows) ? register.rows : [];
  els.reefSeaweedRecordDetailTitle.textContent = `${register.site_code || siteCode} Sample Rope Register`;
  els.reefSeaweedRecordDetailContent.innerHTML = `
    <div class="reef-detail-grid">
      ${detailItem("Location", LOCATION_LABELS[register.location] || humanize(register.location))}
      ${detailItem("Site", [register.site_code, register.site_name].filter(Boolean).join(" - "))}
      ${detailItem("Structure", register.structure_type ? humanize(register.structure_type) : "-")}
    </div>
    <div class="responsive-table-wrap">
      <table class="management-table admin-data-table reef-sample-detail-table">
        <thead>
          <tr>
            <th>Sample Rope</th>
            <th>Species</th>
            <th>Date Seeded</th>
            <th>Rope Weight (kg)</th>
            <th>Initial Weight (kg)</th>
            <th>Wk2</th>
            <th>Wk4</th>
            <th>Wk6</th>
            <th>Previous cycles</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>Rope ${escapeHtml(row.rope_number)}</td>
              <td>${escapeHtml(row.species ? humanize(row.species) : "-")}</td>
              <td>${escapeHtml(formatDate(row.date_seeded))}</td>
              <td>${escapeHtml(displayNumber(row.rope_weight_kg))}</td>
              <td>${escapeHtml(displayNumber(row.initial_weight_kg))}</td>
              <td>${escapeHtml(displayNumber(row.week_2_kg))}</td>
              <td>${escapeHtml(displayNumber(row.week_4_kg))}</td>
              <td>${escapeHtml(displayNumber(row.week_6_kg))}</td>
              <td>${escapeHtml(String(row.history_count || 0))}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
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

    closeDetail();
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
  els.reefSeaweedRecordDetail.hidden = true;
  els.reefSeaweedRecordDetailContent.replaceChildren();
  setDetailStatus("");
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
    const site = [record.site_code, record.site_name].filter(Boolean).join(" - ");
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
