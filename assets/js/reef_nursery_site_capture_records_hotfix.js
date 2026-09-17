import { authClient } from "./auth_client.js?v=25";

const RECORD_FILTERS = new Set(["all", "training", "seaweed", "inspection", "legacy"]);
const SITE_CAPTURE_PREFIX = /^RSC-/i;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

function init() {
  injectStyles();
  applyAll();
  document.addEventListener("change", clearResolvedSpeciesError, true);
  document.addEventListener("input", clearResolvedSpeciesError, true);
  document.addEventListener("submit", clearResolvedSpeciesError, true);
  document.addEventListener("click", interceptSiteCaptureOpen, true);

  const observer = new MutationObserver(() => applyAll());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function applyAll() {
  relocateSampleSave();
  patchReefRecordNavigation();
  applyRequestedRecordFilter();
}

function clearResolvedSpeciesError(event) {
  const species = document.getElementById("reefSiteCaptureSpecies");
  const status = document.getElementById("reefSiteCaptureStatus");
  if (!species || !status || !species.value) return;
  if (event.type !== "submit" && event.target !== species) return;
  if (/species is required/i.test(status.textContent || "")) {
    status.textContent = "";
    delete status.dataset.status;
  }
}

function relocateSampleSave() {
  const button = document.getElementById("reefSampleRopeSave");
  const panel = document.getElementById("reefSampleRopePanel");
  if (!button || !panel || button.closest(".reef-sample-rope-save-footer")) return;

  const tableWrap = panel.querySelector(".reef-sample-rope-table-wrap");
  if (!tableWrap) return;

  const oldWrap = button.closest(".reef-sample-rope-save-wrap");
  const status = document.getElementById("reefSampleRopeStatus");
  const footer = document.createElement("div");
  footer.className = "reef-sample-rope-save-footer";
  button.textContent = "Save Sample Data";
  button.classList.add("reef-sample-rope-save-primary");
  footer.append(button);
  if (status) footer.append(status);
  tableWrap.after(footer);
  if (oldWrap && !oldWrap.children.length) oldWrap.remove();
}

function patchReefRecordNavigation() {
  document.querySelectorAll('a[href*="reef_nursery_records.html"]').forEach((anchor) => {
    if (anchor.dataset.reefRecordsSplit === "done") return;
    const training = anchor.cloneNode(true);
    const seaweed = anchor.cloneNode(true);
    training.textContent = "Nursery - Training Records";
    training.href = "./reef_nursery.html?tab=records&record_type=training";
    training.dataset.reefRecordsSplit = "done";
    seaweed.textContent = "Nursery - Seaweed Records";
    seaweed.href = "./reef_nursery.html?tab=records&record_type=seaweed";
    seaweed.dataset.reefRecordsSplit = "done";
    anchor.before(training, seaweed);
    anchor.remove();
  });
}

function applyRequestedRecordFilter() {
  const select = document.getElementById("reefUnifiedRecordsType");
  if (!select || select.dataset.urlFilterApplied === "true") return;
  const requested = new URLSearchParams(window.location.search).get("record_type");
  if (!requested || !RECORD_FILTERS.has(requested)) {
    select.dataset.urlFilterApplied = "true";
    return;
  }
  select.dataset.urlFilterApplied = "true";
  if (select.value !== requested) {
    select.value = requested;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function interceptSiteCaptureOpen(event) {
  const button = event.target instanceof Element
    ? event.target.closest("[data-open-unified-record]")
    : null;
  if (!button) return;
  const row = button.closest("tr");
  const recordNumber = row?.querySelector('[data-label="Record"] strong')?.textContent?.trim() || "";
  if (!SITE_CAPTURE_PREFIX.test(recordNumber)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  void openSiteCaptureDetail(button.dataset.recordId, recordNumber);
}

async function openSiteCaptureDetail(captureId, fallbackRecordNumber) {
  if (!captureId) return;
  const detail = document.getElementById("reefLegacyRecordDetail");
  const title = document.getElementById("reefLegacyRecordTitle");
  const kind = document.getElementById("reefReportKind");
  const status = document.getElementById("reefLegacyRecordStatus");
  const content = document.getElementById("reefLegacyRecordContent");
  const edit = document.getElementById("reefReportEdit");
  if (!detail || !title || !content) return;

  detail.hidden = false;
  title.textContent = fallbackRecordNumber || "Seaweed Site Capture";
  if (kind) kind.textContent = "Seaweed Data Collection";
  if (edit) edit.hidden = true;
  if (status) status.textContent = "Loading Seaweed record…";
  content.replaceChildren();

  try {
    const { data, error } = await authClient.rpc("ag_reef_site_capture_record_detail", {
      p_capture_id: captureId
    });
    if (error) throw error;
    const record = Array.isArray(data) ? data[0] : data;
    renderSiteCaptureDetail(content, record || {});
    title.textContent = record?.record_number || fallbackRecordNumber || "Seaweed Site Capture";
    if (status) status.textContent = "";
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (status) status.textContent = error.message || "Seaweed record could not be opened.";
  }
}

function renderSiteCaptureDetail(container, record) {
  const health = record.health_environment || {};
  const condition = health.condition && typeof health.condition === "object" ? health.condition : {};
  const observations = Array.isArray(health.health_observations) ? health.health_observations : [];
  const environment = health.environment && typeof health.environment === "object" ? health.environment : {};
  const conditionSummary = Object.entries(condition)
    .map(([key, value]) => `${humanize(key)}: ${humanize(value?.rating || "-")}${value?.note ? ` (${value.note})` : ""}`)
    .join("; ");
  const environmentSummary = Object.entries(environment)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `${humanize(key)}: ${value}`)
    .join("; ");

  container.innerHTML = `
    <div class="reef-site-capture-detail-grid">
      ${detailItem("Date / time", formatDateTime(record.observed_at))}
      ${detailItem("Location", humanize(record.location))}
      ${detailItem("Site", record.site_code)}
      ${detailItem("Recorder", record.recorded_by_name)}
      ${detailItem("Monitoring team", record.monitoring_team === "other" ? record.monitoring_team_other : humanize(record.monitoring_team))}
      ${detailItem("Species", humanize(record.species))}
      ${detailItem("Number of lines", record.line_count)}
      ${detailItem("Seed total weight", formatWeight(record.seed_weight_value, record.seed_weight_unit))}
      ${detailItem("Harvest total weight", formatWeight(record.harvest_weight_value, record.harvest_weight_unit))}
    </div>
    ${conditionSummary ? `<section class="reef-site-capture-detail-section"><h4>Seaweed condition</h4><p>${escapeHtml(conditionSummary)}</p></section>` : ""}
    ${observations.length ? `<section class="reef-site-capture-detail-section"><h4>Health observations</h4><p>${escapeHtml(observations.map(humanize).join(", "))}</p></section>` : ""}
    ${environmentSummary ? `<section class="reef-site-capture-detail-section"><h4>Environment</h4><p>${escapeHtml(environmentSummary)}</p></section>` : ""}
    ${record.general_notes ? `<section class="reef-site-capture-detail-section"><h4>General notes</h4><p>${escapeHtml(record.general_notes)}</p></section>` : ""}
    ${record.photo ? `<section class="reef-site-capture-detail-section"><h4>Photo</h4><p>${escapeHtml(record.photo.original_name || "Photo attached")}</p></section>` : ""}
  `;
}

function detailItem(label, value) {
  const display = value === null || value === undefined || value === "" ? "—" : String(value);
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(display)}</strong></div>`;
}

function formatWeight(value, unit) {
  if (value === null || value === undefined || value === "") return "—";
  return `${value} ${unit || "kg"}`;
}

function formatDateTime(value) {
  if (!value) return "—";
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
  if (value === null || value === undefined || value === "") return "—";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function injectStyles() {
  if (document.getElementById("reefSiteCaptureRecordsHotfixStyles")) return;
  const style = document.createElement("style");
  style.id = "reefSiteCaptureRecordsHotfixStyles";
  style.textContent = `
    .reef-sample-rope-save-footer {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      margin: 0.75rem 0 0.35rem;
    }
    .reef-sample-rope-save-primary {
      background: #e97918 !important;
      border-color: #c95f09 !important;
      color: #fff !important;
      font-weight: 800 !important;
      padding: 0.65rem 1rem !important;
      box-shadow: 0 2px 5px rgba(162, 74, 4, 0.18);
    }
    .reef-sample-rope-save-primary:hover {
      background: #cf650e !important;
      border-color: #ad5005 !important;
    }
    .reef-sample-rope-save-footer #reefSampleRopeStatus {
      font-weight: 700;
    }
    .reef-site-capture-detail-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.65rem;
      margin: 0.6rem 0 1rem;
    }
    .reef-site-capture-detail-grid > div {
      border: 1px solid #dce9e7;
      border-radius: 7px;
      padding: 0.65rem;
      background: #fbfefd;
    }
    .reef-site-capture-detail-grid span,
    .reef-site-capture-detail-grid strong { display: block; }
    .reef-site-capture-detail-grid span { color: #55736f; font-size: 0.78rem; text-transform: uppercase; }
    .reef-site-capture-detail-grid strong { margin-top: 0.2rem; }
    .reef-site-capture-detail-section { margin-top: 0.8rem; }
    .reef-site-capture-detail-section h4 { margin: 0 0 0.25rem; }
    .reef-site-capture-detail-section p { margin: 0; }
    @media (max-width: 760px) {
      .reef-site-capture-detail-grid { grid-template-columns: 1fr; }
    }
  `;
  document.head.append(style);
}
