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
const ACTIVE_JOB_STORAGE_KEY = "seaweed-harvest:mawimbi-backup-active-job";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const els = {};
const state = {
  summaryReady: false,
  summaryTotals: null,
  latestVerified: null,
  activeJobId: null,
  exportBusy: false,
  monitorGeneration: 0
};

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
    bindEvents();
    document.body.removeAttribute("data-auth-pending");

    const dashboard = await loadSummary();
    const storedJobId = readStoredJobId();
    const serverJob = dashboard?.latest_attempt;
    const serverActiveJobId = ["queued", "running"].includes(String(serverJob?.status || ""))
      ? String(serverJob?.id || "")
      : "";
    const activeJobId = storedJobId || serverActiveJobId;

    if (activeJobId) {
      rememberActiveJob(activeJobId);
      void monitorBackup(activeJobId, activeJobId === serverActiveJobId ? serverJob : null);
    } else {
      setExportReady(dashboard?.latest_verified || null);
    }
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
    "backupExportButton",
    "backupExportProgress",
    "backupDownloadLink",
    "backupExportStatus"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  els.datasetRows = new Map(REQUIRED_DATASET_KEYS.concat("active-total").map((key) => [
    key,
    document.querySelector(`[data-backup-dataset="${key}"]`)
  ]));
}

function bindEvents() {
  els.backupExportButton?.addEventListener("click", () => {
    void handleExportClick();
  });
  window.addEventListener("pagehide", () => {
    state.monitorGeneration += 1;
  }, { once: true });
}

function setLoadingState() {
  els.backupSummaryPanel?.setAttribute("aria-busy", "true");
  setPill(els.backupSummaryStatus, "Loading", true);
  if (els.backupScopeNote) {
    delete els.backupScopeNote.dataset.status;
    els.backupScopeNote.textContent = "Loading the current read-only Mawimbi summary from Supabase. No backup is being created.";
  }
  if (els.backupExportButton) {
    els.backupExportButton.disabled = true;
    els.backupExportButton.textContent = "Export backup ZIP";
  }
  hideProgress();
  hideDownloadLink();
  setExportStatus("Loading current Mawimbi summary.");
}

async function loadSummary() {
  const { data, error } = await authClient.rpc("ag_backup_dashboard");
  if (error) throw error;
  const dashboard = data || {};
  renderSummary(dashboard);
  return dashboard;
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

  state.summaryReady = true;
  state.summaryTotals = allTotals;
  state.latestVerified = data.latest_verified || null;

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

  setPill(els.backupSummaryStatus, "Live", false);
  setScopeNote(data.generated_at
    ? `Live Mawimbi summary generated ${formatDateTime(data.generated_at)}. No backup is currently being created.`
    : "Live Mawimbi summary loaded from Supabase. No backup is currently being created.");
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
  state.summaryReady = false;
  setPill(els.backupSummaryStatus, "Unavailable", true);
  setScopeNote(
    `The live Mawimbi summary could not be loaded. ${error?.message || "Unknown error."} No data was changed.`,
    "error"
  );
  if (els.backupExportButton) {
    els.backupExportButton.disabled = true;
    els.backupExportButton.textContent = "Export unavailable";
  }
  hideProgress();
  hideDownloadLink();
  setExportStatus("Summary unavailable. A backup cannot be started safely.", "error");
  els.backupSummaryPanel?.setAttribute("aria-busy", "false");
}

