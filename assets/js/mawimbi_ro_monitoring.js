import { authClient, requireAggregatorAccess } from "./auth_client.js";

const ids = ["mawimbiRoForm", "roRecordedOn", "roPureFlow", "roWasteFlow", "roPressure",
  "roTds", "saveMaRo", "clearMaRo", "mawimbiRoStatus", "roHistoryStatus",
  "mawimbiRoHistory", "refreshMaRo"];
const els = Object.fromEntries(ids.map(id => [id, null]));
let submissionId = crypto.randomUUID();

document.addEventListener("DOMContentLoaded", async () => {
  for (const id of ids) els[id] = document.getElementById(id);
  const access = await requireAggregatorAccess("MAWIMBI", "can_submit_collection",
    "mawimbi_ro_monitoring.html", "form_site_water_samples");
  if (!access) return;
  els.roRecordedOn.value = kenyaDate();
  els.mawimbiRoForm.addEventListener("submit", save);
  els.clearMaRo.addEventListener("click", clear);
  els.refreshMaRo.addEventListener("click", loadRecords);
  await loadRecords();
});

async function save(event) {
  event.preventDefault();
  if (!els.mawimbiRoForm.reportValidity()) return;
  els.saveMaRo.disabled = true;
  status(els.mawimbiRoStatus, "Saving...");
  try {
    const { error } = await authClient.rpc("ag_submit_mawimbi_ro_monitoring", {
      p_submission_id: submissionId,
      p_recorded_on: els.roRecordedOn.value,
      p_pure_water_flow_lpm: Number(els.roPureFlow.value),
      p_wastewater_flow_lpm: Number(els.roWasteFlow.value),
      p_membrane_front_pressure_psi: Number(els.roPressure.value),
      p_permeate_tds_ppm: Number(els.roTds.value)
    });
    if (error) throw error;
    clear();
    status(els.mawimbiRoStatus, "RO reading saved.");
    await loadRecords();
  } catch (error) {
    status(els.mawimbiRoStatus, error.message || "Save failed.");
  } finally {
    els.saveMaRo.disabled = false;
  }
}

function clear() {
  const date = els.roRecordedOn.value || kenyaDate();
  els.mawimbiRoForm.reset();
  els.roRecordedOn.value = date;
  submissionId = crypto.randomUUID();
  status(els.mawimbiRoStatus, "");
}

async function loadRecords() {
  status(els.roHistoryStatus, "Loading...");
  try {
    const { data, error } = await authClient.rpc("ag_list_mawimbi_ro_monitoring", { p_limit: 40 });
    if (error) throw error;
    const records = Array.isArray(data) ? data : [];
    els.mawimbiRoHistory.replaceChildren();
    for (const record of records) {
      const tr = document.createElement("tr");
      const values = [record.recorded_on, record.pure_water_flow_lpm,
        record.wastewater_flow_lpm, record.membrane_front_pressure_psi,
        record.permeate_tds_ppm, record.recorded_by_name];
      for (const value of values) {
        const td = document.createElement("td");
        td.textContent = value == null ? "–" : String(value);
        tr.append(td);
      }
      els.mawimbiRoHistory.append(tr);
    }
    if (!records.length) {
      const tr = document.createElement("tr"), td = document.createElement("td");
      td.colSpan = 6;
      td.textContent = "No RO records yet.";
      tr.append(td); els.mawimbiRoHistory.append(tr);
    }
    status(els.roHistoryStatus, records.length + " recent RO records.");
  } catch (error) {
    status(els.roHistoryStatus, error.message || "Records unavailable.");
  }
}

function status(element, message) { element.textContent = message; }
function kenyaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}
