import {
  authClient,
  requireAdminAccess
} from "./auth_client.js";

const PAGE_SIZE = 50;

const state = {
  rows: [],
  total: 0,
  page: 0,
  loading: false,
  loadSequence: 0,
  restoreGroupId: "",
  restorationActionGroupId: ""
};

const els = {};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  void init();
}

async function init() {
  [
    "formLedgerWorkspace",
    "formLedgerAllPanel",
    "formLedgerCategories",
    "formLedgerViews",
    "formLedgerFrom",
    "formLedgerTo",
    "formLedgerSearch",
    "loadFormLedger"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  if (!els.formLedgerWorkspace || !els.formLedgerAllPanel || !els.formLedgerCategories) return;

  const access = await requireAdminAccess("can_view_data");
  if (!access) return;

  installStyles();
  buildLedgerSection();
  buildRestoreDialog();
  bindEvents();
  observeRecordView();
  queueMicrotask(refreshVisibility);
}

function installStyles() {
  if (document.getElementById("stabilizationStockLedgerStyles")) return;
  const style = document.createElement("style");
  style.id = "stabilizationStockLedgerStyles";
  style.textContent = `
    .stock-action-ledger {
      margin-top: 18px;
    }
    .stock-action-ledger .section-head {
      align-items: flex-start;
    }
    .stock-action-ledger-intro {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--supporting-font-size, .82rem);
    }
    .stock-action-cartons summary {
      cursor: pointer;
      font-weight: 700;
      white-space: nowrap;
    }
    .stock-action-carton-list {
      max-width: 420px;
      margin-top: 6px;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .stock-action-status {
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
    .stock-action-status.inactive {
      border-color: #e6b6ad;
      background: #fff3f0;
      color: #8f2f1f;
    }
    .stock-action-status.restored {
      border-color: #b9d8ca;
      background: #eff9f4;
      color: #176044;
    }
    .stock-restore-dialog {
      width: min(560px, calc(100vw - 28px));
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--panel, #fff);
      color: var(--text);
      box-shadow: 0 20px 60px rgba(0, 0, 0, .22);
    }
    .stock-restore-dialog::backdrop {
      background: rgba(18, 54, 47, .45);
    }
    .stock-restore-form {
      display: grid;
      gap: 14px;
      padding: 18px;
    }
    .stock-restore-form h3,
    .stock-restore-form p {
      margin: 0;
    }
    .stock-restore-form label {
      display: grid;
      gap: 6px;
      font-weight: 700;
    }
    .stock-restore-form input,
    .stock-restore-form textarea {
      width: 100%;
      box-sizing: border-box;
    }
    .stock-restore-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }
  `;
  document.head.append(style);
}

function buildLedgerSection() {
  const section = document.createElement("section");
  section.id = "stockActionLedger";
  section.className = "collection-calendar-records stock-action-ledger";
  section.hidden = true;
  section.innerHTML = `
    <div class="section-head compact">
      <div>
        <h3>Stock removals and restorations</h3>
        <p class="stock-action-ledger-intro">Immutable grouped stock-state events. Search above for any included carton number.</p>
      </div>
      <span id="stockActionLedgerCount" class="status-pill">0 events</span>
    </div>
    <div class="ledger-pagination">
      <button id="stockActionPreviousPage" type="button">Previous</button>
      <span id="stockActionPageStatus" class="admin-status">No events</span>
      <button id="stockActionNextPage" type="button">Next</button>
    </div>
    <div class="responsive-table-wrap">
      <table class="management-table admin-data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Action</th>
            <th>Cartons</th>
            <th>Count</th>
            <th>Volume L</th>
            <th>Species</th>
            <th>Reason</th>
            <th>Recorded by</th>
            <th>Note</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="stockActionLedgerRows">
          <tr><td colspan="11" class="empty-state">Open Stock Record to load stock actions.</td></tr>
        </tbody>
      </table>
    </div>
    <p id="stockActionLedgerStatus" class="admin-status" aria-live="polite"></p>
  `;
  els.formLedgerAllPanel.append(section);

  [
    "stockActionLedger",
    "stockActionLedgerCount",
    "stockActionPreviousPage",
    "stockActionPageStatus",
    "stockActionNextPage",
    "stockActionLedgerRows",
    "stockActionLedgerStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });
}

function buildRestoreDialog() {
  const dialog = document.createElement("dialog");
  dialog.id = "stockRestoreDialog";
  dialog.className = "stock-restore-dialog";
  dialog.innerHTML = `
    <form id="stockRestoreForm" class="stock-restore-form">
      <div>
        <h3>Restore cartons to active stock</h3>
        <p id="stockRestoreSummary"></p>
      </div>
      <label>Restoration date
        <input id="stockRestoreDate" type="date" required>
      </label>
      <label>Reason for restoration
        <textarea id="stockRestoreReason" rows="3" maxlength="1000" required></textarea>
      </label>
      <p id="stockRestoreStatus" class="admin-status" aria-live="polite"></p>
      <div class="stock-restore-actions">
        <button id="cancelStockRestore" type="button">Cancel</button>
        <button id="confirmStockRestore" type="submit">Restore cartons</button>
      </div>
    </form>
  `;
  document.body.append(dialog);

  [
    "stockRestoreDialog",
    "stockRestoreForm",
    "stockRestoreSummary",
    "stockRestoreDate",
    "stockRestoreReason",
    "stockRestoreStatus",
    "cancelStockRestore",
    "confirmStockRestore"
  ].forEach((id) => { els[id] = document.getElementById(id); });
  els.stockRestoreDate.value = kenyaDate();
}

function bindEvents() {
  els.formLedgerCategories.addEventListener("click", () => {
    state.page = 0;
    queueMicrotask(refreshVisibility);
  });
  els.formLedgerViews?.addEventListener("click", () => {
    state.page = 0;
    queueMicrotask(refreshVisibility);
  });
  els.loadFormLedger?.addEventListener("click", () => {
    state.page = 0;
    queueMicrotask(() => {
      if (isVisible()) void loadActions();
    });
  });
  els.formLedgerSearch?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    state.page = 0;
    queueMicrotask(() => {
      if (isVisible()) void loadActions();
    });
  });
  els.stockActionPreviousPage.addEventListener("click", () => changePage(-1));
  els.stockActionNextPage.addEventListener("click", () => changePage(1));
  els.stockActionLedgerRows.addEventListener("click", handleLedgerClick);
  els.stockRestoreForm.addEventListener("submit", submitRestoration);
  els.cancelStockRestore.addEventListener("click", () => {
    state.restoreGroupId = "";
    state.restorationActionGroupId = "";
    els.stockRestoreDialog.close();
  });
}