async function handleExportClick() {
  if (!state.summaryReady || state.exportBusy) return;

  const existingJobId = state.activeJobId || readStoredJobId();
  if (existingJobId) {
    rememberActiveJob(existingJobId);
    await monitorBackup(existingJobId);
    return;
  }

  if (!navigator.onLine) {
    setExportStatus("An internet connection is required to create the server-side backup.", "error");
    return;
  }

  const missingPhotoCount = Math.max(
    0,
    numberValue(state.summaryTotals?.linkedPhotoCount) - numberValue(state.summaryTotals?.availablePhotoCount)
  );
  const missingNote = missingPhotoCount
    ? `\n\n${formatInteger(missingPhotoCount)} linked photograph${missingPhotoCount === 1 ? " is" : "s are"} currently missing. The missing reference${missingPhotoCount === 1 ? "" : "s"} will be listed in the ZIP.`
    : "";
  const confirmed = window.confirm(
    `Create and download a fresh Mawimbi backup ZIP now?\n\nThe server will read the current Mawimbi records and available linked photographs, build and verify one private ZIP, then start the download. Operational records will not be changed.${missingNote}`
  );
  if (!confirmed) return;

  hideDownloadLink();
  setExportBusy("Submitting backup request…", 0);
  setScopeNote("Creating a verified server-side backup from this Mawimbi scope. Operational records remain read-only.");

  try {
    const response = await invokeBackup({
      action: "create",
      trigger_type: "manual"
    });
    const job = response?.job;
    const jobId = String(job?.id || "").trim();
    if (!jobId) throw new Error("The backup service did not return a job ID.");

    rememberActiveJob(jobId);
    setExportStatus(response?.duplicate
      ? "A backup was already running. Following the existing server job."
      : "Backup request accepted by the server.");
    await monitorBackup(jobId, job);
  } catch (error) {
    forgetActiveJob();
    setExportFailure(error?.message || "The backup could not be started.", false);
  }
}

async function monitorBackup(jobId, initialJob = null) {
  const normalizedJobId = String(jobId || "").trim();
  if (!normalizedJobId) return;

  const generation = ++state.monitorGeneration;
  const startedAt = Date.now();
  state.exportBusy = true;
  rememberActiveJob(normalizedJobId);
  hideDownloadLink();
  setExportBusy("Checking backup status…", numberValue(initialJob?.progress_percent));

  let job = initialJob;
  while (generation === state.monitorGeneration) {
    if (job) {
      renderBackupProgress(job);
      const status = String(job.status || "").toLowerCase();
      if (status === "verified") {
        await downloadVerifiedBackup(job);
        return;
      }
      if (status === "failed") {
        forgetActiveJob();
        setExportFailure(job.error_message || "The server could not create the Mawimbi backup.", false);
        return;
      }
    }

    if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
      pauseMonitoring(
        "The backup is taking longer than expected. It remains a server-side job; click Check backup status to continue monitoring."
      );
      return;
    }

    await delay(POLL_INTERVAL_MS);
    if (generation !== state.monitorGeneration) return;

    try {
      const response = await invokeBackup({
        action: "status",
        job_id: normalizedJobId
      });
      job = response?.job;
      if (!job) throw new Error("The backup service returned no job status.");
    } catch (error) {
      if (Number(error?.status) === 404) {
        forgetActiveJob();
        setExportFailure(
          `${error?.message || "The backup job is no longer available."} Start a new export to continue.`,
          false
        );
      } else {
        pauseMonitoring(
          `${error?.message || "Backup status could not be refreshed."} Click Check backup status to retry.`
        );
      }
      return;
    }
  }
}

function renderBackupProgress(job) {
  const progress = clampProgress(job.progress_percent);
  if (els.backupExportProgress) {
    els.backupExportProgress.hidden = false;
    els.backupExportProgress.value = progress;
    els.backupExportProgress.setAttribute("aria-valuetext", `${progress}% — ${job.status_message || stageLabel(job.stage)}`);
  }
  if (els.backupExportButton) {
    els.backupExportButton.disabled = true;
    els.backupExportButton.setAttribute("aria-busy", "true");
    els.backupExportButton.textContent = progress > 0
      ? `Creating backup… ${progress}%`
      : "Starting backup…";
  }
  setExportStatus(job.status_message || stageLabel(job.stage));
}

