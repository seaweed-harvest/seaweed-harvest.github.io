import {
  authClient,
  requireAdminAccess,
  setupAccountControls
} from "./auth_client.js?v=25";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=15";
import {
  openPhotoPreview,
  openPhotoUrlPreview,
  photoButtonMarkup,
  setupPhotoViewer,
  signedPhotoUrl
} from "./photo_viewer.js?v=2";
import { fetchDryerPhotoLibrary } from "./dryer_photo_client.js?v=1";

const PAGE_SIZE = 20;
const COSME_SOURCES = new Set(["dryer_table", "reef_nursery"]);

const state = {
  profile: null,
  rows: [],
  total: 0,
  page: 0,
  sort: "taken_at",
  direction: "desc",
  galleryVisible: false,
  loadSequence: 0,
  cosmeMode: false,
  source: "",
  availableSources: []
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  try {
    const access = await requireAdminAccess("can_view_data");
    if (!access) return;
    state.profile = access.profile;
  } catch (error) {
    window.location.replace(`./login.html?error=${encodeURIComponent(error.message)}`);
    return;
  }

  const sidebar = populateAppSidebar(els.photoSidebar, {
    profile: state.profile,
    dashboardHref: "./home.html"
  });
  setupAccountControls(state.profile);
  setupAppNavigation({ profile: state.profile, sidebar, dashboardHref: "./home.html" });
  setupPhotoViewer(document);
  document.body.removeAttribute("data-auth-pending");
  setDateDefaults();
  bindEvents();

  state.availableSources = cosmePhotoSources(state.profile);
  state.cosmeMode = activeAggregatorCode(state.profile) === "COSME"
    && state.availableSources.length > 0;

  if (state.cosmeMode) configureCosmeMode();
  else await loadCommunities();
  await loadPhotos();
}

function cacheElements() {
  [
    "photoSidebar",
    "photoLibraryDescription",
    "photoLibraryCount",
    "togglePhotoGallery",
    "photoSourceTabs",
    "photoDryerTab",
    "photoReefTab",
    "photoFrom",
    "photoTo",
    "photoSourceField",
    "photoSource",
    "photoCommunityField",
    "photoCommunityLabel",
    "photoCommunity",
    "photoGradeField",
    "photoGrade",
    "photoRecorder",
    "applyPhotoFilters",
    "photoPrevious",
    "photoPageStatus",
    "photoNext",
    "photoTableWrap",
    "photoCommunityHeading",
    "photoSeaweedHeading",
    "photoGradeHeading",
    "photoLibraryRows",
    "photoGallery",
    "photoLibraryStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  els.applyPhotoFilters.addEventListener("click", () => {
    state.page = 0;
    void loadPhotos();
  });
  els.photoRecorder.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    state.page = 0;
    void loadPhotos();
  });
  els.photoPrevious.addEventListener("click", () => {
    if (state.page < 1) return;
    state.page -= 1;
    void loadPhotos();
  });
  els.photoNext.addEventListener("click", () => {
    if ((state.page + 1) * PAGE_SIZE >= state.total) return;
    state.page += 1;
    void loadPhotos();
  });
  els.togglePhotoGallery.addEventListener("click", () => {
    state.galleryVisible = !state.galleryVisible;
    syncViewMode();
    if (state.galleryVisible) void renderGallery();
  });
  els.photoSourceTabs?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-photo-source-tab]");
    if (button) setCosmeSource(button.dataset.photoSourceTab);
  });
  els.photoSourceTabs?.addEventListener("keydown", handleSourceTabKeydown);
  document.querySelector(".photo-library-table thead").addEventListener("click", (event) => {
    const button = event.target.closest("[data-photo-sort]");
    if (!button) return;
    const key = normalisedSortKey(button.dataset.photoSort);
    if (!key) return;
    if (state.sort === key) state.direction = state.direction === "asc" ? "desc" : "asc";
    else {
      state.sort = key;
      state.direction = key === "taken_at" ? "desc" : "asc";
    }
    state.page = 0;
    void loadPhotos();
  });
  els.photoLibraryRows.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-photo-open]");
    if (openButton) {
      const item = state.rows[Number(openButton.dataset.photoOpen)];
      if (item) void openRowPhoto(item);
      return;
    }
    if (event.target.closest("button, a, input, select")) return;
    const row = event.target.closest("[data-photo-row]");
    if (!row) return;
    const item = state.rows[Number(row.dataset.photoRow)];
    if (item) void openRowPhoto(item);
  });
  els.photoLibraryRows.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key) || event.target.closest("button, a, input, select")) return;
    const row = event.target.closest("[data-photo-row]");
    if (!row) return;
    event.preventDefault();
    const item = state.rows[Number(row.dataset.photoRow)];
    if (item) void openRowPhoto(item);
  });
}

