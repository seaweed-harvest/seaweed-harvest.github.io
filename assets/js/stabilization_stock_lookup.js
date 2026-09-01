import {
  authClient,
  hasOrganisationCapability,
  requireAdminAccess
} from "./auth_client.js";

const state = {
  rows: [],
  loading: false,
  loadSequence: 0
};

const els = {};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  void init();
}

async function init() {
  [
    "formLedgerAllPanel",
    "formLedgerCategories",
    "formLedgerViews"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  if (!els.formLedgerAllPanel || !els.formLedgerCategories) return;

  const access = await requireAdminAccess("can_view_data");
  if (!access || !hasOrganisationCapability(access.profile, "form_stock_record")) return;

  installStyles();
  buildLookup();
  bindEvents();
  observeRecordView();
  queueMicrotask(refreshVisibility);
}

function installStyles() {
  if (document.getElementById("stabilizationStockLookupStyles")) return;
  const style = document.createElement("style");
  style.id = "stabilizationStockLookupStyles";
  style.textContent = `
    .stock-container-lookup {
      margin-top: 18px;
    }
    .stock-container-lookup-intro {
      margin: 0 0 12px;
      color: var(--text-muted);
      font-size: var(--supporting-font-size, .82rem);
    }
    .stock-container-lookup-controls {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) auto;
      align-items: end;
      gap: 10px;
      margin-bottom: 12px;
    }
    .stock-container-lookup-controls label {
      min-width: 0;
      display: grid;
      gap: 6px;
    }
    .stock-container-lookup-controls input {
      width: 100%;
      box-sizing: border-box;
    }
    .stock-container-status {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      padding: 2px 8px;
      border: 1px solid var(--border-soft);
      border-radius: 999px;
      font-size: .78rem;
      font-weight: 700;
      white-space: nowrap;
    }
    .stock-container-status.removed {
      border-color: #e6b6ad;
      background: #fff3f0;
      color: #8f2f1f;
    }
    .stock-container-status.active {
      border-color: #b9d8ca;
      background: #eff9f4;
      color: #176044;
    }
    @media (max-width: 640px) {
      .stock-container-lookup-controls {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `;
  document.head.append(style);
}

function buildLookup() {
  const details = document.createElement("details");
  details.id = "stockContainerLookup";
  details.className = "admin-management-card stock-container-lookup";
  details.hidden = true;
  details.innerHTML = `
    <summary class="admin-card-summary">
      <strong>Container lookup</strong>
      <span id="stockContainerLookupCount" class="status-pill status-muted">0 records</span>
    </summary>
    <div class="admin-card-body">
      <p class="stock-container-lookup-intro">Enter one or more carton numbers to view the complete testing history and current active-stock status.</p>
      <div class="stock-container-lookup-controls">
        <label>Carton numbers
          <input id="stockContainerLookupInput" type="search" autocomplete="off" placeholder="For example: 101, 102, 103">
        </label>
        <button id="loadStockContainerLookup" type="button">Find container history</button>
      </div>
      <div class="responsive-table-wrap">
        <table class="management-table admin-data-table">
          <thead>
            <tr>
              <th>Container</th>
              <th>Date</th>
              <th>Entry</th>
              <th>Species</th>
              <th>Volume</th>
              <th>Stock status</th>
              <th>Latest stock action</th>
              <th>Reason</th>
              <th>Recorded by</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody id="stockContainerLookupRows">
            <tr><td colspan="10" class="empty-state">Enter a carton number to view its history.</td></tr>
          </tbody>
        </table>
      </div>
      <p id="stockContainerLookupStatus" class="admin-status" aria-live="polite"></p>
    </div>
  `;
  els.formLedgerAllPanel.append(details);

  [
    "stockContainerLookup",
    "stockContainerLookupCount",
    "stockContainerLookupInput",
    "loadStockContainerLookup",
    "stockContainerLookupRows",
    "stockContainerLookupStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  els.loadStockContainerLookup.addEventListener("click", loadContainerLookup);
  els.stockContainerLookupInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void loadContainerLookup();
  });
  els.formLedgerCategories.addEventListener("click", () => queueMicrotask(refreshVisibility));
  els.formLedgerViews?.addEventListener("click", () => queueMicrotask(refreshVisibility));
  document.addEventListener("stabilization-stock-restored", () => {
    if (els.stockContainerLookupInput.value.trim()) void loadContainerLookup();
  });
}

function observeRecordView() {
  const observer = new MutationObserver(refreshVisibility);
  observer.observe(els.formLedgerCategories, {
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-selected", "hidden"]
  });
  if (els.formLedgerViews) {
    observer.observe(els.formLedgerViews, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-selected", "hidden"]
    });
  }
}

