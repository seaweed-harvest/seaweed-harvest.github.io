// Presentation helpers only. The caller supplies already-authorised record data
// and the shared signed-URL loader. No RPC interception or DOM observers.
export function isCombinedReefRecord(detail) {
  return Boolean(detail.legacy_general_seaweed || detail.legacy_inspection
    || (Array.isArray(detail.legacy_raft_seaweed) && detail.legacy_raft_seaweed.length));
}

export function formatSessionTime(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : (text || "Not recorded");
}

export function competencyBadge(value) {
  const raw = String(value ?? "").trim();
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  const styles = {
    independent: ["Independent", "independent"],
    with_supervision: ["With supervision", "supervision"],
    needs_support: ["Needs support", "needs-support"],
    not_assessed: ["Not assessed", "not-assessed"],
    "": ["Not assessed", "not-assessed"]
  };
  // Unknown future values stay visible and neutral; never imply proficiency.
  const [label, tone] = Object.hasOwn(styles, key)
    ? styles[key] : [raw.replaceAll("_", " "), "not-assessed"];
  return `<span class="reef-competency-pill is-${tone}">${escapeHtml(label)}</span>`;
}

export function reportPhotosMarkup(photos) {
  const items = (Array.isArray(photos) ? photos : []).filter((photo) => photo?.storage_path);
  if (!items.length) return "";
  return `<section class="reef-legacy-section"><h4>Photos</h4>
    <div class="reef-report-photos">${items.map((photo, index) => {
      const name = photo.original_name || `Photo ${photo.photo_order || index + 1}`;
      return `<button class="reef-report-thumbnail" type="button"
        data-reef-report-photo="${escapeHtml(photo.storage_path)}"
        data-photo-name="${escapeHtml(name)}" aria-label="Open ${escapeHtml(name)}">
        <span class="reef-report-thumbnail-image">
          <img alt="${escapeHtml(name)}" loading="lazy" decoding="async" hidden>
          <span data-thumbnail-status>Loading photo…</span>
        </span>
        <span class="reef-report-thumbnail-caption" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      </button>`;
    }).join("")}</div></section>`;
}

export async function loadReportThumbnails(root, loadUrl) {
  const buttons = [...root.querySelectorAll("[data-reef-report-photo]")];
  await Promise.all(buttons.map(async (button) => {
    const image = button.querySelector("img");
    const status = button.querySelector("[data-thumbnail-status]");
    const unavailable = () => {
      if (!button.isConnected) return;
      image.hidden = true;
      status.hidden = false;
      status.textContent = "Preview unavailable — open photo";
    };
    try {
      const url = await loadUrl(button.dataset.reefReportPhoto);
      if (!button.isConnected) return;
      image.addEventListener("error", unavailable, { once: true });
      image.addEventListener("load", () => {
        if (!button.isConnected) return;
        image.hidden = false;
        status.hidden = true;
      }, { once: true });
      image.src = url;
      // Reserve the layout before a lazy image reaches the viewport.
      image.hidden = false;
    } catch {
      unavailable();
    }
  }));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}