function configureCosmeMode() {
  document.body.classList.add("cosme-photo-library");
  els.photoLibraryDescription.textContent = "COSME Dryer Table and Reef Nursery photographic records.";
  els.photoSourceTabs.hidden = false;
  els.photoSourceField.hidden = true;
  els.photoGradeField.hidden = true;
  els.photoGradeHeading.hidden = true;
  els.photoCommunityLabel.textContent = "Location";
  els.photoCommunityHeading.querySelector("button").textContent = "Location";
  els.photoCommunityHeading.querySelector("button").dataset.photoSort = "location";
  els.photoSeaweedHeading.textContent = "Photo context";
  els.photoDryerTab.hidden = !state.availableSources.includes("dryer_table");
  els.photoReefTab.hidden = !state.availableSources.includes("reef_nursery");
  state.source = state.availableSources[0] || "reef_nursery";
  state.galleryVisible = true;
  updateSourceTabs();
  updateLocationOptions([]);
  syncViewMode();
}

function cosmePhotoSources(profile) {
  const capabilities = profile?.organisation_capabilities || {};
  const ownerDryerAccess = capabilities.form_dryer_table === true
    && profile?.is_protected_owner === true
    && (
      profile?.app_role === "system_admin"
      || (profile?.can_access_admin === true && profile?.can_view_data === true)
    );
  const sources = [];
  if (ownerDryerAccess) sources.push("dryer_table");
  if (capabilities.form_reef_nursery === true) sources.push("reef_nursery");
  return sources;
}

function activeAggregatorCode(profile) {
  return String(profile?.active_aggregator_code || "").trim().toUpperCase();
}

function setCosmeSource(source) {
  if (!state.cosmeMode || !COSME_SOURCES.has(source) || !state.availableSources.includes(source)) return;
  if (state.source === source) return;
  state.source = source;
  state.page = 0;
  state.sort = "taken_at";
  state.direction = "desc";
  els.photoCommunity.value = "";
  updateSourceTabs();
  void loadPhotos();
}

