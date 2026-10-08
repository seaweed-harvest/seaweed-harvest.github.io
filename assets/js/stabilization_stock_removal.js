import {
  authClient,
  requireOrganisationCapability
} from "./auth_client.js";

export const STOCK_REMOVAL_REASONS = Object.freeze([
  ["sold_dispatched", "Sold or dispatched"],
  ["quality_rejected", "Quality issue / rejected"],
  ["damaged_leaking", "Damaged or leaking"],
  ["testing_samples", "Used for testing or samples"],
  ["missing_inventory", "Missing / inventory correction"],
  ["other", "Other"]
]);

const STATUS_LABELS = Object.freeze({
  ready: "Ready",
  missing: "Not found",
  ambiguous: "Choose physical carton",
  invalid_selection: "Invalid carton selection",
  inactive: "Already inactive",
  unsupported_volume: "Unsupported legacy unit"
});

const state = {
  entryMode: "single",
  action: "initial",
  preview: null,
  previewSignature: "",
  selectedCartons: {},
  actionGroupId: crypto.randomUUID(),
  profile: null
};

const els = {};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  void init();
}

async function init() {
  [
    "packingEntryTabs",
    "packingSingleTab",
    "packingBatchTab",
    "packingRecordForm",
    "packingBatchForm",
    "existingCartonSerials"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  if (!els.packingEntryTabs || !els.packingRecordForm || !els.packingBatchForm) return;

  const access = await requireOrganisationCapability(
    "form_stock_record",
    "can_submit_collection",
    "stabilization_packing.html"
  );
  if (!access) return;
  state.profile = access.profile;

  hideLegacyRecordTypeSelector();
  installStyles();
  buildActionSelector();
  buildRemovalForm();
  bindEvents();
  syncEntryMode();
  syncView();
}

function hideLegacyRecordTypeSelector() {
  const firstControl = els.packingRecordForm.querySelector('[name="packingRecordType"]');
  const legacySelector = firstControl?.closest(".standard-choice-field");
  if (legacySelector) {
    legacySelector.hidden = true;
    legacySelector.setAttribute("aria-hidden", "true");
  }
}

function installStyles() {
  if (document.getElementById("packingStockRemovalStyles")) return;
  const style = document.createElement("style");
  style.id = "packingStockRemovalStyles";
  style.textContent = `
    .packing-stock-actions {
      margin: 0 0 12px;
    }
    .packing-stock-actions .standard-segmented-control {
      width: max-content;
      max-width: 100%;
      flex-wrap: wrap;
    }
    .packing-removal-summary {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin: 0;
    }
    .packing-removal-summary > div {
      display: grid;
      gap: 3px;
      padding: 10px 12px;
      border: 1px solid var(--border-soft);
      border-radius: 8px;
      background: var(--surface-soft, #f7faf9);
    }
    .packing-removal-summary span {
      color: var(--text-muted);
      font-size: var(--supporting-font-size, .78rem);
      font-weight: 700;
    }
    .packing-removal-summary strong {
      font-size: 1.05rem;
    }
    .packing-removal-preview-wrap {
      max-width: 100%;
      overflow-x: auto;
    }
    .packing-removal-preview-table {
      width: 100%;
      border-collapse: collapse;
    }
    .packing-removal-preview-table th,
    .packing-removal-preview-table td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--border-soft);
      text-align: left;
      white-space: nowrap;
    }
    .packing-removal-preview-table td:last-child {
      white-space: normal;
    }
    .packing-removal-warning {
      margin: 0;
      color: #8a4b13;
      font-weight: 600;
    }
    .packing-removal-choice { display: block; min-width: 210px; max-width: 340px; }
    .packing-removal-choice select { width: 100%; margin-top: 4px; }
    .packing-removal-choice .standard-field-hint { white-space: normal; display: block; }
    .packing-removal-help {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--supporting-font-size, .82rem);
    }
    @media (max-width: 640px) {
      .packing-removal-summary {
        grid-template-columns: minmax(0, 1fr);
      }
      .packing-stock-actions .standard-segmented-control {
        width: 100%;
      }
    }
  `;
  document.head.append(style);
}

function buildActionSelector() {
  const container = document.createElement("div");
  container.id = "packingStockActions";
  container.className = "standard-choice-field packing-stock-actions";
  container.innerHTML = `
    <span class="standard-field-label">Stock action</span>
    <div class="standard-segmented-control" role="radiogroup" aria-label="Stock action">
      <label id="packingNewActionLabel">
        <input type="radio" name="packingStockAction" value="initial" checked>
        <span>New carton</span>
      </label>
      <label id="packingRetestActionLabel">
        <input type="radio" name="packingStockAction" value="retest">
        <span>Retest existing</span>
      </label>
      <label>
        <input type="radio" name="packingStockAction" value="remove">
        <span>Remove from stock</span>
      </label>
    </div>
  `;
  els.packingEntryTabs.insertAdjacentElement("afterend", container);
  els.packingStockActions = container;
  els.packingNewActionLabel = container.querySelector("#packingNewActionLabel");
  els.packingRetestActionLabel = container.querySelector("#packingRetestActionLabel");
}

function buildRemovalForm() {
  const form = document.createElement("form");
  form.id = "packingRemovalForm";
  form.className = "stock-record-form standard-form standard-form-linear-layout";
  form.hidden = true;
  form.innerHTML = `
    <label class="packing-recorder-field form-recorder-field">
      <span>Recorded by</span>
      <input id="packingRemovalRecordedBy" type="text" readonly>
    </label>

    <fieldset>
      <legend>Cartons to remove</legend>
      <label id="packingRemovalSingleField">Carton number
        <input id="packingRemovalSingle" type="text" inputmode="numeric" pattern="[0-9]+" maxlength="18" autocomplete="off" list="existingCartonSerials">
        <span class="standard-field-hint">Enter one existing active carton.</span>
      </label>
      <label id="packingRemovalFirstField" hidden>First carton number
        <input id="packingRemovalFirst" type="text" inputmode="numeric" pattern="[0-9]+" maxlength="18" autocomplete="off" disabled>
      </label>
      <label id="packingRemovalLastField" hidden>Last carton number
        <input id="packingRemovalLast" type="text" inputmode="numeric" pattern="[0-9]+" maxlength="18" autocomplete="off" disabled>
        <span class="standard-field-hint">Maximum 100 cartons in one action.</span>
      </label>
      <button id="previewPackingRemoval" type="button">Preview cartons</button>
      <p class="packing-removal-help">For duplicate numbers, choose the physical carton by date, volume and recorded-by details. Batch removal selects one carton per number.</p>
    </fieldset>

    <fieldset>
      <legend>Removal details</legend>
      <label>Removal date
        <input id="packingRemovalDate" type="date" required>
      </label>
      <label>Reason
        <select id="packingRemovalReason" required>
          <option value="">Select a reason</option>
          ${STOCK_REMOVAL_REASONS.map(([value, label]) => (
            `<option value="${value}">${label}</option>`
          )).join("")}
        </select>
      </label>
    </fieldset>

    <label class="packing-notes-field">Optional note
      <textarea id="packingRemovalNote" rows="2" maxlength="1000"></textarea>
    </label>

    <div class="packing-removal-summary" aria-live="polite">
      <div><span>Cartons ready</span><strong id="packingRemovalCount">0</strong></div>
      <div><span>Total recorded volume</span><strong id="packingRemovalLitres">0 L</strong></div>
    </div>

    <p id="packingRemovalWarning" class="packing-removal-warning" hidden></p>
    <div class="packing-removal-preview-wrap">
      <table class="packing-removal-preview-table">
        <thead>
          <tr>
            <th>Requested</th>
            <th>Carton</th>
            <th>Volume</th>
            <th>Species</th>
            <th>Tests</th>
            <th>Latest test</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="packingRemovalPreviewRows">
          <tr><td colspan="7" class="empty-state">Preview cartons before confirming.</td></tr>
        </tbody>
      </table>
    </div>

    <div class="button-row standard-form-actions">
      <button id="confirmPackingRemoval" class="danger-button" type="submit" disabled>Remove from stock</button>
      <button id="clearPackingRemoval" type="button">Clear</button>
      <p id="packingRemovalStatus" class="admin-status" aria-live="polite"></p>
    </div>
  `;
  els.packingBatchForm.insertAdjacentElement("afterend", form);

  [
    "packingRemovalForm",
    "packingRemovalRecordedBy",
    "packingRemovalSingleField",
    "packingRemovalSingle",
    "packingRemovalFirstField",
    "packingRemovalFirst",
    "packingRemovalLastField",
    "packingRemovalLast",
    "previewPackingRemoval",
    "packingRemovalDate",
    "packingRemovalReason",
    "packingRemovalNote",
    "packingRemovalCount",
    "packingRemovalLitres",
    "packingRemovalWarning",
    "packingRemovalPreviewRows",
    "confirmPackingRemoval",
    "clearPackingRemoval",
    "packingRemovalStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  els.packingRemovalRecordedBy.value = state.profile?.display_name
    || state.profile?.email
    || "Signed-in user";
  els.packingRemovalDate.value = kenyaDate();
}

function bindEvents() {
  els.packingStockActions.addEventListener("change", handleActionChange);
  els.packingEntryTabs.addEventListener("click", () => {
    queueMicrotask(() => {
      syncEntryMode();
      syncView();
    });
  });
  els.previewPackingRemoval.addEventListener("click", previewRemoval);
  els.packingRemovalForm.addEventListener("submit", submitRemoval);
  els.clearPackingRemoval.addEventListener("click", clearRemoval);
  [els.packingRemovalSingle, els.packingRemovalFirst, els.packingRemovalLast]
    .forEach((control) => control.addEventListener("input", () => {
      state.selectedCartons = {};
      invalidatePreview();
    }));
  els.packingRemovalPreviewRows.addEventListener("change", (event) => {
    const select = event.target.closest("select[data-carton-number]");
    if (!select) return;
    const key = select.dataset.cartonNumber;
    if (select.value) state.selectedCartons[key] = select.value;
    else delete state.selectedCartons[key];
    invalidatePreview();
    void previewRemoval();
  });
}

function handleActionChange(event) {
  const control = event.target.closest('[name="packingStockAction"]');
  if (!control) return;
  state.action = control.value;
  if (state.entryMode === "batch" && state.action === "retest") {
    state.action = "initial";
  }
  syncView();
}

function syncEntryMode() {
  state.entryMode = els.packingBatchTab.getAttribute("aria-selected") === "true"
    ? "batch"
    : "single";
  if (state.entryMode === "batch" && state.action === "retest") {
    state.action = "initial";
    const initial = els.packingStockActions.querySelector(
      '[name="packingStockAction"][value="initial"]'
    );
    if (initial) initial.checked = true;
  }
  state.selectedCartons = {};
  invalidatePreview();
}

function syncView() {
  const removing = state.action === "remove";
  els.packingNewActionLabel.querySelector("span").textContent = state.entryMode === "batch"
    ? "New cartons"
    : "New carton";
  els.packingRetestActionLabel.hidden = state.entryMode === "batch";

  const legacyType = state.action === "retest" ? "retest" : "initial";
  const legacyControl = els.packingRecordForm.querySelector(
    `[name="packingRecordType"][value="${legacyType}"]`
  );
  if (legacyControl && !legacyControl.checked) {
    legacyControl.checked = true;
    legacyControl.dispatchEvent(new Event("change", { bubbles: true }));
  }

  els.packingRecordForm.hidden = removing || state.entryMode !== "single";
  els.packingBatchForm.hidden = removing || state.entryMode !== "batch";
  els.packingRemovalForm.hidden = !removing;

  const single = state.entryMode === "single";
  els.packingRemovalSingleField.hidden = !single;
  els.packingRemovalSingle.disabled = !single;
  els.packingRemovalSingle.required = single;
  els.packingRemovalFirstField.hidden = single;
  els.packingRemovalLastField.hidden = single;
  els.packingRemovalFirst.disabled = single;
  els.packingRemovalLast.disabled = single;
  els.packingRemovalFirst.required = !single;
  els.packingRemovalLast.required = !single;

  const target = removing
    ? (single ? els.packingRemovalSingle : els.packingRemovalFirst)
    : (single ? document.getElementById("cartonSerial") : document.getElementById("packingBatchFirst"));
  queueMicrotask(() => target?.focus());
}

function removalRange() {
  if (state.entryMode === "single") {
    const carton = els.packingRemovalSingle.value.trim();
    return { first: carton, last: carton };
  }
  return {
    first: els.packingRemovalFirst.value.trim(),
    last: els.packingRemovalLast.value.trim()
  };
}

function currentSignature() {
  const range = removalRange();
  return JSON.stringify({ mode: state.entryMode, ...range, selectedCartons: state.selectedCartons });
}

function invalidatePreview() {
  state.preview = null;
  state.previewSignature = "";
  if (!els.confirmPackingRemoval) return;
  els.confirmPackingRemoval.disabled = true;
  els.confirmPackingRemoval.textContent = "Remove from stock";
  els.packingRemovalCount.textContent = "0";
  els.packingRemovalLitres.textContent = "0 L";
  els.packingRemovalWarning.hidden = true;
  els.packingRemovalWarning.textContent = "";
  els.packingRemovalPreviewRows.innerHTML = `
    <tr><td colspan="7" class="empty-state">Preview cartons before confirming.</td></tr>
  `;
}

function reportRangeValidity() {
  const controls = state.entryMode === "single"
    ? [els.packingRemovalSingle]
    : [els.packingRemovalFirst, els.packingRemovalLast];
  const invalid = controls.find((control) => !control.checkValidity());
  if (!invalid) return true;
  invalid.reportValidity();
  return false;
}

async function previewRemoval() {
  if (!reportRangeValidity()) return;
  const range = removalRange();
  const signature = currentSignature();
  setRemovalStatus("Checking current stock...");
  els.previewPackingRemoval.disabled = true;
  try {
    const { data, error } = await authClient.rpc(
      "ag_preview_stabilization_stock_removal_with_selection",
      {
        p_first_carton_serial: range.first,
        p_last_carton_serial: range.last,
        p_selected_cartons: state.selectedCartons
      }
    );
    if (error) throw error;
    if (signature !== currentSignature()) return; // Ignore superseded previews.
    const result = Array.isArray(data) ? data[0] : data;
    state.preview = result || null;
    state.previewSignature = signature;
    renderPreview(result);
    setRemovalStatus(result?.valid
      ? "Every selected carton is ready. Confirm removal below."
      : "Choose the physical carton for each duplicate number, or resolve highlighted checks.",
    result?.valid ? "" : "error");
  } catch (error) {
    invalidatePreview();
    setRemovalStatus(error.message || "The cartons could not be previewed.", "error");
  } finally {
    els.previewPackingRemoval.disabled = false;
  }
}

function canonicalCartonNumber(value) {
  return String(value || "0").replace(/^0+(?=\d)/, "");
}
function renderCartonChoice(row) {
  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  const key = canonicalCartonNumber(row.requested_serial);
  if (Number(row.active_count || 0) < 2 && !(state.selectedCartons[key] && row.status !== "ready")) {
    return escapeHtml(row.carton_serial || "-");
  }
  const selected = state.selectedCartons[key] || "";
  let html = '<label class="packing-removal-choice">Choose physical carton <select data-carton-number="'
    + escapeHtml(key) + '" aria-label="Choose physical carton '
    + escapeHtml(row.requested_serial) + '"><option value="">Select carton…</option>';
  for (const candidate of candidates) {
    const label = [formatDate(candidate.first_packed_on),
      candidate.volume_l == null ? "Volume unknown" : formatNumber(candidate.volume_l) + " L",
      titleCase(candidate.species), candidate.recorded_by_name || "Recorder unknown",
      "Record " + String(candidate.carton_instance_id || "").slice(0, 8).toUpperCase(),
      candidate.status === "inactive" ? "Already removed" : ""
    ].filter(Boolean).join(" · ");
    html += '<option value="' + escapeHtml(candidate.carton_instance_id) + '"'
      + (candidate.status === "inactive" ? " disabled" : "")
      + (candidate.carton_instance_id === selected ? " selected" : "")
      + ">" + escapeHtml(label) + "</option>";
  }
  return html + '</select><span class="standard-field-hint">'
    + candidates.length + " physical cartons share this number.</span></label>";
}

function renderPreview(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const ready = rows.filter((row) => row.status === "ready");
  els.packingRemovalCount.textContent = String(ready.length);
  els.packingRemovalLitres.textContent = `${formatNumber(result?.total_litres)} L`;
  els.packingRemovalPreviewRows.innerHTML = rows.length
    ? rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.requested_serial || "-")}</td>
        <td>${renderCartonChoice(row)}</td>
        <td>${row.volume_l == null ? "-" : `${escapeHtml(formatNumber(row.volume_l))} L`}</td>
        <td>${escapeHtml(titleCase(row.species))}</td>
        <td>${escapeHtml(String(row.test_count ?? 0))}</td>
        <td>${escapeHtml(formatDate(row.latest_test_date))}</td>
        <td>${escapeHtml(STATUS_LABELS[row.status] || row.status || "-")}</td>
      </tr>
    `).join("")
    : '<tr><td colspan="7" class="empty-state">No cartons were returned.</td></tr>';

  const invalid = rows.filter((row) => row.status !== "ready");
  els.packingRemovalWarning.hidden = invalid.length === 0;
  els.packingRemovalWarning.textContent = invalid.length
    ? invalid.map((row) => (
      `${row.requested_serial}: ${STATUS_LABELS[row.status] || row.status}`
    )).join("; ")
    : "";
  els.confirmPackingRemoval.disabled = !result?.valid;
  els.confirmPackingRemoval.textContent = result?.valid
    ? `Remove ${ready.length} carton${ready.length === 1 ? "" : "s"} — ${formatNumber(result.total_litres)} L`
    : "Remove from stock";
}

async function submitRemoval(event) {
  event.preventDefault();
  if (!els.packingRemovalForm.reportValidity()) return;
  if (!state.preview?.valid || state.previewSignature !== currentSignature()) {
    invalidatePreview();
    setRemovalStatus("Preview the current carton selection again before confirming.", "error");
    return;
  }

  const duplicateRows = (state.preview.rows || []).filter((row) => Number(row.physical_count || 0) > 1);
  if (state.entryMode === "batch" && duplicateRows.length && !window.confirm(
    `${duplicateRows.length} carton number(s) in this batch have multiple physical records.\n` +
    "You are removing exactly one selected physical carton for each number. Continue?"
  )) return;

  const range = removalRange();
  els.confirmPackingRemoval.disabled = true;
  els.previewPackingRemoval.disabled = true;
  setRemovalStatus("Recording the stock removal...");
  try {
    const { data, error } = await authClient.rpc(
      "ag_remove_stabilization_stock_with_selection",
      {
        p_action_group_id: state.actionGroupId,
        p_first_carton_serial: range.first,
        p_last_carton_serial: range.last,
        p_action_date: els.packingRemovalDate.value,
        p_reason_code: els.packingRemovalReason.value,
        p_note: textOrNull(els.packingRemovalNote.value),
        p_selected_cartons: state.selectedCartons
      }
    );
    if (error) throw error;
    const saved = Array.isArray(data) ? data[0] : data;
    // Another active carton may retain the same printed label.
    const count = Number(saved?.carton_count || 0);
    setRemovalStatus(
      `${count} carton${count === 1 ? "" : "s"} (${formatNumber(saved?.total_litres)} L) removed from active stock.`
    );
    state.actionGroupId = crypto.randomUUID();
    state.preview = null;
    state.previewSignature = "";
    state.selectedCartons = {};
    els.packingRemovalReason.value = "";
    els.packingRemovalNote.value = "";
    els.confirmPackingRemoval.textContent = "Remove from stock";
    els.packingRemovalWarning.hidden = true;
    els.packingRemovalPreviewRows.innerHTML = `
      <tr><td colspan="7" class="empty-state">Removal recorded. Preview another selection to continue.</td></tr>
    `;
  } catch (error) {
    els.confirmPackingRemoval.disabled = false;
    setRemovalStatus(error.message || "The stock removal could not be recorded.", "error");
  } finally {
    els.previewPackingRemoval.disabled = false;
  }
}

function clearRemoval() {
  state.selectedCartons = {};
  const recordedBy = els.packingRemovalRecordedBy.value;
  els.packingRemovalForm.reset();
  els.packingRemovalRecordedBy.value = recordedBy;
  els.packingRemovalDate.value = kenyaDate();
  state.actionGroupId = crypto.randomUUID();
  invalidatePreview();
  setRemovalStatus("");
  const target = state.entryMode === "single"
    ? els.packingRemovalSingle
    : els.packingRemovalFirst;
  target.focus();
}

function setRemovalStatus(message, status = "") {
  els.packingRemovalStatus.textContent = message || "";
  if (status) els.packingRemovalStatus.dataset.status = status;
  else delete els.packingRemovalStatus.dataset.status;
}

function textOrNull(value) {
  return String(value || "").trim() || null;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-KE", { maximumFractionDigits: 3 })
    : "0";
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function titleCase(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