async function downloadVerifiedBackup(job) {
  if (els.backupExportProgress) {
    els.backupExportProgress.hidden = false;
    els.backupExportProgress.value = 100;
  }
  if (els.backupExportButton) {
    els.backupExportButton.disabled = true;
    els.backupExportButton.textContent = "Preparing download…";
    els.backupExportButton.setAttribute("aria-busy", "true");
  }
  setExportStatus("Backup verified. Creating a protected download link…");

  try {
    const response = await invokeBackup({
      action: "download",
      job_id: job.id
    });
    const signedUrl = String(response?.signed_url || "").trim();
    if (!signedUrl) throw new Error("The backup service did not return a download link.");

    showDownloadLink({
      signedUrl,
      fileName: String(response.file_name || "mawimbi-backup.zip")
    });
    forgetActiveJob();
    state.exportBusy = false;
    if (els.backupExportButton) {
      els.backupExportButton.disabled = false;
      els.backupExportButton.textContent = "Export another backup ZIP";
      els.backupExportButton.removeAttribute("aria-busy");
    }

    const details = [
      formatBytes(response.bytes || job.mawimbi_package_bytes),
      `${formatInteger(job.total_record_count)} records`,
      `${formatInteger(job.physical_photo_count)} photo${numberValue(job.physical_photo_count) === 1 ? "" : "s"} included`,
      `${formatInteger(job.missing_photo_count)} missing reference${numberValue(job.missing_photo_count) === 1 ? "" : "s"} listed`
    ].join(" · ");
    setExportStatus(`Verified backup complete. Download started (${details}).`, "success");
    setScopeNote(
      `Verified Mawimbi backup completed ${formatDateTime(job.completed_at || job.generated_at)}. The operational records were not changed.`,
      "success"
    );
  } catch (error) {
    state.exportBusy = false;
    if (els.backupExportButton) {
      els.backupExportButton.disabled = false;
      els.backupExportButton.textContent = "Retry verified download";
      els.backupExportButton.removeAttribute("aria-busy");
    }
    setExportStatus(
      `The backup was verified, but the download could not start. ${error?.message || "Unknown download error."} Click Retry verified download.`,
      "error"
    );
    setScopeNote("The verified backup remains private in Supabase. Operational records were not changed.");
  }
}

async function invokeBackup(body) {
  const { data, error } = await authClient.functions.invoke("system-backup", { body });
  if (!error && !data?.error) return data || {};

  let message = data?.error || error?.message || "The Mawimbi backup request failed.";
  let status = Number(error?.context?.status || error?.status || 0);
  try {
    const details = await error?.context?.json();
    message = details?.error || details?.message || message;
    status = Number(error?.context?.status || details?.status || status || 0);
  } catch {
    // Keep the client-provided message when the response body is unavailable.
  }
  const failure = new Error(message);
  failure.status = status;
  throw failure;
}

function setExportReady(latestVerified = null) {
  if (!state.summaryReady) return;
  state.exportBusy = false;
  state.activeJobId = null;
  hideProgress();
  hideDownloadLink();
  if (els.backupExportButton) {
    els.backupExportButton.disabled = false;
    els.backupExportButton.textContent = "Export backup ZIP";
    els.backupExportButton.removeAttribute("aria-busy");
  }

  if (latestVerified && !isExpired(latestVerified.expires_at)) {
    const size = formatBytes(latestVerified.mawimbi_package_bytes || latestVerified.complete_package_bytes);
    setExportStatus(
      `Ready. The latest verified backup completed ${formatDateTime(latestVerified.completed_at || latestVerified.generated_at)} (${size}). Export creates a fresh ZIP.`
    );
    return;
  }
  setExportStatus("Ready. Export creates and downloads a fresh verified Mawimbi ZIP.");
}

function setExportBusy(message, progress = 0) {
  state.exportBusy = true;
  if (els.backupExportButton) {
    els.backupExportButton.disabled = true;
    els.backupExportButton.textContent = message;
    els.backupExportButton.setAttribute("aria-busy", "true");
  }
  if (els.backupExportProgress) {
    els.backupExportProgress.hidden = false;
    els.backupExportProgress.value = clampProgress(progress);
  }
  setExportStatus(message);
}

