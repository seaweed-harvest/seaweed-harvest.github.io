import { authClient } from "./auth_client.js";

let viewer = null;
const signedUrlCache = new Map();

export function setupPhotoViewer(root = document) {
  const target = root || document;
  if (target.dataset?.photoViewerReady === "true") return;
  target.dataset && (target.dataset.photoViewerReady = "true");
  target.addEventListener("click", handlePhotoClick);
}

export function photoButtonMarkup(paths, bucket = "collection-photos", label = "") {
  const cleanPaths = normalizePaths(paths);
  if (!cleanPaths.length) return "-";
  const buttonLabel = label || `${cleanPaths.length} photo${cleanPaths.length === 1 ? "" : "s"}`;
  return `<button class="photo-count-button" type="button" data-photo-bucket="${escapeAttribute(bucket)}" data-photo-paths="${encodeURIComponent(JSON.stringify(cleanPaths))}">${escapeHtml(buttonLabel)}</button>`;
}

export async function signedPhotoUrl(bucket, path, expiresIn = 600) {
  const key = `${bucket}:${path}`;
  const cached = signedUrlCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.url;

  const { data, error } = await authClient.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
  if (error) throw error;
  const url = data?.signedUrl;
  if (!url) throw new Error("Photo preview is unavailable.");
  signedUrlCache.set(key, {
    url,
    expiresAt: Date.now() + Math.max(60, expiresIn - 30) * 1000
  });
  return url;
}

export async function openPhotoPreview(paths, bucket = "collection-photos", title = "Photos") {
  const cleanPaths = normalizePaths(paths);
  if (!cleanPaths.length) return;
  const dialog = prepareViewer(title);
  const status = dialog.querySelector("[data-photo-viewer-status]");
  const grid = dialog.querySelector("[data-photo-viewer-grid]");
  status.textContent = "Loading...";

  try {
    const urls = await Promise.all(cleanPaths.map((path) => signedPhotoUrl(bucket, path)));
    renderUrlItems(grid, urls.map((url, index) => ({
      url,
      alt: `${title} ${index + 1}`
    })));
    status.textContent = `${urls.length} photo${urls.length === 1 ? "" : "s"}`;
  } catch (error) {
    status.textContent = error.message || "Photo preview could not be loaded.";
  }
}

export function openPhotoUrlPreview(items, title = "Photos") {
  const cleanItems = normalizeUrlItems(items, title);
  if (!cleanItems.length) return;
  const dialog = prepareViewer(title);
  const status = dialog.querySelector("[data-photo-viewer-status]");
  const grid = dialog.querySelector("[data-photo-viewer-grid]");
  renderUrlItems(grid, cleanItems);
  status.textContent = `${cleanItems.length} photo${cleanItems.length === 1 ? "" : "s"}`;
}

function handlePhotoClick(event) {
  const button = event.target.closest("[data-photo-paths]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  let paths = [];
  try {
    paths = JSON.parse(decodeURIComponent(button.dataset.photoPaths || ""));
  } catch {
    paths = [];
  }
  void openPhotoPreview(
    paths,
    button.dataset.photoBucket || "collection-photos",
    button.dataset.photoTitle || "Photos"
  );
}

function prepareViewer(title) {
  const dialog = ensureViewer();
  const heading = dialog.querySelector("[data-photo-viewer-title]");
  const status = dialog.querySelector("[data-photo-viewer-status]");
  const grid = dialog.querySelector("[data-photo-viewer-grid]");
  heading.textContent = title;
  status.textContent = "";
  grid.replaceChildren();
  if (!dialog.open) dialog.showModal();
  return dialog;
}

function renderUrlItems(grid, items) {
  grid.replaceChildren();
  items.forEach((item, index) => {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.src = item.url;
    image.alt = item.alt || `Photo ${index + 1}`;
    image.loading = "eager";
    figure.append(image);
    if (item.caption) {
      const caption = document.createElement("figcaption");
      caption.className = "field-hint";
      caption.textContent = item.caption;
      figure.append(caption);
    }
    grid.append(figure);
  });
}

function ensureViewer() {
  if (viewer) return viewer;
  viewer = document.createElement("dialog");
  viewer.className = "record-photo-dialog";
  viewer.innerHTML = `
    <div class="record-photo-dialog-panel">
      <div class="record-photo-dialog-head">
        <div>
          <h2 data-photo-viewer-title>Photos</h2>
          <span data-photo-viewer-status></span>
        </div>
        <button type="button" class="icon-button" data-photo-viewer-close aria-label="Close photo preview" title="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
        </button>
      </div>
      <div class="record-photo-dialog-grid" data-photo-viewer-grid></div>
    </div>
  `;
  viewer.querySelector("[data-photo-viewer-close]").addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) viewer.close();
  });
  document.body.append(viewer);
  return viewer;
}

function normalizePaths(paths) {
  return [...new Set((Array.isArray(paths) ? paths : [])
    .map((path) => String(path || "").trim())
    .filter(Boolean))];
}

function normalizeUrlItems(items, title) {
  const seen = new Set();
  const output = [];
  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const raw = typeof item === "string" ? { url: item } : (item || {});
    const url = safePhotoUrl(raw.url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    output.push({
      url,
      caption: String(raw.caption || "").trim(),
      alt: String(raw.alt || `${title} ${index + 1}`).trim()
    });
  });
  return output;
}

function safePhotoUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
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