function refreshVisibility() {
  const stockSelected = els.formLedgerCategories.querySelector(
    '[data-ledger-category="stock"][aria-selected="true"]'
  );
  const allSelected = els.formLedgerViews?.querySelector(
    '[data-ledger-mode="all"][aria-selected="true"]'
  );
  els.stockContainerLookup.hidden = !(stockSelected && allSelected && !els.formLedgerAllPanel.hidden);
}

async function loadContainerLookup() {
  const query = els.stockContainerLookupInput.value.trim();
  if (!query) {
    state.rows = [];
    renderContainerLookup();
    setStatus("Enter at least one carton number.", "error");
    els.stockContainerLookupInput.focus();
    return;
  }

  const tokens = query.split(/[\s,]+/).filter(Boolean);
  if (tokens.length > 100) {
    setStatus("Look up no more than 100 cartons at a time.", "error");
    return;
  }

  state.loading = true;
  const sequence = ++state.loadSequence;
  els.loadStockContainerLookup.disabled = true;
  setStatus("Loading container history...");
  try {
    const { data, error } = await authClient.rpc("ag_stock_container_lookup", {
      p_containers: query,
      p_start_date: null,
      p_end_date: null,
      p_result_limit: 2000
    });
    if (error) throw error;
    if (sequence !== state.loadSequence) return;
    const result = Array.isArray(data) ? data[0] : data;
    state.rows = Array.isArray(result?.rows) ? result.rows : [];
    renderContainerLookup();
    const containerCount = Number(result?.container_count || 0);
    const recordCount = Number(result?.record_count || state.rows.length);
    const truncation = result?.truncated ? " Showing the first 2,000 records." : "";
    setStatus(
      `${formatInteger(recordCount)} record${recordCount === 1 ? "" : "s"} across ${formatInteger(containerCount)} container${containerCount === 1 ? "" : "s"}.${truncation}`
    );
  } catch (error) {
    state.rows = [];
    renderContainerLookup(error.message || "Container history could not be loaded.");
    setStatus(error.message || "Container history could not be loaded.", "error");
  } finally {
    state.loading = false;
    els.loadStockContainerLookup.disabled = false;
  }
}

function renderContainerLookup(errorMessage = "") {
  els.stockContainerLookupCount.textContent = `${formatInteger(state.rows.length)} ${state.rows.length === 1 ? "record" : "records"}`;
  if (errorMessage || !state.rows.length) {
    els.stockContainerLookupRows.innerHTML = `
      <tr><td colspan="10" class="empty-state">${escapeHtml(errorMessage || "No matching container history was found.")}</td></tr>
    `;
    return;
  }

  els.stockContainerLookupRows.innerHTML = state.rows.map((row) => {
    const entry = row.record_type === "retest"
      ? `Retest ${row.test_sequence || ""}`.trim()
      : "New";
    const action = row.stock_action_type
      ? [
        titleCase(row.stock_action_type),
        row.stock_action_date ? formatDate(row.stock_action_date) : "",
        row.stock_action_recorded_by ? `by ${row.stock_action_recorded_by}` : ""
      ].filter(Boolean).join(" · ")
      : "No stock movement";
    const reason = [row.stock_action_reason, row.stock_action_note]
      .filter(Boolean)
      .join(" — ") || "-";
    return `
      <tr>
        <td><strong>${escapeHtml(row.carton_serial || "-")}</strong></td>
        <td>${escapeHtml(formatDate(row.record_date))}</td>
        <td>${escapeHtml(entry)}</td>
        <td>${escapeHtml(titleCase(row.species))}</td>
        <td>${escapeHtml(measurement(row.weight_value, row.weight_unit))}</td>
        <td><span class="stock-container-status ${escapeAttribute(row.stock_status || "active")}">${escapeHtml(titleCase(row.stock_status || "active"))}</span></td>
        <td>${escapeHtml(action)}</td>
        <td>${escapeHtml(reason)}</td>
        <td>${escapeHtml(row.recorded_by_name || "-")}</td>
        <td>${escapeHtml(row.notes || "-")}</td>
      </tr>
    `;
  }).join("");
}

function setStatus(message, status = "") {
  els.stockContainerLookupStatus.textContent = message || "";
  if (status) els.stockContainerLookupStatus.dataset.status = status;
  else delete els.stockContainerLookupStatus.dataset.status;
}

function formatInteger(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.round(number).toLocaleString("en-KE")
    : "0";
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-KE", { maximumFractionDigits: 3 })
    : "0";
}

function measurement(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${formatNumber(number)}${unit ? ` ${unit}` : ""}`;
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

function escapeAttribute(value) {
  return escapeHtml(value);
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