function observeRecordView() {
  const observer = new MutationObserver(() => refreshVisibility());
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

function isVisible() {
  const stockSelected = els.formLedgerCategories.querySelector(
    '[data-ledger-category="stock"][aria-selected="true"]'
  );
  const allSelected = els.formLedgerViews?.querySelector(
    '[data-ledger-mode="all"][aria-selected="true"]'
  );
  return Boolean(stockSelected && allSelected && !els.formLedgerAllPanel.hidden);
}

function refreshVisibility() {
  const visible = isVisible();
  els.stockActionLedger.hidden = !visible;
  if (visible) void loadActions();
}

async function loadActions() {
  if (!isVisible() || state.loading) return;
  const start = els.formLedgerFrom?.value;
  const end = els.formLedgerTo?.value;
  if (!start || !end || end < start) return;

  state.loading = true;
  const sequence = ++state.loadSequence;
  setLedgerStatus("Loading stock actions...");
  updatePagination();
  try {
    const { data, error } = await authClient.rpc(
      "ag_stabilization_stock_action_ledger",
      {
        p_start_date: start,
        p_end_date: end,
        p_search: els.formLedgerSearch?.value.trim() || null,
        p_page_limit: PAGE_SIZE,
        p_page_offset: state.page * PAGE_SIZE
      }
    );
    if (error) throw error;
    if (sequence !== state.loadSequence) return;
    const result = Array.isArray(data) ? data[0] : data;
    state.rows = Array.isArray(result?.rows) ? result.rows : [];
    state.total = Number(result?.total_count || 0);
    if (state.page > 0 && !state.rows.length && state.total > 0) {
      state.page = Math.max(0, Math.ceil(state.total / PAGE_SIZE) - 1);
      state.loading = false;
      await loadActions();
      return;
    }
    renderRows();
    setLedgerStatus("");
  } catch (error) {
    state.rows = [];
    state.total = 0;
    renderRows(error.message || "Stock actions could not be loaded.");
    setLedgerStatus(error.message || "Stock actions could not be loaded.", "error");
  } finally {
    state.loading = false;
    updatePagination();
  }
}

function renderRows(errorMessage = "") {
  els.stockActionLedgerCount.textContent = `${formatInteger(state.total)} ${state.total === 1 ? "event" : "events"}`;
  if (errorMessage || !state.rows.length) {
    els.stockActionLedgerRows.innerHTML = `
      <tr><td colspan="11" class="empty-state">${escapeHtml(errorMessage || "No removal or restoration events match these filters.")}</td></tr>
    `;
    updatePagination();
    return;
  }

  els.stockActionLedgerRows.innerHTML = state.rows.map((row) => {
    const actionLabel = row.action_type === "restoration" ? "Restored" : "Removed";
    const note = row.note || "";
    const restoreButton = row.can_restore
      ? `<button type="button" data-restore-stock-group="${escapeAttribute(row.action_group_id)}">Restore</button>`
      : "";
    return `
      <tr>
        <td>${escapeHtml(formatDate(row.action_date))}</td>
        <td><strong>${escapeHtml(actionLabel)}</strong></td>
        <td>${cartonDetails(row)}</td>
        <td>${escapeHtml(formatInteger(row.carton_count))}</td>
        <td>${escapeHtml(formatNumber(row.total_litres))}</td>
        <td>${escapeHtml(titleCaseList(row.species_summary))}</td>
        <td>${escapeHtml(row.reason || "-")}</td>
        <td>${escapeHtml(row.recorded_by_name || "-")}</td>
        <td>${escapeHtml(note || "-")}</td>
        <td><span class="stock-action-status ${escapeAttribute(row.status || "")}">${escapeHtml(titleCase(row.status))}</span></td>
        <td>${restoreButton}</td>
      </tr>
    `;
  }).join("");
  updatePagination();
}

function cartonDetails(row) {
  const cartons = Array.isArray(row.carton_list) ? row.carton_list.map(String) : [];
  const summary = row.first_carton === row.last_carton
    ? String(row.first_carton || cartons[0] || "-")
    : `${row.first_carton || cartons[0] || "-"}–${row.last_carton || cartons.at(-1) || "-"}`;
  if (cartons.length <= 1) return escapeHtml(summary);
  return `
    <details class="stock-action-cartons">
      <summary>${escapeHtml(summary)}</summary>
      <div class="stock-action-carton-list">${escapeHtml(cartons.join(", "))}</div>
    </details>
  `;
}

function handleLedgerClick(event) {
  const button = event.target.closest("[data-restore-stock-group]");
  if (!button) return;
  const groupId = button.dataset.restoreStockGroup;
  const row = state.rows.find((item) => String(item.action_group_id) === groupId);
  if (!row) return;
  openRestoreDialog(row);
}

function openRestoreDialog(row) {
  state.restoreGroupId = String(row.action_group_id || "");
  state.restorationActionGroupId = crypto.randomUUID();
  els.stockRestoreSummary.textContent = `${row.carton_count} carton${Number(row.carton_count) === 1 ? "" : "s"}, ${formatNumber(row.total_litres)} L, originally removed on ${formatDate(row.action_date)}.`;
  els.stockRestoreDate.value = kenyaDate();
  els.stockRestoreReason.value = "";
  setRestoreStatus("");
  if (typeof els.stockRestoreDialog.showModal === "function") {
    els.stockRestoreDialog.showModal();
    queueMicrotask(() => els.stockRestoreReason.focus());
  } else {
    const reason = window.prompt("Reason for restoring these cartons to active stock:");
    if (!reason?.trim()) return;
    void restoreGroup(state.restoreGroupId, kenyaDate(), reason.trim());
  }
}

async function submitRestoration(event) {
  event.preventDefault();
  if (!els.stockRestoreForm.reportValidity() || !state.restoreGroupId) return;
  await restoreGroup(
    state.restoreGroupId,
    els.stockRestoreDate.value,
    els.stockRestoreReason.value.trim()
  );
}

async function restoreGroup(removalGroupId, actionDate, reason) {
  els.confirmStockRestore.disabled = true;
  els.cancelStockRestore.disabled = true;
  setRestoreStatus("Restoring cartons...");
  try {
    const { data, error } = await authClient.rpc(
      "ag_restore_stabilization_stock",
      {
        p_restoration_group_id: state.restorationActionGroupId || crypto.randomUUID(),
        p_removal_group_id: removalGroupId,
        p_action_date: actionDate,
        p_reason: reason
      }
    );
    if (error) throw error;
    const saved = Array.isArray(data) ? data[0] : data;
    if (els.stockRestoreDialog.open) els.stockRestoreDialog.close();
    state.restoreGroupId = "";
    state.restorationActionGroupId = "";
    state.page = 0;
    await loadActions();
    setLedgerStatus(
      `${Number(saved?.carton_count || 0)} carton${Number(saved?.carton_count || 0) === 1 ? "" : "s"} restored to active stock.`
    );
  } catch (error) {
    setRestoreStatus(error.message || "The cartons could not be restored.", "error");
  } finally {
    els.confirmStockRestore.disabled = false;
    els.cancelStockRestore.disabled = false;
  }
}

function changePage(direction) {
  const next = state.page + direction;
  if (next < 0 || next * PAGE_SIZE >= state.total || state.loading) return;
  state.page = next;
  void loadActions();
}

function updatePagination() {
  const first = state.total ? state.page * PAGE_SIZE + 1 : 0;
  const last = Math.min((state.page + 1) * PAGE_SIZE, state.total);
  els.stockActionPageStatus.textContent = state.total
    ? `Events ${first}-${last} of ${state.total}`
    : "No events";
  els.stockActionPreviousPage.disabled = state.loading || state.page === 0;
  els.stockActionNextPage.disabled = state.loading || last >= state.total;
}

function setLedgerStatus(message, status = "") {
  els.stockActionLedgerStatus.textContent = message || "";
  if (status) els.stockActionLedgerStatus.dataset.status = status;
  else delete els.stockActionLedgerStatus.dataset.status;
}

function setRestoreStatus(message, status = "") {
  els.stockRestoreStatus.textContent = message || "";
  if (status) els.stockRestoreStatus.dataset.status = status;
  else delete els.stockRestoreStatus.dataset.status;
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

function titleCaseList(value) {
  return String(value || "-")
    .split(",")
    .map((item) => titleCase(item.trim()))
    .join(", ");
}

function kenyaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Nairobi"
  }).format(new Date());
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