function pauseMonitoring(message) {
  state.exportBusy = false;
  if (els.backupExportButton) {
    els.backupExportButton.disabled = false;
    els.backupExportButton.textContent = "Check backup status";
    els.backupExportButton.removeAttribute("aria-busy");
  }
  setExportStatus(message, "warning");
  setScopeNote("The server-side backup job may still be running. Operational records remain read-only.");
}

function setExportFailure(message, keepProgress = false) {
  state.exportBusy = false;
  if (els.backupExportButton) {
    els.backupExportButton.disabled = !state.summaryReady;
    els.backupExportButton.textContent = state.summaryReady ? "Try export again" : "Export unavailable";
    els.backupExportButton.removeAttribute("aria-busy");
  }
  if (!keepProgress) hideProgress();
  hideDownloadLink();
  setExportStatus(message, "error");
  setScopeNote("The backup attempt did not complete. The Mawimbi operational records were not changed.", "error");
}

function showDownloadLink({ signedUrl, fileName }) {
  if (!els.backupDownloadLink) return;
  els.backupDownloadLink.href = signedUrl;
  els.backupDownloadLink.download = fileName;
  els.backupDownloadLink.rel = "noopener";
  els.backupDownloadLink.hidden = false;
  els.backupDownloadLink.textContent = `Download ${fileName}`;
  window.setTimeout(() => {
    els.backupDownloadLink?.click();
  }, 0);
}

function hideDownloadLink() {
  if (!els.backupDownloadLink) return;
  els.backupDownloadLink.hidden = true;
  els.backupDownloadLink.removeAttribute("download");
  els.backupDownloadLink.removeAttribute("rel");
  els.backupDownloadLink.href = "#";
  els.backupDownloadLink.textContent = "Download verified ZIP";
}

function hideProgress() {
  if (!els.backupExportProgress) return;
  els.backupExportProgress.hidden = true;
  els.backupExportProgress.value = 0;
  els.backupExportProgress.removeAttribute("aria-valuetext");
}

function rememberActiveJob(jobId) {
  const normalized = String(jobId || "").trim();
  if (!normalized) return;
  state.activeJobId = normalized;
  try {
    window.sessionStorage.setItem(ACTIVE_JOB_STORAGE_KEY, normalized);
  } catch {
    // Monitoring still works in-memory when session storage is unavailable.
  }
}

function readStoredJobId() {
  try {
    return String(window.sessionStorage.getItem(ACTIVE_JOB_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function forgetActiveJob() {
  state.activeJobId = null;
  try {
    window.sessionStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
  } catch {
    // Nothing else is required when session storage is unavailable.
  }
}

function setScopeNote(message, status = "") {
  if (!els.backupScopeNote) return;
  els.backupScopeNote.textContent = message;
  if (status) els.backupScopeNote.dataset.status = status;
  else delete els.backupScopeNote.dataset.status;
}

function setExportStatus(message, status = "") {
  if (!els.backupExportStatus) return;
  els.backupExportStatus.textContent = message;
  if (status) els.backupExportStatus.dataset.status = status;
  else delete els.backupExportStatus.dataset.status;
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

function stageLabel(value) {
  const labels = {
    queued: "Backup request queued.",
    snapshot: "Reading the Mawimbi data snapshot.",
    photos: "Collecting linked photographs.",
    packaging: "Creating the Mawimbi ZIP and checksums.",
    upload: "Uploading the private verified package.",
    verification: "Verifying the stored package.",
    verified: "Backup verified.",
    failed: "Backup failed."
  };
  return labels[String(value || "").toLowerCase()] || "Backup is running on the server.";
}

function clampProgress(value) {
  return Math.max(0, Math.min(100, Math.round(numberValue(value))));
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

function formatBytes(value) {
  const bytes = numberValue(value);
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let amount = bytes;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toLocaleString("en-GB", {
    minimumFractionDigits: index === 0 ? 0 : 1,
    maximumFractionDigits: index === 0 ? 0 : 2
  })} ${units[index]}`;
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

function isExpired(value) {
  const date = parseDate(value);
  return !date || date.getTime() <= Date.now();
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
