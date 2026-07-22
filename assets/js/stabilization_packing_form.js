import { authClient, currentAggregatorContext, requireAdminAccess } from "./auth_client.js";
import { selectRows } from "./supabase_client.js";
import { setPrintValue, setupPdfWorksheet } from "./print_worksheet.js";

const els = {};
let submissionId = crypto.randomUUID();
let defaultSpecies = "spinosum";
let doseDefaultScope = "default";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "packingRecordForm", "cartonSerial", "packedOn", "packingSpecies",
    "packingAggregator", "packingRecordedBy", "packingWeight", "packingWeightUnit",
    "packingTemperature", "packingSalinity", "packingSalinityUnit", "packingPh",
    "packingEc", "packingChemical", "packingDose", "packingDoseUnit", "packingDoseDefault", "packingNotes",
    "savePackingRecord", "clearPackingRecord", "printPackingWorksheet", "packingRecordStatus",
    "packingPrintWorksheet", "printPackingAggregator", "printPackingDate",
    "printPackingRecordedBy", "printPackingChemical"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  setupPdfWorksheet({
    button: els.printPackingWorksheet,
    worksheet: els.packingPrintWorksheet,
    rowCount: 12,
    columnCount: 13,
    prepare: preparePackingWorksheet
  });

  const access = await requireAdminAccess("can_submit_collection");
  if (!access) return;

  els.packedOn.value = kenyaDate();
  els.packingRecordedBy.value = access.profile?.display_name || access.profile?.email || "Signed-in user";
  els.packingRecordForm.addEventListener("submit", submitRecord);
  els.clearPackingRecord.addEventListener("click", clearForm);
  els.packingRecordForm.addEventListener("input", updateFieldHighlights);
  els.packingRecordForm.addEventListener("change", updateFieldHighlights);
  els.packingDoseDefault.addEventListener("change", handleDoseDefaultChange);
  els.packingDose.addEventListener("input", saveCheckedDoseDefault);
  els.packingDoseUnit.addEventListener("change", saveCheckedDoseDefault);

  try {
    const [context, species] = await Promise.all([
      currentAggregatorContext(true),
      selectRows("ag_public_seaweed_type_settings", "select=*&order=display_order.asc")
    ]);
    const active = context.active_aggregator;
    doseDefaultScope = active?.id || active?.aggregator_id || active?.aggregator_code || "default";
    els.packingAggregator.value = active?.organisation_name || active?.short_name || active?.aggregator_code || "";
    renderSpecies(species);
    applyDoseDefault();
    updateFieldHighlights();
    els.cartonSerial.focus();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderSpecies(rows) {
  if (!rows.length) return;
  els.packingSpecies.replaceChildren();
  rows.forEach((row) => {
    const option = document.createElement("option");
    option.value = row.type_key;
    option.textContent = row.common_name ? `${row.label} (${row.common_name})` : row.label;
    els.packingSpecies.append(option);
  });
  defaultSpecies = rows.find((row) => row.is_default)?.type_key || rows[0].type_key;
  els.packingSpecies.value = defaultSpecies;
}

async function submitRecord(event) {
  event.preventDefault();
  if (!els.packingRecordForm.reportValidity()) return;

  els.savePackingRecord.disabled = true;
  setStatus("Saving...");
  try {
    const { data, error } = await authClient.rpc("ag_submit_stabilization_packing_record", {
      p_submission_id: submissionId,
      p_record: {
        carton_serial: els.cartonSerial.value.trim(),
        packed_on: els.packedOn.value,
        species: els.packingSpecies.value,
        weight_value: Number(els.packingWeight.value),
        weight_unit: els.packingWeightUnit.value,
        room_temperature_c: numberOrNull(els.packingTemperature.value),
        salinity_value: numberOrNull(els.packingSalinity.value),
        salinity_unit: els.packingSalinityUnit.value,
        ph_value: numberOrNull(els.packingPh.value),
        electrical_conductivity_ms_cm: numberOrNull(els.packingEc.value),
        chemical_dose_value: numberOrNull(els.packingDose.value),
        chemical_dose_unit: els.packingDoseUnit.value,
        notes: textOrNull(els.packingNotes.value)
      }
    });
    if (error) throw error;
    const saved = Array.isArray(data) ? data[0] : data;
    const serial = saved?.carton_serial || els.cartonSerial.value.trim();
    resetInputs();
    setStatus(`Carton ${serial} saved.`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.savePackingRecord.disabled = false;
  }
}

function clearForm() {
  resetInputs();
  setStatus("");
}

function handleDoseDefaultChange() {
  if (!els.packingDoseDefault.checked) {
    localStorage.removeItem(doseDefaultKey());
    setStatus("Default chemical dose cleared.");
    return;
  }
  if (els.packingDose.value === "") {
    els.packingDoseDefault.checked = false;
    els.packingDose.focus();
    setStatus("Enter a chemical dose before setting the default.", "error");
    return;
  }
  saveCheckedDoseDefault();
  setStatus(`Default dose set to ${els.packingDose.value} ${els.packingDoseUnit.value}.`);
}

function saveCheckedDoseDefault() {
  if (!els.packingDoseDefault.checked || els.packingDose.value === "") return;
  localStorage.setItem(doseDefaultKey(), JSON.stringify({
    value: els.packingDose.value,
    unit: els.packingDoseUnit.value
  }));
}

function applyDoseDefault() {
  els.packingDoseDefault.checked = false;
  try {
    const saved = JSON.parse(localStorage.getItem(doseDefaultKey()) || "null");
    if (!saved || saved.value === "" || !Number.isFinite(Number(saved.value))) return;
    els.packingDose.value = String(saved.value);
    if ([...els.packingDoseUnit.options].some((option) => option.value === saved.unit)) {
      els.packingDoseUnit.value = saved.unit;
    }
    els.packingDoseDefault.checked = true;
  } catch {
    localStorage.removeItem(doseDefaultKey());
  }
}

function doseDefaultKey() {
  return `seaweed-harvest:packing-dose-default:${doseDefaultScope}`;
}

function preparePackingWorksheet() {
  setPrintValue(els.printPackingAggregator, els.packingAggregator.value);
  setPrintValue(els.printPackingDate, paperDate(els.packedOn.value));
  setPrintValue(els.printPackingRecordedBy, els.packingRecordedBy.value);
  setPrintValue(els.printPackingChemical, els.packingChemical.value);
}

function resetInputs() {
  const aggregator = els.packingAggregator.value;
  const recordedBy = els.packingRecordedBy.value;
  els.packingRecordForm.reset();
  els.packedOn.value = kenyaDate();
  els.packingSpecies.value = defaultSpecies;
  els.packingAggregator.value = aggregator;
  els.packingRecordedBy.value = recordedBy;
  els.packingChemical.value = "Sodium benzoate";
  applyDoseDefault();
  updateFieldHighlights();
  submissionId = crypto.randomUUID();
  els.cartonSerial.focus();
}

function updateFieldHighlights() {
  els.packingRecordForm.querySelectorAll("input, select, textarea").forEach((control) => {
    const type = String(control.type || "").toLowerCase();
    const excluded = ["hidden", "checkbox", "radio", "button", "submit", "reset"].includes(type)
      || control.disabled
      || control.readOnly;
    const shouldHighlight = !excluded && (control.required || control.dataset.recommended === "true");
    control.classList.toggle("empty-value-control", shouldHighlight && String(control.value ?? "").trim() === "");
  });
}

function numberOrNull(value) {
  return value === "" ? null : Number(value);
}

function textOrNull(value) {
  return value.trim() || null;
}

function kenyaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function paperDate(value) {
  const [year, month, day] = String(value || "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

function setStatus(message, status = "") {
  els.packingRecordStatus.textContent = message;
  if (status) els.packingRecordStatus.dataset.status = status;
  else delete els.packingRecordStatus.dataset.status;
}
