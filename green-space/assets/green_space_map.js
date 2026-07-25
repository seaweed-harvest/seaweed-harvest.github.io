import { loadProjectPhotos, loadProjects, publicPhotoUrl } from "./green_space_api.js?v=5";

const state = {
  projects: [],
  map: null,
  markers: new Map()
};

const els = {
  map: document.getElementById("girlsMap"),
  status: document.getElementById("girlsMapStatus"),
  count: document.getElementById("girlsMapCount"),
  listCount: document.getElementById("girlsMapListCount"),
  search: document.getElementById("girlsMapSearch"),
  list: document.getElementById("girlsMapList"),
  galleryDialog: document.getElementById("girlsMapGalleryDialog"),
  galleryTitle: document.getElementById("girlsMapGalleryTitle"),
  galleryStatus: document.getElementById("girlsMapGalleryStatus"),
  galleryGrid: document.getElementById("girlsMapGalleryGrid"),
  closeGallery: document.getElementById("girlsCloseMapGallery"),
  photoViewer: document.getElementById("girlsMapPhotoViewer"),
  photoViewerImage: document.getElementById("girlsMapPhotoViewerImage"),
  photoViewerName: document.getElementById("girlsMapPhotoViewerName"),
  closePhotoViewer: document.getElementById("girlsCloseMapPhotoViewer")
};

document.addEventListener("DOMContentLoaded", initialise, { once: true });

