import {
  authClient,
  requireAdminAccess,
  setupAccountControls
} from "./auth_client.js?v=25";
import { populateAppSidebar, setupAppNavigation } from "./app_navigation.js?v=14";
import {
  openPhotoPreview,
  photoButtonMarkup,
  setupPhotoViewer,
  signedPhotoUrl
} from "./photo_viewer.js?v=1";

const PAGE_SIZE = 20;
const state = {
  profile: null,
  rows: [],
  total: 0,
  page: 0,
  sort: "taken_at",
  direction: "desc",
  galleryVisible: false,
  loadSequence: 0
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
  await loadCommunities();
  await loadPhotos();
}

function cacheElements() {
  [
    "photoSidebar", "photoLibraryCount", "togglePhotoGallery", "photoFrom", "photoTo",
    "photoSource", "photoCommunity", "photoGrade", "photoRecorder", "applyPhotoFilters",
    "photoPrevious", "photoPageStatus", "photoNext", "photoLibraryRows", "photoGallery",
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
    els.togglePhotoGallery.textContent = state.galleryVisible ? "Hide thumbnails" : "Show thumbnails";
    els.togglePhotoGallery.setAttribute("aria-pressed", String(state.galleryVisible));
    els.photoGallery.hidden = !state.galleryVisible;
    if (state.galleryVisible) void renderGallery();
  });
  document.querySelector(".photo-library-table thead").addEventListener("click", (event) => {
    const button = event.target.closest("[data-photo-sort]");
    if (!button) return;
    const key = button.dataset.photoSort;
    if (state.sort === key) state.direction = state.direction === "asc" ? "desc" : "asc";
    else {
      state.sort = key;
      state.direction = key === "taken_at" ? "desc" : "asc";
    }
    state.page = 0;
    void loadPhotos();
  });
  els.photoLibraryRows.addEventListener("click", (event) => {
    if (event.target.closest("button, a, input, select")) return;
    const row = event.target.closest("[data-photo-row]");
    if (!row) return;
    const item = state.rows[Number(row.dataset.photoRow)];
    if (item) void openPhotoPreview([item.storage_path], item.bucket_id, item.source_label);
  });
  els.photoLibraryRows.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key) || event.target.closest("button, a, input, select")) return;
    const row = event.target.closest("[data-photo-row]");
    if (!row) return;
    event.preventDefault();
    const item = state.rows[Number(row.dataset.photoRow)];
    if (item) void openPhotoPreview([item.storage_path], item.bucket_id, item.source_label);
  });
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
  if (sequence !== state.loadSequence) return;
  setLoading(false);
  if (error) {
    state.rows = [];
    state.total = 0;
    render();
    setStatus(error.message || "Photos could not be loaded.", "error");
    return;
  }
  state.rows = Array.isArray(data?.rows) ? data.rows : [];
  state.total = Number(data?.total_count || 0);
  render();
  setStatus("");
}

function render() {
  els.photoLibraryCount.textContent = `${formatInteger(state.total)} photo${state.total === 1 ? "" : "s"}`;
  els.photoLibraryRows.innerHTML = state.rows.map((row, index) => `
    <tr data-photo-row="${index}" tabindex="0">
      <td>${photoButtonMarkup([row.storage_path], row.bucket_id, "View")}</td>
      <td>${escapeHtml(formatDateTime(row.taken_at))}</td>
      <td>${escapeHtml(row.source_label || "-")}</td>
      <td><strong>${escapeHtml(row.record_reference || "-")}</strong></td>
      <td>${stack([row.community_id, row.community_name])}</td>
      <td>${escapeHtml(row.recorder_name || "-")}</td>
      <td>${escapeHtml(row.seaweed_type || "-")}</td>
      <td>${escapeHtml(row.grade_code || "-")}</td>
    </tr>
  `).join("") || emptyRow(8, "No photos match these filters.");
  els.photoPageStatus.textContent = pageStatus();
  els.photoPrevious.disabled = state.page === 0;
  els.photoNext.disabled = (state.page + 1) * PAGE_SIZE >= state.total;
  if (state.galleryVisible) void renderGallery();
}

async function renderGallery() {
  const expectedRows = state.rows;
  els.photoGallery.innerHTML = state.rows.length
    ? state.rows.map(() => '<div class="photo-library-thumbnail is-loading"></div>').join("")
    : '<p class="empty-state">No photos match these filters.</p>';
  if (!state.rows.length) return;

  await Promise.all(state.rows.map(async (row, index) => {
    try {
      const url = await signedPhotoUrl(row.bucket_id, row.storage_path);
      if (state.rows !== expectedRows) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "photo-library-thumbnail";
      button.title = `${row.source_label} ${row.record_reference || ""}`.trim();
      const image = document.createElement("img");
      image.src = url;
      image.alt = button.title;
      image.loading = "lazy";
      const caption = document.createElement("span");
      caption.textContent = formatDateTime(row.taken_at);
      button.append(image, caption);
      button.addEventListener("click", () => {
        void openPhotoPreview([row.storage_path], row.bucket_id, row.source_label);
      });
      els.photoGallery.children[index]?.replaceWith(button);
    } catch {
      els.photoGallery.children[index]?.classList.remove("is-loading");
    }
  }));
}

function setDateDefaults() {
  const today = kenyaDate();
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  els.photoFrom.value = start.toISOString().slice(0, 10);
  els.photoTo.value = today;
}

function setLoading(loading) {
  [els.applyPhotoFilters, els.photoPrevious, els.photoNext].forEach((button) => {
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
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi"
  }).format(date);
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

function kenyaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Africa/Nairobi"
  }).format(new Date());
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}