function updateSourceTabs() {
  [els.photoDryerTab, els.photoReefTab].forEach((button) => {
    if (!button || button.hidden) return;
    const active = button.dataset.photoSourceTab === state.source;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
}

function handleSourceTabKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const buttons = [els.photoDryerTab, els.photoReefTab].filter((button) => button && !button.hidden);
  const current = buttons.findIndex((button) => button.getAttribute("aria-selected") === "true");
  let next = current;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = buttons.length - 1;
  else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
  else next = Math.min(buttons.length - 1, current + 1);
  const button = buttons[next];
  if (!button) return;
  setCosmeSource(button.dataset.photoSourceTab);
  button.focus();
}

async function loadCommunities() {
  const { data, error } = await authClient
    .from("ag_secure_communities")
    .select("community_id,community_name")
    .order("community_name");
  if (error) throw error;
  (data || []).forEach((community) => {
    els.photoCommunity.append(new Option(
      `${community.community_id} - ${community.community_name}`,
      community.community_id
    ));
  });
}

async function loadPhotos() {
  const sequence = ++state.loadSequence;
  setStatus("Loading...");
  setLoading(true);
  try {
    const result = state.cosmeMode
      ? await loadCosmePhotos()
      : await loadGenericPhotos();
    if (sequence !== state.loadSequence) return;
    state.rows = Array.isArray(result?.rows) ? result.rows : [];
    state.total = Number(result?.total_count || 0);
    if (state.cosmeMode) updateLocationOptions(result?.locations || []);
    render();
    setStatus("");
  } catch (error) {
    if (sequence !== state.loadSequence) return;
    state.rows = [];
    state.total = 0;
    render();
    setStatus(error?.message || "Photos could not be loaded.", "error");
  } finally {
    if (sequence === state.loadSequence) setLoading(false);
  }
}

async function loadGenericPhotos() {
  const { data, error } = await authClient.rpc("ag_photo_library", {
    p_start_date: els.photoFrom.value || null,
    p_end_date: els.photoTo.value || null,
    p_source_type: els.photoSource.value || null,
    p_community_id: els.photoCommunity.value || null,
    p_grade: els.photoGrade.value || null,
    p_recorder: els.photoRecorder.value.trim() || null,
    p_sort_key: state.sort,
    p_sort_direction: state.direction,
    p_page_limit: PAGE_SIZE,
    p_page_offset: state.page * PAGE_SIZE
  });
  if (error) throw error;
  return data || { rows: [], total_count: 0 };
}

async function loadCosmePhotos() {
  if (state.source === "dryer_table") {
    return fetchDryerPhotoLibrary({
      startDate: els.photoFrom.value || null,
      endDate: els.photoTo.value || null,
      location: els.photoCommunity.value || null,
      recorder: els.photoRecorder.value.trim() || null,
      sortKey: dryerSortKey(state.sort),
      sortDirection: state.direction,
      limit: PAGE_SIZE,
      offset: state.page * PAGE_SIZE
    });
  }

  const { data, error } = await authClient.rpc("ag_cosme_reef_photo_library", {
    p_start_date: els.photoFrom.value || null,
    p_end_date: els.photoTo.value || null,
    p_location: els.photoCommunity.value || null,
    p_recorder: els.photoRecorder.value.trim() || null,
    p_sort_key: reefSortKey(state.sort),
    p_sort_direction: state.direction,
    p_page_limit: PAGE_SIZE,
    p_page_offset: state.page * PAGE_SIZE
  });
  if (error) throw error;
  return data || { rows: [], total_count: 0, locations: [] };
}

function normalisedSortKey(key) {
  if (!state.cosmeMode) {
    return ["taken_at", "source_label", "community_name", "recorder_name", "grade_code"].includes(key)
      ? key
      : "";
  }
  if (key === "community_name") return "location";
  return ["taken_at", "location", "recorder_name"].includes(key) ? key : "";
}

function dryerSortKey(key) {
  if (key === "location") return "table_location";
  if (key === "recorder_name") return "recorder_name";
  return "taken_at";
}

function reefSortKey(key) {
  return ["location", "recorder_name"].includes(key) ? key : "taken_at";
}

function updateLocationOptions(locations) {
  const previous = els.photoCommunity.value;
  const labels = [...new Set((Array.isArray(locations) ? locations : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))].sort((first, second) => first.localeCompare(second, undefined, {
      numeric: true,
      sensitivity: "base"
    }));
  els.photoCommunity.innerHTML = '<option value="">All locations</option>';
  labels.forEach((label) => els.photoCommunity.append(new Option(label, label)));
  if (labels.includes(previous)) els.photoCommunity.value = previous;
}

function render() {
  els.photoLibraryCount.textContent = `${formatInteger(state.total)} photo${state.total === 1 ? "" : "s"}`;
  els.photoLibraryRows.innerHTML = state.rows.map((row, index) => (
    state.cosmeMode ? cosmeRowMarkup(row, index) : genericRowMarkup(row, index)
  )).join("") || emptyRow(8, "No photos match these filters.");
  els.photoPageStatus.textContent = pageStatus();
  els.photoPrevious.disabled = state.page === 0;
  els.photoNext.disabled = (state.page + 1) * PAGE_SIZE >= state.total;
  syncViewMode();
  if (state.galleryVisible) void renderGallery();
}

function genericRowMarkup(row, index) {
  return `<tr data-photo-row="${index}" tabindex="0">
    <td>${photoButtonMarkup([row.storage_path], row.bucket_id, "View")}</td>
    <td>${escapeHtml(formatDateTime(row.taken_at))}</td>
    <td>${escapeHtml(row.source_label || "-")}</td>
    <td><strong>${escapeHtml(row.record_reference || "-")}</strong></td>
    <td>${stack([row.community_id, row.community_name])}</td>
    <td>${escapeHtml(row.recorder_name || "-")}</td>
    <td>${escapeHtml(row.seaweed_type || "-")}</td>
    <td>${escapeHtml(row.grade_code || "-")}</td>
  </tr>`;
}

function cosmeRowMarkup(row, index) {
  return `<tr data-photo-row="${index}" tabindex="0">
    <td><button class="photo-count-button" type="button" data-photo-open="${index}">View</button></td>
    <td>${escapeHtml(formatDateTime(row.taken_at))}</td>
    <td>${escapeHtml(row.source_label || sourceLabel())}</td>
    <td><strong>${escapeHtml(row.record_reference || "-")}</strong></td>
    <td>${escapeHtml(row.location || "-")}</td>
    <td>${escapeHtml(row.recorder_name || "-")}</td>
    <td>${escapeHtml(row.photo_context || "-")}</td>
    <td hidden></td>
  </tr>`;
}

async function openRowPhoto(row) {
  const title = [
    row.source_label || sourceLabel(),
    row.location,
    row.photo_context
  ].filter(Boolean).join(" — ");
  if (row.signed_url) {
    openPhotoUrlPreview([{
      url: row.signed_url,
      caption: row.photo_context || "Dryer Table photo",
      alt: title
    }], title || "Photo");
    return;
  }
  if (row.storage_path) {
    await openPhotoPreview(
      [row.storage_path],
      row.bucket_id,
      title || row.source_label || "Photo"
    );
  }
}

async function renderGallery() {
  const expectedRows = state.rows;
  els.photoGallery.innerHTML = state.rows.length
    ? state.rows.map(() => '<div class="photo-library-thumbnail is-loading"></div>').join("")
    : '<p class="empty-state">No photos match these filters.</p>';
  if (!state.rows.length) return;

  await Promise.all(state.rows.map(async (row, index) => {
    try {
      const url = row.signed_url
        || await signedPhotoUrl(row.bucket_id, row.storage_path);
      if (state.rows !== expectedRows) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "photo-library-thumbnail";
      button.title = [row.source_label, row.record_reference, row.photo_context]
        .filter(Boolean)
        .join(" — ");
      const image = document.createElement("img");
      image.src = url;
      image.alt = button.title || "Record photo";
      image.loading = "lazy";
      const caption = document.createElement("span");
      caption.textContent = formatDateTime(row.taken_at);
      button.append(image, caption);
      if (state.cosmeMode) {
        const context = document.createElement("span");
        context.className = "photo-thumbnail-context field-hint";
        context.textContent = [row.location, row.photo_context]
          .filter(Boolean)
          .join(" · ");
        button.append(context);
      }
      button.addEventListener("click", () => { void openRowPhoto(row); });
      els.photoGallery.children[index]?.replaceWith(button);
    } catch {
      els.photoGallery.children[index]?.classList.remove("is-loading");
    }
  }));
}

function syncViewMode() {
  if (state.cosmeMode) {
    els.photoTableWrap.hidden = state.galleryVisible;
    els.photoGallery.hidden = !state.galleryVisible;
    els.togglePhotoGallery.textContent = state.galleryVisible ? "Show list" : "Show thumbnails";
    els.togglePhotoGallery.setAttribute("aria-pressed", String(state.galleryVisible));
    return;
  }
  els.photoTableWrap.hidden = false;
  els.photoGallery.hidden = !state.galleryVisible;
  els.togglePhotoGallery.textContent = state.galleryVisible ? "Hide thumbnails" : "Show thumbnails";
  els.togglePhotoGallery.setAttribute("aria-pressed", String(state.galleryVisible));
}

function sourceLabel() {
  return state.source === "dryer_table" ? "Dryer Table" : "Reef Nursery";
}

function setDateDefaults() {
  const today = kenyaDate();
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  els.photoFrom.value = start.toISOString().slice(0, 10);
  els.photoTo.value = today;
}

function setLoading(loading) {
  [
    els.applyPhotoFilters,
    els.photoPrevious,
    els.photoNext,
    els.photoDryerTab,
    els.photoReefTab
  ].filter(Boolean).forEach((button) => {
    button.disabled = loading;
  });
}

function pageStatus() {
  if (!state.total) return "No photos";
  const first = state.page * PAGE_SIZE + 1;
  const last = Math.min(state.total, first + state.rows.length - 1);
  return `${first}-${last} of ${formatInteger(state.total)}`;
}

function setStatus(message, type = "") {
  els.photoLibraryStatus.textContent = message || "";
  if (type) els.photoLibraryStatus.dataset.status = type;
  else delete els.photoLibraryStatus.dataset.status;
}

function stack(values) {
  const clean = values.map((value) => String(value || "").trim()).filter(Boolean);
  return clean.length ? escapeHtml(clean.join(" - ")) : "-";
}

function emptyRow(columns, message) {
  return `<tr><td colspan="${columns}" class="empty-state">${escapeHtml(message)}</td></tr>`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi"
  }).format(date);
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function kenyaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Nairobi"
  }).format(new Date());
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