async function initialise() {
  els.search.addEventListener("input", renderList);
  els.list.addEventListener("click", focusFromList);
  els.list.addEventListener("keydown", focusFromList);
  els.map.addEventListener("click", openGalleryFromMap);
  els.closeGallery.addEventListener("click", () => els.galleryDialog.close());
  els.galleryGrid.addEventListener("click", openMapPhoto);
  els.closePhotoViewer.addEventListener("click", () => els.photoViewer.close());
  try {
    state.projects = (await loadProjects()).filter(hasCoordinates);
    els.count.textContent = `${state.projects.length} ${state.projects.length === 1 ? "space" : "spaces"}`;
    renderMap();
    renderList();
  } catch (error) {
    els.status.hidden = false;
    els.status.textContent = error.message;
    els.list.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderMap() {
  if (!window.L) {
    els.status.hidden = false;
    els.status.textContent = "The map library could not load.";
    return;
  }
  state.map = window.L.map(els.map, { scrollWheelZoom: true }).setView([-27.55, 153.05], 9);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(state.map);

  if (!state.projects.length) {
    els.status.hidden = false;
    els.status.textContent = "No green spaces have been added yet.";
    return;
  }

  state.projects.forEach((project) => {
    const marker = window.L.marker(
      [Number(project.latitude), Number(project.longitude)],
      { icon: greenSpaceIcon() }
    )
      .addTo(state.map)
      .bindPopup(projectPopup(project));
    state.markers.set(project.id, marker);
  });

  if (state.projects.length === 1) {
    state.map.setView([Number(state.projects[0].latitude), Number(state.projects[0].longitude)], 15);
  } else {
    state.map.fitBounds(
      state.projects.map((project) => [Number(project.latitude), Number(project.longitude)]),
      { padding: [36, 36], maxZoom: 15 }
    );
  }
  els.status.hidden = true;
  window.setTimeout(() => state.map?.invalidateSize(), 100);
}

function renderList() {
  const query = clean(els.search.value).toLowerCase();
  const rows = state.projects.filter((project) => {
    if (!query) return true;
    return [
      project.participant_name,
      project.green_space_name,
      project.public_code,
      project.location_description
    ].some((value) => clean(value).toLowerCase().includes(query));
  });

  els.listCount.textContent = `${rows.length} ${rows.length === 1 ? "space" : "spaces"}`;
  els.list.innerHTML = rows.map((project) => `
    <tr class="girls-map-list-row" tabindex="0" data-project-id="${escapeAttribute(project.id)}" aria-label="Focus ${escapeAttribute(project.green_space_name)} on the map">
      <td><strong>${escapeHtml(project.green_space_name)}</strong></td>
      <td>${escapeHtml(project.participant_name)}</td>
      <td>${escapeHtml(project.public_code)}</td>
      <td>${Number(project.entry_count || 0)}</td>
      <td>${project.latest_entry_at ? formatDate(project.latest_entry_at) : "Project setup"}</td>
    </tr>
  `).join("") || '<tr><td colspan="5">No green spaces match this search.</td></tr>';
}

function focusFromList(event) {
  if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
  const row = event.target.closest("[data-project-id]");
  if (!row) return;
  event.preventDefault();
  const marker = state.markers.get(row.dataset.projectId);
  if (!marker || !state.map) return;
  state.map.flyTo(marker.getLatLng(), Math.max(state.map.getZoom(), 15), { duration: 0.4 });
  window.setTimeout(() => marker.openPopup(), 350);
  els.map.scrollIntoView({ behavior: "smooth", block: "center" });
}

function greenSpaceIcon() {
  return window.L.divIcon({
    className: "",
    html: '<span class="girls-map-marker" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h10"></path><path d="M10 20c5.5-2.5 4-9 4-9s-6.5 1-6 7"></path><path d="M9.5 9.5C8 5 3 5 3 5s0 5 4.5 6.5"></path><path d="M14 11c.5-4 4-5 7-5 0 3-1.5 6-5 7"></path></svg></span>',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -16]
  });
}

function projectPopup(project) {
  const photo = project.photo_path
    ? `<button type="button" class="girls-map-cover" data-open-project-gallery="${escapeAttribute(project.id)}" aria-label="Open photos for ${escapeAttribute(project.green_space_name)}"><img src="${escapeAttribute(publicPhotoUrl(project.photo_path))}" alt="${escapeAttribute(project.green_space_name)} cover photo"></button>`
    : "";
  return `
    <div class="girls-map-popup">
      ${photo}
      <strong>${escapeHtml(project.green_space_name)}</strong>
      <span>${escapeHtml(project.participant_name)} - ${escapeHtml(project.public_code)}</span>
      ${project.favourite_haiku ? `<blockquote>${escapeHtml(project.favourite_haiku)}</blockquote>` : ""}
      <small>${Number(project.entry_count || 0)} reflection ${Number(project.entry_count || 0) === 1 ? "entry" : "entries"}</small>
      <small>${Number(project.latitude).toFixed(4)}, ${Number(project.longitude).toFixed(4)}</small>
      <button type="button" class="girls-map-gallery-link" data-open-project-gallery="${escapeAttribute(project.id)}">View photos</button>
    </div>
  `;
}

async function openGalleryFromMap(event) {
  const button = event.target.closest("[data-open-project-gallery]");
  if (!button) return;
  event.preventDefault();
  const project = state.projects.find((item) => item.id === button.dataset.openProjectGallery);
  if (!project) return;
  els.galleryTitle.textContent = project.green_space_name;
  els.galleryStatus.textContent = "Loading photos...";
  els.galleryGrid.replaceChildren();
  if (typeof els.galleryDialog.showModal === "function") els.galleryDialog.showModal();
  else els.galleryDialog.setAttribute("open", "");
  try {
    const photos = await loadProjectPhotos(project.id);
    els.galleryStatus.textContent = `${photos.length} ${photos.length === 1 ? "photo" : "photos"}`;
    els.galleryGrid.innerHTML = photos.map((photo, index) => `
      <button type="button" data-map-photo-index="${index}" data-photo-path="${escapeAttribute(photo.storage_path)}" data-photo-name="${escapeAttribute(photo.original_name || `Photo ${index + 1}`)}">
        <img src="${escapeAttribute(publicPhotoUrl(photo.storage_path))}" alt="${escapeAttribute(project.green_space_name)} photo ${index + 1}" loading="lazy">
        ${photo.is_cover ? '<span>Cover</span>' : ""}
      </button>
    `).join("") || '<p class="girls-empty-copy">No photos have been added yet.</p>';
  } catch (error) {
    els.galleryStatus.textContent = error.message || "The photos could not be loaded.";
  }
}

function openMapPhoto(event) {
  const button = event.target.closest("[data-photo-path]");
  if (!button) return;
  els.photoViewerImage.src = publicPhotoUrl(button.dataset.photoPath);
  els.photoViewerName.textContent = button.dataset.photoName || "Project photo";
  if (typeof els.photoViewer.showModal === "function") els.photoViewer.showModal();
  else els.photoViewer.setAttribute("open", "");
}

function hasCoordinates(project) {
  return Number.isFinite(Number(project.latitude))
    && Number.isFinite(Number(project.longitude));
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function clean(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
