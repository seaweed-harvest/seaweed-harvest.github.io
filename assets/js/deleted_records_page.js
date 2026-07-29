import {
  authClient,
  requireAdminAccess,
  setupAccountControls
} from "./auth_client.js?v=25";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=13";
import { photoButtonMarkup, setupPhotoViewer } from "./photo_viewer.js?v=1";

const PAGE_SIZE = 50;
const state = {
  profile: null,
  rows: [],
  total: 0,
  page: 0,
  selected: new Set(),
  canPermanentlyDelete: false
};
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  try {
    const access = await requireAdminAccess("can_view_data");
    if (!access) return;
    state.profile = access.profile;
    state.canPermanentlyDelete = access.profile.app_role === "system_admin"
      || Boolean(access.profile.can_edit_collections);
  } catch (error) {
    window.location.replace(`./login.html?error=${encodeURIComponent(error.message)}`);
    return;
  }

  const sidebar = populateAppSidebar(els.deletedSidebar, {
    profile: state.profile,
    dashboardHref: "./home.html"
  });
  setupAccountControls(state.profile);
  setupAppNavigation({ profile: state.profile, sidebar, dashboardHref: "./home.html" });
  setupPhotoViewer(document);
  document.body.removeAttribute("data-auth-pending");
  setDateDefaults();
  bindEvents();
  if (state.canPermanentlyDelete) await purgeExpiredRecords();
  await loadDeletedRecords();
}

function cacheElements() {
  [
    "deletedSidebar", "deletedRecordCount", "deletedFrom", "deletedTo", "deletedSource",
    "deletedSearch", "applyDeletedFilters", "deletedRecordActions", "deletedSelectedCount",
    "permanentlyDeleteRecords", "deletedPrevious", "deletedPageStatus", "deletedNext",
    "deletedSelectionHeading", "deletedSelectAll", "deletedRecordRows", "deletedRecordStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  els.applyDeletedFilters.addEventListener("click", () => {
    state.page = 0;
    void loadDeletedRecords();
  });
  els.deletedSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    state.page = 0;
    void loadDeletedRecords();
  });
  els.deletedPrevious.addEventListener("click", () => {
    if (state.page < 1) return;
    state.page -= 1;
    void loadDeletedRecords();
  });
  els.deletedNext.addEventListener("click", () => {
    if ((state.page + 1) * PAGE_SIZE >= state.total) return;
    state.page += 1;
    void loadDeletedRecords();
  });
  els.deletedSelectAll.addEventListener("change", () => {
    state.selected.clear();
    if (els.deletedSelectAll.checked) {
      state.rows.forEach((row) => state.selected.add(String(row.id)));
    }
    render();
  });
  els.deletedRecordRows.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-deleted-id]");
    if (!checkbox) return;
    if (checkbox.checked) state.selected.add(checkbox.dataset.deletedId);
    else state.selected.delete(checkbox.dataset.deletedId);
    updateSelection();
  });
  els.permanentlyDeleteRecords.addEventListener("click", permanentlyDeleteSelected);
}

async function loadDeletedRecords() {
  setStatus("Loading...");
  setLoading(true);
  const { data, error } = await authClient.rpc("ag_deleted_records_page", {
    p_start_date: els.deletedFrom.value || null,
    p_end_date: els.deletedTo.value || null,
    p_source_type: els.deletedSource.value || null,
    p_search: els.deletedSearch.value.trim() || null,
    p_page_limit: PAGE_SIZE,
    p_page_offset: state.page * PAGE_SIZE
  });
  setLoading(false);
  if (error) {
    state.rows = [];
    state.total = 0;
    render();
    setStatus(error.message || "Deleted records could not be loaded.", "error");
    return;
  }
  state.rows = Array.isArray(data?.rows) ? data.rows : [];
  state.total = Number(data?.total_count || 0);
  state.selected.clear();
  render();
  setStatus("");
}

function render() {
  els.deletedRecordCount.textContent = `${formatInteger(state.total)} record${state.total === 1 ? "" : "s"}`;
  els.deletedSelectionHeading.hidden = !state.canPermanentlyDelete;
  els.deletedRecordRows.innerHTML = state.rows.map((row) => {
    const assets = normalizeAssets(row.photo_assets);
    const bucket = assets[0]?.bucket || "collection-photos";
    const paths = assets.filter((asset) => asset.bucket === bucket).map((asset) => asset.path);
    return `
      <tr>
        <td class="selection-cell"${state.canPermanentlyDelete ? "" : " hidden"}>
          <input type="checkbox" data-deleted-id="${escapeAttribute(row.id)}" aria-label="Select ${escapeAttribute(row.record_reference || "deleted record")}"${state.selected.has(String(row.id)) ? " checked" : ""}>
        </td>
        <td>${escapeHtml(formatDateTime(row.deleted_at))}</td>
        <td>${escapeHtml(sourceLabel(row.source_type))}</td>
        <td><strong>${escapeHtml(row.record_reference || "-")}</strong></td>
        <td>${escapeHtml(formatDateTime(row.recorded_at))}</td>
        <td>${stack([row.farmer_id, row.farmer_name])}</td>
        <td>${stack([row.community_id, row.community_name])}</td>
        <td>${escapeHtml(formatNumber(row.weight_kg))}</td>
        <td>${escapeHtml(formatNumber(row.total_ksh))}</td>
        <td>${escapeHtml(row.recorder_name || "-")}</td>
        <td>${stack([row.deleted_by_name, row.deleted_by_email])}</td>
        <td>${paths.length ? photoButtonMarkup(paths, bucket) : "-"}</td>
        <td>${escapeHtml(formatDateTime(row.purge_after))}</td>
      </tr>
    `;
  }).join("") || emptyRow(13, "No deleted records match these filters.");
  els.deletedPageStatus.textContent = pageStatus();
  els.deletedPrevious.disabled = state.page === 0;
  els.deletedNext.disabled = (state.page + 1) * PAGE_SIZE >= state.total;
  updateSelection();
}

