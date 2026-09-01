import {
  authClient,
  requireAuthenticatedAccount,
  routeForProfile,
  setupAccountControls
} from "./auth_client.js?v=25";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=14";

const ACTIVE_DATASET_KEYS = Object.freeze([
  "intake",
  "site_water_samples",
  "stock_records",
  "process_records"
]);
const ARCHIVE_DATASET_KEY = "deleted_record_archive";
const REQUIRED_DATASET_KEYS = Object.freeze([...ACTIVE_DATASET_KEYS, ARCHIVE_DATASET_KEY]);
const els = {};

document.addEventListener("DOMContentLoaded", () => {
  void init();
});

async function init() {
  cacheElements();
  setLoadingState();

  try {
    const access = await requireAuthenticatedAccount("admin_backups.html");
    if (!access) return;

    const allowed = access.profile?.account_status === "active"
      && (access.profile?.app_role === "system_admin"
        || access.profile?.is_protected_owner === true);
    if (!allowed) {
      window.location.replace("./access_pending.html");
      return;
    }

    const dashboardHref = routeForProfile(access.profile);
    const sidebar = populateAppSidebar(els.backupSidebar, {
      profile: access.profile,
      dashboardHref
    });
    setupAccountControls(access.profile);
    setupAppNavigation({ profile: access.profile, sidebar, dashboardHref });
    document.body.removeAttribute("data-auth-pending");

    const { data, error } = await authClient.rpc("ag_backup_dashboard");
    if (error) throw error;
    renderSummary(data || {});
  } catch (error) {
    document.body.removeAttribute("data-auth-pending");
    renderError(error);
  }
}

