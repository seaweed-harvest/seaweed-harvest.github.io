import { authClient, requireAdminAccess } from "./auth_client.js?v=22";

const TAG_LABELS = Object.freeze({
  farmer: "Farmer ID",
  sack: "Sack ID",
  jug: "Jug ID",
  custom: "ID"
});

const state = {
  context: null,
  activeBatches: [],
  displayedTags: [],
  busy: false
};
const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  applySheetSize();
  updateTypeControls();

  try {
    const access = await requireAdminAccess("can_access_admin");
    if (!access) return;
    await loadContext();
  } catch (error) {
    setStatus(error.message, "error");
    els.tagAccessStatus.textContent = "Numbering unavailable";
    els.tagAccessStatus.classList.add("status-muted");
  }
}

function cacheElements() {
  [
    "tagGeneratorForm", "tagType", "tagQuantity", "tagNextId", "tagWidthMm",
    "tagHeightMm", "tagQrMm", "customIdsField", "customIds", "generateTags",
    "generateTrialSet", "printTags", "tagCountStatus", "tagAccessStatus",
    "tagSheet", "tagSheetRange", "reloadTagBatches", "tagBatchRows"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  els.tagGeneratorForm.addEventListener("submit", reserveSelectedTags);
  els.generateTrialSet.addEventListener("click", reserveTrialSet);
  els.tagType.addEventListener("change", updateTypeControls);
  els.printTags.addEventListener("click", printCurrentSheet);
  els.reloadTagBatches.addEventListener("click", loadContext);
  els.tagBatchRows.addEventListener("click", reopenBatch);
  [els.tagWidthMm, els.tagHeightMm, els.tagQrMm].forEach((element) => {
    element.addEventListener("change", () => {
      applySheetSize();
      renderTags();
    });
  });
}

async function loadContext() {
  setBusy(true);
  setStatus("Loading tag numbering...");
  try {
    state.context = await rpc("ag_tag_generator_context");
    renderContext();
    setStatus("Numbering is ready.");
    els.tagAccessStatus.textContent = "Supabase numbering ready";
    els.tagAccessStatus.classList.remove("status-muted");
  } catch (error) {
    setStatus(error.message, "error");
    els.tagAccessStatus.textContent = "Numbering unavailable";
    els.tagAccessStatus.classList.add("status-muted");
  } finally {
    setBusy(false);
  }
}

function renderContext() {
  updateTypeControls();
  const batches = state.context?.recent_batches || [];
  els.tagBatchRows.innerHTML = batches.map((batch) => `
    <tr>
      <td>${html(formatDateTime(batch.reserved_at))}</td>
      <td>${html(TAG_LABELS[batch.tag_type] || batch.tag_type)}</td>
      <td><strong>${html(batch.first_id)}</strong> to <strong>${html(batch.last_id)}</strong></td>
      <td>${number(batch.quantity)}</td>
      <td>${number(batch.print_count)}</td>
      <td><button type="button" data-reopen-batch="${html(batch.batch_id)}">Open</button></td>
    </tr>
  `).join("") || '<tr><td colspan="6">No reserved batches.</td></tr>';
}

function updateTypeControls() {
  const type = els.tagType.value;
  const custom = type === "custom";
  els.customIdsField.hidden = !custom;
  els.tagQuantity.disabled = custom;
  els.tagNextId.value = custom ? "Not reserved" : (state.context?.next_ids?.[type] || "-");
  els.generateTags.textContent = custom ? "Generate custom sheet" : "Reserve and generate";
}

async function reserveSelectedTags(event) {
  event.preventDefault();
  if (state.busy) return;
  const type = els.tagType.value;
  if (type === "custom") {
    const ids = parseCustomIds(els.customIds.value).slice(0, 240);
    if (!ids.length) {
      setStatus("Enter at least one custom ID.", "error");
      return;
    }
    state.activeBatches = [];
    state.displayedTags = ids.map((id) => ({ id, type: inferType(id) }));
    renderTags();
    setStatus(`${ids.length} custom tags generated. These IDs are not reserved in Supabase.`);
    return;
  }

  const quantity = cleanInteger(els.tagQuantity.value, 1, 240, 10);
  const confirmed = window.confirm(`Reserve ${quantity} ${TAG_LABELS[type]} tags? Reserved numbers cannot be reused.`);
  if (!confirmed) return;

  setBusy(true);
  setStatus("Reserving IDs...");
  try {
    const batch = await rpc("ag_reserve_tag_ids", { p_tag_type: type, p_quantity: quantity });
    showBatches([batch]);
    await refreshContextSilently();
    setStatus(`${quantity} ${TAG_LABELS[type]} tags reserved: ${batch.first_id} to ${batch.last_id}.`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function reserveTrialSet() {
  if (state.busy) return;
  const quantity = cleanInteger(els.tagQuantity.value, 1, 80, 10);
  const confirmed = window.confirm(
    `Reserve ${quantity} Farmer, ${quantity} Sack, and ${quantity} Jug tags (${quantity * 3} total)? Reserved numbers cannot be reused.`
  );
  if (!confirmed) return;

  setBusy(true);
  setStatus("Reserving trial tag set...");
  try {
    const result = await rpc("ag_reserve_trial_tag_set", { p_quantity_each: quantity });
    showBatches(result.batches || []);
    await refreshContextSilently();
    setStatus(`${result.total} trial tags reserved: ${quantity} of each type.`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function reopenBatch(event) {
  const button = event.target.closest("[data-reopen-batch]");
  if (!button) return;
  const batch = (state.context?.recent_batches || []).find((item) => item.batch_id === button.dataset.reopenBatch);
  if (!batch) return;
  showBatches([batch]);
  setStatus(`${batch.quantity} tags reopened for reprinting.`);
  els.tagSheet.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showBatches(batches) {
  state.activeBatches = batches.filter((batch) => batch.batch_id);
  state.displayedTags = batches.flatMap((batch) => (batch.tag_ids || []).map((id) => ({ id, type: batch.tag_type })));
  renderTags();
}

function renderTags() {
  applySheetSize();
  els.tagSheet.innerHTML = state.displayedTags.map(renderTag).join("");
  els.printTags.disabled = !state.displayedTags.length;
  els.tagSheetRange.textContent = sheetRange();
  if (!state.displayedTags.length) {
    els.tagSheet.innerHTML = '<p class="tag-sheet-empty">Reserve a batch to create a printable sheet.</p>';
  }
}

function renderTag(tag) {
  const safeId = html(tag.id);
  const label = TAG_LABELS[tag.type] || "ID";
  return `
    <article class="print-tag" aria-label="${html(label)} ${safeId}">
      <div class="tag-text">
        <span>${html(label)}</span>
        <strong>${safeId}</strong>
      </div>
      <div class="tag-qr" aria-hidden="true">${makeQrSvg(tag.id)}</div>
      <div class="tag-repeat">${safeId}</div>
    </article>
  `;
}

async function printCurrentSheet() {
  if (!state.displayedTags.length || state.busy) return;
  setBusy(true);
  try {
    const batchIds = [...new Set(state.activeBatches.map((batch) => batch.batch_id))];
    await Promise.all(batchIds.map((batchId) => rpc("ag_mark_tag_batch_printed", { p_batch_id: batchId })));
    window.print();
    await refreshContextSilently();
  } catch (error) {
    setStatus(`Print record could not be saved: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

async function refreshContextSilently() {
  state.context = await rpc("ag_tag_generator_context");
  renderContext();
}

function applySheetSize() {
  const width = cleanInteger(els.tagWidthMm.value, 25, 120, 60);
  const height = cleanInteger(els.tagHeightMm.value, 20, 80, 35);
  const qr = cleanInteger(els.tagQrMm.value, 14, Math.min(width, height), 24);
  els.tagSheet.style.setProperty("--tag-width", `${width}mm`);
  els.tagSheet.style.setProperty("--tag-height", `${height}mm`);
  els.tagSheet.style.setProperty("--tag-qr-size", `${qr}mm`);
}

function sheetRange() {
  const first = state.displayedTags[0]?.id;
  const last = state.displayedTags.at(-1)?.id;
  if (!first) return "";
  const types = new Set(state.displayedTags.map((tag) => tag.type));
  if (types.size > 1) return `${state.displayedTags.length} tags, ${types.size} types`;
  return first === last ? first : `${state.displayedTags.length} tags, ${first} to ${last}`;
}

function makeQrSvg(value) {
  if (typeof window.qrcode !== "function") return "";
  const qr = window.qrcode(0, "M");
  qr.addData(value);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function inferType(id) {
  const value = String(id || "").trim().toUpperCase();
  if (/^RID\d{4,}$/.test(value)) return "farmer";
  if (/^B-\d{4,}$/.test(value)) return "sack";
  if (/^P-\d{4,}$/.test(value)) return "jug";
  return "custom";
}

function parseCustomIds(value) {
  return [...new Set(String(value || "").split(/[\n,]+/).map((item) => item.trim().toUpperCase()).filter(Boolean))];
}

function cleanInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function setBusy(busy) {
  state.busy = busy;
  els.generateTags.disabled = busy;
  els.generateTrialSet.disabled = busy;
  els.reloadTagBatches.disabled = busy;
  els.printTags.disabled = busy || !state.displayedTags.length;
}

function setStatus(message, type = "") {
  els.tagCountStatus.textContent = message || "";
  els.tagCountStatus.dataset.status = type;
}

async function rpc(name, payload = {}) {
  const { data, error } = await authClient.rpc(name, payload);
  if (error) throw error;
  return data;
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-KE", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(new Date(value));
}

function number(value) {
  return Number(value || 0).toLocaleString("en-KE");
}

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