function updateSelection() {
  const count = state.selected.size;
  els.deletedRecordActions.hidden = !state.canPermanentlyDelete || count === 0;
  els.deletedSelectedCount.textContent = `${count} selected`;
  els.deletedSelectAll.checked = state.rows.length > 0
    && state.rows.every((row) => state.selected.has(String(row.id)));
  els.deletedSelectAll.indeterminate = count > 0 && !els.deletedSelectAll.checked;
}

async function permanentlyDeleteSelected() {
  const rows = state.rows.filter((row) => state.selected.has(String(row.id)));
  if (!rows.length) return;
  const count = rows.length;
  if (!window.confirm(`Permanently delete ${count} record${count === 1 ? "" : "s"}? This cannot be undone.`)) return;
  els.permanentlyDeleteRecords.disabled = true;
  setStatus("Deleting permanently...");
  try {
    await removeArchiveAssets(rows);
    const { error } = await authClient.rpc("ag_permanently_delete_records", {
      p_archive_ids: rows.map((row) => row.id)
    });
    if (error) throw error;
    if (state.page > 0 && rows.length === state.rows.length) state.page -= 1;
    await loadDeletedRecords();
    setStatus(`Permanently deleted ${count} record${count === 1 ? "" : "s"}.`);
  } catch (error) {
    setStatus(error.message || "Records could not be permanently deleted.", "error");
  } finally {
    els.permanentlyDeleteRecords.disabled = false;
  }
}

async function purgeExpiredRecords() {
  const { data, error } = await authClient.rpc("ag_expired_deleted_record_assets");
  if (error || !Array.isArray(data) || !data.length) return;
  try {
    await removeArchiveAssets(data);
    await authClient.rpc("ag_permanently_delete_records", {
      p_archive_ids: data.map((row) => row.id)
    });
  } catch {
    // The archive remains available for a later cleanup attempt.
  }
}

async function removeArchiveAssets(rows) {
  const grouped = new Map();
  rows.flatMap((row) => normalizeAssets(row.photo_assets)).forEach((asset) => {
    if (!grouped.has(asset.bucket)) grouped.set(asset.bucket, []);
    grouped.get(asset.bucket).push(asset.path);
  });
  for (const [bucket, paths] of grouped) {
    const unique = [...new Set(paths)];
    if (!unique.length) continue;
    const { error } = await authClient.storage.from(bucket).remove(unique);
    if (error) throw error;
  }
}

function normalizeAssets(value) {
  return (Array.isArray(value) ? value : [])
    .map((asset) => ({
      bucket: String(asset?.bucket || "").trim(),
      path: String(asset?.path || "").trim()
    }))
    .filter((asset) => asset.bucket && asset.path);
}

function setDateDefaults() {
  const today = kenyaDate();
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  els.deletedFrom.value = start.toISOString().slice(0, 10);
  els.deletedTo.value = today;
}

function setLoading(loading) {
  [els.applyDeletedFilters, els.deletedPrevious, els.deletedNext].forEach((button) => {
    button.disabled = loading;
  });
}

function pageStatus() {
  if (!state.total) return "No records";
  const first = state.page * PAGE_SIZE + 1;
  const last = Math.min(state.total, first + state.rows.length - 1);
  return `${first}-${last} of ${formatInteger(state.total)}`;
}

function sourceLabel(value) {
  return ({
    intake: "Intake Collection",
    process: "Process Record",
    site_sample: "Site Water Sample",
    stock: "Stock Record"
  })[value] || value || "-";
}

function stack(values) {
  const clean = values.map((value) => String(value || "").trim()).filter(Boolean);
  return clean.length ? clean.map((value) => `<span>${escapeHtml(value)}</span>`).join("<br>") : "-";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi"
  }).format(date);
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-KE", { maximumFractionDigits: 2 })
    : "-";
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function kenyaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Africa/Nairobi"
  }).format(new Date());
}

function emptyRow(columns, message) {
  return `<tr><td colspan="${columns}" class="empty-state">${escapeHtml(message)}</td></tr>`;
}

function setStatus(message, type = "") {
  els.deletedRecordStatus.textContent = message || "";
  if (type) els.deletedRecordStatus.dataset.status = type;
  else delete els.deletedRecordStatus.dataset.status;
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}
