const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheElements();
  bindEvents();
  applyTypeDefaults(false);
  generateTags();
}

function cacheElements() {
  [
    "tagGeneratorForm",
    "tagType",
    "tagPrefix",
    "tagStartNumber",
    "tagQuantity",
    "tagDigits",
    "tagWidthMm",
    "tagHeightMm",
    "tagQrMm",
    "customIds",
    "generateTags",
    "printTags",
    "tagCountStatus",
    "tagSheet"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.tagGeneratorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    generateTags();
  });
  els.tagType.addEventListener("change", () => {
    applyTypeDefaults(true);
    generateTags();
  });
  els.printTags.addEventListener("click", () => window.print());
  [
    els.tagPrefix,
    els.tagStartNumber,
    els.tagQuantity,
    els.tagDigits,
    els.tagWidthMm,
    els.tagHeightMm,
    els.tagQrMm,
    els.customIds
  ].forEach((element) => {
    element.addEventListener("change", generateTags);
  });
}

function applyTypeDefaults(clearCustom) {
  if (clearCustom) els.customIds.value = "";

  if (els.tagType.value === "farmer") {
    els.tagPrefix.value = "RID";
    els.tagStartNumber.value = "4300";
    els.tagDigits.value = "4";
    return;
  }

  if (els.tagType.value === "sack") {
    els.tagPrefix.value = "SACK";
    els.tagStartNumber.value = "1";
    els.tagDigits.value = "4";
  }
}

function generateTags() {
  const ids = buildIds();
  applySheetSize();

  els.tagSheet.innerHTML = ids.map((id) => renderTag(id)).join("");
  els.tagCountStatus.textContent = `${ids.length} tags`;
}

function buildIds() {
  const customIds = parseCustomIds(els.customIds.value);
  if (customIds.length) return customIds.slice(0, 240);

  const prefix = String(els.tagPrefix.value || "").trim().toUpperCase();
  const start = cleanInteger(els.tagStartNumber.value, 0, 99999999, 1);
  const quantity = cleanInteger(els.tagQuantity.value, 1, 240, 24);
  const digits = cleanInteger(els.tagDigits.value, 0, 8, 4);

  return Array.from({ length: quantity }, (_, index) => {
    const number = String(start + index).padStart(digits, "0");
    return `${prefix}${number}`;
  });
}

function parseCustomIds(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function applySheetSize() {
  const width = cleanInteger(els.tagWidthMm.value, 25, 120, 60);
  const height = cleanInteger(els.tagHeightMm.value, 20, 80, 35);
  const qr = cleanInteger(els.tagQrMm.value, 14, Math.min(width, height), 24);

  els.tagSheet.style.setProperty("--tag-width", `${width}mm`);
  els.tagSheet.style.setProperty("--tag-height", `${height}mm`);
  els.tagSheet.style.setProperty("--tag-qr-size", `${qr}mm`);
}

function renderTag(id) {
  const safeId = escapeHtml(id);
  return `
    <article class="print-tag" aria-label="Tag ${safeId}">
      <div class="tag-text">
        <span>ID #</span>
        <strong>${safeId}</strong>
      </div>
      <div class="tag-qr" aria-hidden="true">${makeQrSvg(id)}</div>
      <div class="tag-repeat">${safeId}</div>
    </article>
  `;
}

function makeQrSvg(value) {
  if (typeof window.qrcode !== "function") return "";

  const qr = window.qrcode(0, "M");
  qr.addData(value);
  qr.make();
  return qr.createSvgTag({
    cellSize: 4,
    margin: 2,
    scalable: true
  });
}

function cleanInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
