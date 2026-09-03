import { DRYING_FORM_CONFIG as CONFIG } from "./dryer_table_config.js?v=2";

const recordsList = document.getElementById("recordsList");
const recordsTable = recordsList?.closest("table");
const refreshRecords = document.getElementById("refreshRecords");

let raNames = new Map();
let loadPromise = null;

function raNameHeading() {
  return document.body.dataset.language === "sw" ? "Jina la RA" : "RA name";
}

function ensureRaNameHeading() {
  const row = recordsTable?.tHead?.rows?.[0];
  if (!row) return;
  let heading = row.querySelector("th[data-ra-name-heading]");
  if (!heading) {
    heading = document.createElement("th");
    heading.dataset.raNameHeading = "";
    row.append(heading);
  }
  const label = raNameHeading();
  if (heading.textContent !== label) heading.textContent = label;
}

function renderRaNames() {
  ensureRaNameHeading();
  if (!recordsList) return;
  recordsList.querySelectorAll("tr").forEach((row) => {
    const edit = row.querySelector("button[data-edit-receipt]");
    if (!edit) return;
    let cell = row.querySelector("td[data-ra-name-cell]");
    if (!cell) {
      cell = document.createElement("td");
      cell.dataset.raNameCell = "";
      row.append(cell);
    }
    const name = raNames.get(edit.dataset.editReceipt) || "-";
    if (cell.textContent !== name) cell.textContent = name;
  });
}

async function loadRaNames() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const response = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/${encodeURIComponent(CONFIG.listRecordsRpc)}`, {
      method: "POST",
      headers: {
        apikey: CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ p_limit: 50 })
    });
    if (!response.ok) return;
    const result = await response.json();
    const rows = Array.isArray(result) ? result : [];
    raNames = new Map(rows.map((record) => [
      record.receipt_number,
      String(record.enumerator_name || "").trim()
    ]));
    renderRaNames();
  })()
    .catch(() => {
      // Previous records remain usable if the optional RA-name enhancement cannot load.
    })
    .finally(() => {
      loadPromise = null;
    });
  return loadPromise;
}

if (recordsList) {
  // Watch only rows added directly to the table body. Rendering RA cells inside
  // those rows must not trigger this observer again.
  new MutationObserver(renderRaNames).observe(recordsList, {
    childList: true
  });
}
refreshRecords?.addEventListener("click", () => queueMicrotask(loadRaNames));
document.addEventListener("seaweed-drying-language-change", renderRaNames);

renderRaNames();
void loadRaNames();
