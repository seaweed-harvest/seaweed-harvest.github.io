import { authClient, currentAggregatorContext, requireAdminAccess } from "./auth_client.js";
import { setupFavoriteFormButton } from "./favorite_forms.js";
import { selectRows } from "./supabase_client.js";
import { setPrintValue, setupPdfWorksheet } from "./print_worksheet.js";
import { installSuggestedInput } from "./suggested_input.js";

const els = {};
let submissionId = crypto.randomUUID();
let defaultSpecies = "spinosum";
let doseDefaultScope = "default";
let nextCartonSerial = "1";
let cartonSerialWasEdited = false;
let applyingCartonSuggestion = false;
let batchSubmissionId = crypto.randomUUID();
let cartonSuggestion = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "packingRecordForm", "cartonSerial", "cartonSerialHint", "existingCartonSerials",
    "packedOn", "packedOnLabel", "packingSpecies",
    "packingRecordedBy", "packingWeight", "packingWeightUnit",
    "packingSalinity", "packingSalinityUnit", "packingPh",
    "packingEc", "packingStabilizerYes", "packingStabilizerNo", "packingStabilizerFields",
    "packingChemical", "packingDose", "packingDoseUnit", "packingDoseDefault", "packingNotes",
    "savePackingRecord", "clearPackingRecord", "favoritePackingForm", "printPackingWorksheet", "packingRecordStatus",
    "packingPrintWorksheet", "printPackingRecordedBy", "printPackingChemical",
    "printPackingWeightHeader", "printPackingSalinityHeader", "printPackingDoseHeader",
    "packingEntryTabs", "packingSingleTab", "packingBatchTab", "packingBatchForm",
    "packingBatchRecordedBy", "packingBatchFirst", "packingBatchLast", "packingBatchDate",
    "packingBatchSpecies", "packingBatchVolume", "packingBatchVolumeUnit",
    "packingBatchStabilizerAdded", "packingBatchStabilizerFields",
    "packingBatchDose", "packingBatchDoseUnit",
    "packingBatchNotes", "packingBatchCount", "savePackingBatch", "clearPackingBatch",
    "packingBatchStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  setupPdfWorksheet({
    button: els.printPackingWorksheet,
    worksheet: els.packingPrintWorksheet,
    rowCount: 20,
    columnCount: 12,
    prepare: preparePackingWorksheet
  });

  const access = await requireAdminAccess("can_submit_collection");
  if (!access) return;
  cartonSuggestion = installSuggestedInput(els.cartonSerial);

  setupFavoriteFormButton({
    button: els.favoritePackingForm,
    formKey: "stabilization_packing",
    profile: access.profile,
    client: authClient,
    returnPage: "stabilization_packing.html"
  });

  els.packedOn.value = kenyaDate();
  els.packingRecordedBy.value = access.profile?.display_name || access.profile?.email || "Signed-in user";
  els.packingBatchRecordedBy.value = els.packingRecordedBy.value;
  els.packingBatchDate.value = kenyaDate();
  els.packingRecordForm.addEventListener("submit", submitRecord);
  els.packingBatchForm.addEventListener("submit", submitBatch);
  els.clearPackingRecord.addEventListener("click", clearForm);
  els.clearPackingBatch.addEventListener("click", clearBatch);
  els.packingEntryTabs.addEventListener("click", handleEntryTabClick);
  els.packingRecordForm.addEventListener("input", updateFieldHighlights);
  els.packingRecordForm.addEventListener("change", updateFieldHighlights);
  els.packingBatchForm.addEventListener("input", updateBatchState);
  els.packingBatchForm.addEventListener("change", updateBatchState);
  els.cartonSerial.addEventListener("input", () => {
    if (selectedRecordType() === "initial" && !applyingCartonSuggestion) cartonSerialWasEdited = true;
  });
  els.packingRecordForm.querySelectorAll('[name="packingRecordType"]').forEach((control) => {
    control.addEventListener("change", handleRecordTypeChange);
  });
  els.packingRecordForm.querySelectorAll('[name="packingStabilizerAdded"]').forEach((control) => {
    control.addEventListener("change", handleStabilizerChange);
  });
  els.packingDoseDefault.addEventListener("change", handleDoseDefaultChange);
  els.packingDose.addEventListener("input", saveCheckedDoseDefault);
  els.packingDoseUnit.addEventListener("change", saveCheckedDoseDefault);
  els.packingBatchStabilizerAdded.addEventListener("change", updateBatchStabilizerControls);

  try {
    const [context, species, formContextResult] = await Promise.all([
      currentAggregatorContext(true),
      selectRows("ag_public_seaweed_type_settings", "select=*&order=display_order.asc"),
      authClient.rpc("ag_stabilization_packing_form_context")
    ]);
    if (formContextResult.error) throw formContextResult.error;
    const active = context.active_aggregator;
    doseDefaultScope = active?.id || active?.aggregator_id || active?.aggregator_code || "default";
    renderSpecies(species);
    applyPackingFormContext(formContextResult.data);
    updateStabilizerControls();
    updateBatchStabilizerControls();
    updateBatchState();
    updateFieldHighlights();
    els.cartonSerial.focus();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderSpecies(rows) {
  if (!rows.length) return;
  els.packingSpecies.replaceChildren();
  els.packingBatchSpecies.replaceChildren();
  rows.forEach((row) => {
    const option = document.createElement("option");
    option.value = row.type_key;
    option.textContent = row.common_name ? `${row.label} (${row.common_name})` : row.label;
    els.packingSpecies.append(option);
    els.packingBatchSpecies.append(option.cloneNode(true));
  });
  defaultSpecies = rows.find((row) => row.is_default)?.type_key || rows[0].type_key;
  els.packingSpecies.value = defaultSpecies;
  els.packingBatchSpecies.value = defaultSpecies;
}

async function submitRecord(event) {
  event.preventDefault();
  if (!els.packingRecordForm.reportValidity()) return;
  const stabilizerAdded = selectedStabilizerAdded();

  els.savePackingRecord.disabled = true;
  setStatus("Saving...");
  try {
    const { data, error } = await authClient.rpc("ag_submit_stabilization_packing_record_v3", {
      p_submission_id: submissionId,
      p_record: {
        record_type: selectedRecordType(),
        auto_carton_serial: selectedRecordType() === "initial" && !cartonSerialWasEdited,
        carton_serial: els.cartonSerial.value.trim(),
        packed_on: els.packedOn.value,
        species: els.packingSpecies.value,
        recorded_by_name: textOrNull(els.packingRecordedBy.value),
        weight_value: Number(els.packingWeight.value),
        weight_unit: els.packingWeightUnit.value,
        salinity_value: numberOrNull(els.packingSalinity.value),
        salinity_unit: els.packingSalinityUnit.value,
        ph_value: numberOrNull(els.packingPh.value),
        electrical_conductivity_ms_cm: numberOrNull(els.packingEc.value),
        stabilizer_added: stabilizerAdded ?? false,
        chemical_dose_value: stabilizerAdded ? numberOrNull(els.packingDose.value) : null,
        chemical_dose_unit: els.packingDoseUnit.value,
        notes: textOrNull(els.packingNotes.value)
      }
    });
    if (error) throw error;
    const saved = Array.isArray(data) ? data[0] : data;
    const serial = saved?.carton_serial || els.cartonSerial.value.trim();
    const recordType = saved?.record_type || selectedRecordType();
    const testSequence = Number(saved?.test_sequence || 1);
    rememberCarton(serial, testSequence);
    resetInputs(saved?.next_carton_serial || nextSerialAfter(serial));
    setStatus(recordType === "retest"
      ? `Retest ${testSequence} for carton ${serial} saved.`
      : `Carton ${serial} saved. Next carton ${nextCartonSerial} is ready.`);
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

function applyPackingFormContext(value) {
  const context = Array.isArray(value) ? value[0] : value;
  nextCartonSerial = String(context?.next_carton_serial || "1");
  els.existingCartonSerials.replaceChildren();
  (context?.recent_cartons || []).forEach((carton) => {
    const option = document.createElement("option");
    option.value = carton.carton_serial;
    const count = Number(carton.test_count || 1);
    option.label = count > 1 ? `${count} tests` : "1 test";
    els.existingCartonSerials.append(option);
  });
  setNewCartonMode();
  setBatchRangeDefaults();
}

function selectedRecordType() {
  return els.packingRecordForm.querySelector('[name="packingRecordType"]:checked')?.value || "initial";
}

function selectedStabilizerAdded() {
  const value = els.packingRecordForm.querySelector('[name="packingStabilizerAdded"]:checked')?.value;
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function handleStabilizerChange() {
  updateStabilizerControls();
  updateFieldHighlights();
}

function updateStabilizerControls() {
  const selected = selectedStabilizerAdded();
  const enabled = selected === true;
  els.packingStabilizerFields.setAttribute("aria-disabled", String(!enabled));
  els.packingChemical.disabled = !enabled;
  els.packingDose.disabled = !enabled;
  els.packingDoseUnit.disabled = !enabled;
  els.packingDoseDefault.disabled = !enabled;
  els.packingDose.required = false;
  if (selected !== false) {
    applyDoseDefault();
  } else {
    els.packingDose.value = "";
    els.packingDoseDefault.checked = false;
  }
}

function handleRecordTypeChange() {
  if (selectedRecordType() === "retest") {
    els.cartonSerial.value = "";
    cartonSerialWasEdited = true;
    els.packedOnLabel.textContent = "Date";
    els.cartonSerialHint.textContent = "Enter an existing carton serial.";
    els.cartonSerial.focus();
  } else {
    setNewCartonMode();
  }
  updateFieldHighlights();
}

function setNewCartonMode() {
  const initial = els.packingRecordForm.querySelector('[name="packingRecordType"][value="initial"]');
  if (initial) initial.checked = true;
  applyingCartonSuggestion = true;
  if (cartonSuggestion) cartonSuggestion.set(nextCartonSerial);
  else els.cartonSerial.value = nextCartonSerial;
  applyingCartonSuggestion = false;
  cartonSerialWasEdited = false;
  els.packedOnLabel.textContent = "Date";
  els.cartonSerialHint.textContent = "Next carton number. You can type over it.";
}

function rememberCarton(serial, testSequence) {
  let option = [...els.existingCartonSerials.options].find((item) => item.value === serial);
  if (!option) {
    option = document.createElement("option");
    option.value = serial;
    els.existingCartonSerials.prepend(option);
  }
  option.label = testSequence > 1 ? `${testSequence} tests` : "1 test";
}

function nextSerialAfter(serial) {
  const match = String(serial || "").match(/^([0-9]+)$/);
  if (!match) return nextCartonSerial;
  const width = match[1].length;
  const next = (BigInt(match[1]) + 1n).toString();
  return next.padStart(Math.max(width, next.length), "0");
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
  setPrintValue(els.printPackingRecordedBy, els.packingRecordedBy.value);
  setPrintValue(els.printPackingChemical, els.packingChemical.value);
  els.printPackingWeightHeader.dataset.pdfUnit = els.packingWeightUnit.value || "L";
  els.printPackingSalinityHeader.dataset.pdfUnit = els.packingSalinityUnit.value || "PSU";
  els.printPackingDoseHeader.dataset.pdfUnit = els.packingDoseUnit.value || "g/container";
}

function resetInputs(nextSerial = nextCartonSerial) {
  const recordedBy = els.packingRecordedBy.value;
  nextCartonSerial = String(nextSerial || nextCartonSerial || "1");
  els.packingRecordForm.reset();
  els.packedOn.value = kenyaDate();
  els.packingSpecies.value = defaultSpecies;
  els.packingRecordedBy.value = recordedBy;
  els.packingChemical.value = "Sodium benzoate";
  setNewCartonMode();
  updateStabilizerControls();
  updateFieldHighlights();
  submissionId = crypto.randomUUID();
  setBatchRangeDefaults();
  els.cartonSerial.focus();
}

function handleEntryTabClick(event) {
  const button = event.target.closest("[data-packing-entry-tab]");
  if (!button) return;
  const selected = button.dataset.packingEntryTab;
  document.querySelectorAll("[data-packing-entry-tab]").forEach((tab) => {
    const active = tab.dataset.packingEntryTab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-packing-entry-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.packingEntryPanel !== selected;
  });
  if (selected === "batch") els.packingBatchFirst.focus();
  else els.cartonSerial.focus();
}

async function submitBatch(event) {
  event.preventDefault();
  if (!els.packingBatchForm.reportValidity()) return;
  const count = batchRangeCount();
  if (count < 1 || count > 100) {
    setBatchStatus("Enter an inclusive range of 1 to 100 containers.", "error");
    els.packingBatchLast.focus();
    return;
  }

  els.savePackingBatch.disabled = true;
  setBatchStatus(`Saving ${count} containers...`);
  try {
    const stabilizerAdded = els.packingBatchStabilizerAdded.checked;
    const { data, error } = await authClient.rpc("ag_submit_stabilization_packing_batch_v2", {
      p_batch_submission_id: batchSubmissionId,
      p_record: {
        first_carton_serial: els.packingBatchFirst.value.trim(),
        last_carton_serial: els.packingBatchLast.value.trim(),
        packed_on: els.packingBatchDate.value,
        species: els.packingBatchSpecies.value,
        recorded_by_name: textOrNull(els.packingBatchRecordedBy.value),
        volume_value: Number(els.packingBatchVolume.value),
        volume_unit: els.packingBatchVolumeUnit.value,
        stabilizer_added: stabilizerAdded,
        chemical_dose_value: stabilizerAdded
          ? numberOrNull(els.packingBatchDose.value)
          : null,
        chemical_dose_unit: els.packingBatchDoseUnit.value,
        notes: textOrNull(els.packingBatchNotes.value)
      }
    });
    if (error) throw error;
    const saved = Array.isArray(data) ? data[0] : data;
    nextCartonSerial = String(saved?.next_carton_serial || nextSerialAfter(els.packingBatchLast.value));
    setBatchStatus(
      `${saved?.created_count || count} containers saved: ${saved?.first_carton_serial || els.packingBatchFirst.value} to ${saved?.last_carton_serial || els.packingBatchLast.value}.`
    );
    resetBatchInputs();
    setNewCartonMode();
  } catch (error) {
    setBatchStatus(error.message, "error");
  } finally {
    els.savePackingBatch.disabled = false;
  }
}

function clearBatch() {
  resetBatchInputs();
  setBatchStatus("");
}

function resetBatchInputs() {
  const recordedBy = els.packingBatchRecordedBy.value;
  els.packingBatchForm.reset();
  els.packingBatchRecordedBy.value = recordedBy;
  els.packingBatchDate.value = kenyaDate();
  els.packingBatchSpecies.value = defaultSpecies;
  batchSubmissionId = crypto.randomUUID();
  updateBatchStabilizerControls();
  setBatchRangeDefaults();
  updateBatchState();
}

function setBatchRangeDefaults() {
  if (!els.packingBatchFirst || !els.packingBatchLast) return;
  els.packingBatchFirst.value = nextCartonSerial;
  els.packingBatchLast.value = nextCartonSerial;
  updateBatchState();
}

function updateBatchStabilizerControls() {
  const enabled = els.packingBatchStabilizerAdded.checked;
  els.packingBatchStabilizerFields.setAttribute("aria-disabled", String(!enabled));
  [
    els.packingBatchDose,
    els.packingBatchDoseUnit
  ].forEach((control) => { control.disabled = !enabled; });
  if (!enabled) {
    els.packingBatchDose.value = "";
  }
}

function updateBatchState() {
  const count = batchRangeCount();
  els.packingBatchCount.textContent = count > 0 && count <= 100 ? String(count) : "Check range";
  els.packingBatchForm.querySelectorAll("input, select, textarea").forEach((control) => {
    if (["checkbox", "button", "submit", "reset"].includes(control.type) || control.disabled) return;
    control.classList.toggle("empty-value-control", control.required && !String(control.value || "").trim());
  });
}

function batchRangeCount() {
  const first = String(els.packingBatchFirst?.value || "").trim();
  const last = String(els.packingBatchLast?.value || "").trim();
  if (!/^\d{1,18}$/.test(first) || !/^\d{1,18}$/.test(last)) return 0;
  const count = BigInt(last) - BigInt(first) + 1n;
  return count > 0n && count <= 100000n ? Number(count) : 0;
}

function setBatchStatus(message, status = "") {
  els.packingBatchStatus.textContent = message || "";
  if (status) els.packingBatchStatus.dataset.status = status;
  else delete els.packingBatchStatus.dataset.status;
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

function setStatus(message, status = "") {
  els.packingRecordStatus.textContent = message;
  if (status) els.packingRecordStatus.dataset.status = status;
  else delete els.packingRecordStatus.dataset.status;
}