function cacheElements() {
  [
    "backupSidebar",
    "backupSummaryPanel",
    "backupSummaryStatus",
    "backupScopeNote",
    "backupActiveRecordCount",
    "backupDeletedRecordCount",
    "backupTotalRecordCount",
    "backupLinkedPhotoCount",
    "backupAvailablePhotoCount",
    "backupRecordExportSize",
    "backupExportStatus"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  els.datasetRows = new Map(REQUIRED_DATASET_KEYS.concat("active-total").map((key) => [
    key,
    document.querySelector(`[data-backup-dataset="${key}"]`)
  ]));
}

function setLoadingState() {
  els.backupSummaryPanel?.setAttribute("aria-busy", "true");
  setPill(els.backupSummaryStatus, "Loading", true);
  if (els.backupScopeNote) {
    delete els.backupScopeNote.dataset.status;
    els.backupScopeNote.textContent = "Loading the current read-only Mawimbi summary from Supabase. No backup is being created.";
  }
}

function renderSummary(data) {
  const datasets = Array.isArray(data.datasets) ? data.datasets : [];
  const datasetMap = new Map(datasets.map((row) => [String(row.dataset_key || ""), row]));
  const missingKeys = REQUIRED_DATASET_KEYS.filter((key) => !datasetMap.has(key));
  if (missingKeys.length) {
    throw new Error(`The live backup summary is incomplete (${missingKeys.join(", ")}).`);
  }

  const activeRows = ACTIVE_DATASET_KEYS.map((key) => datasetMap.get(key));
  const archiveRow = datasetMap.get(ARCHIVE_DATASET_KEY);
  const activeTotals = sumRows(activeRows);
  const allTotals = sumRows([...activeRows, archiveRow]);

  setText(els.backupActiveRecordCount, formatInteger(activeTotals.recordCount));
  setText(els.backupDeletedRecordCount, formatInteger(archiveRow.record_count));
  setText(els.backupTotalRecordCount, formatInteger(allTotals.recordCount));
  setText(els.backupLinkedPhotoCount, formatInteger(allTotals.linkedPhotoCount));
  setText(els.backupAvailablePhotoCount, formatInteger(allTotals.availablePhotoCount));
  setText(els.backupRecordExportSize, formatApproxRecordSize(allTotals.exportBytes));

  activeRows.forEach((row) => renderDatasetRow(row.dataset_key, row));
  renderDatasetRow(ARCHIVE_DATASET_KEY, archiveRow, { datePrefix: "Deleted " });
  renderDatasetRow("active-total", {
    record_count: activeTotals.recordCount,
    linked_photo_count: activeTotals.linkedPhotoCount,
    present_photo_count: activeTotals.availablePhotoCount,
    export_bytes: activeTotals.exportBytes,
    earliest_at: earliestValue(activeRows),
    latest_at: latestValue(activeRows)
  });

  setPill(els.backupSummaryStatus, "Live read-only", false);
  if (els.backupScopeNote) {
    delete els.backupScopeNote.dataset.status;
    els.backupScopeNote.textContent = data.generated_at
      ? `Live read-only Mawimbi summary generated ${formatDateTime(data.generated_at)}. No backup was created.`
      : "Live read-only Mawimbi summary loaded from Supabase. No backup was created.";
  }
  setText(els.backupExportStatus, "Read-only summary connected. Export backend not connected.");
  els.backupSummaryPanel?.setAttribute("aria-busy", "false");
}

function renderDatasetRow(key, row, options = {}) {
  const element = els.datasetRows.get(key);
  if (!element) return;
  setRowField(element, "records", formatInteger(row.record_count));
  setRowField(element, "photos-linked", formatInteger(row.linked_photo_count));
  setRowField(element, "photos-available", formatInteger(row.present_photo_count));
  setRowField(element, "record-export", formatApproxRecordSize(row.export_bytes));
  const range = formatDateRange(row.earliest_at, row.latest_at);
  setRowField(element, "date-range", range === "No records presently stored"
    ? range
    : `${options.datePrefix || ""}${range}`);
}

function renderError(error) {
  setPill(els.backupSummaryStatus, "Unavailable", true);
  if (els.backupScopeNote) {
    els.backupScopeNote.dataset.status = "error";
    els.backupScopeNote.textContent = `The live read-only summary could not be loaded. ${error?.message || "Unknown error."} No data was changed.`;
  }
  setText(els.backupExportStatus, "Summary unavailable. Export backend not connected.");
  els.backupSummaryPanel?.setAttribute("aria-busy", "false");
}

function sumRows(rows) {
  return rows.reduce((totals, row) => ({
    recordCount: totals.recordCount + numberValue(row?.record_count),
    linkedPhotoCount: totals.linkedPhotoCount + numberValue(row?.linked_photo_count),
    availablePhotoCount: totals.availablePhotoCount + numberValue(row?.present_photo_count),
    exportBytes: totals.exportBytes + numberValue(row?.export_bytes)
  }), {
    recordCount: 0,
    linkedPhotoCount: 0,
    availablePhotoCount: 0,
    exportBytes: 0
  });
}

function earliestValue(rows) {
  return rows
    .map((row) => parseDate(row?.earliest_at))
    .filter(Boolean)
    .sort((left, right) => left - right)[0]?.toISOString() || null;
}

function latestValue(rows) {
  return rows
    .map((row) => parseDate(row?.latest_at))
    .filter(Boolean)
    .sort((left, right) => right - left)[0]?.toISOString() || null;
}

function setRowField(row, field, value) {
  const cell = row.querySelector(`[data-backup-field="${field}"]`);
  if (!cell) return;
  const strong = cell.querySelector("strong");
  setText(strong || cell, value);
}

function setPill(element, label, muted, extraClass = "") {
  if (!element) return;
  element.textContent = label;
  element.className = `status-pill${muted ? " status-muted" : ""}${extraClass ? ` ${extraClass}` : ""}`;
}

function setText(element, value) {
  if (element) element.textContent = String(value ?? "");
}

function formatInteger(value) {
  return numberValue(value).toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function formatApproxRecordSize(value) {
  const bytes = numberValue(value);
  if (bytes <= 0) return "0 MB";
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 0.01) return "~<0.01 MB";
  return `~${megabytes.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} MB`;
}

function formatDateRange(earliest, latest) {
  const start = dateParts(earliest);
  const end = dateParts(latest);
  if (!start || !end) return "No records presently stored";
  if (start.isoDate === end.isoDate) return `${start.day} ${start.month} ${start.year}`;
  if (start.year === end.year && start.monthNumber === end.monthNumber) {
    return `${start.day}–${end.day} ${end.month} ${end.year}`;
  }
  if (start.year === end.year) {
    return `${start.day} ${start.month}–${end.day} ${end.month} ${end.year}`;
  }
  return `${start.day} ${start.month} ${start.year}–${end.day} ${end.month} ${end.year}`;
}

function dateParts(value) {
  const date = parseDate(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Nairobi"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const monthNumber = Number(new Intl.DateTimeFormat("en", {
    month: "numeric",
    timeZone: "Africa/Nairobi"
  }).format(date));
  const isoDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Nairobi"
  }).format(date);
  return {
    day: values.day,
    month: values.month,
    monthNumber,
    year: values.year,
    isoDate
  };
}

function formatDateTime(value) {
  const date = parseDate(value);
  if (!date) return "at an unknown time";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
    timeZoneName: "short"
  }).format(date);
}

function parseDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  let normalized = text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized = `${normalized}T12:00:00Z`;
  else normalized = normalized.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
