import {
  authClient,
  currentAggregatorContext,
  requireOrganisationCapability
} from "./auth_client.js";
import { setupFavoriteFormButton } from "./favorite_forms.js?v=3";
import { selectRows } from "./supabase_client.js";
import { setPrintValue, setupPdfWorksheet } from "./print_worksheet.js";
import { installSuggestedInput } from "./suggested_input.js";
import { validateStockPhotoFiles, uploadStockPhotos, removeStockPhotos, renderPhotoPreviews } from "./stock_photo_upload.js";

const els = {};
let submissionId = crypto.randomUUID();
let defaultSpecies = "spinosum";
let doseDefaultScope = "default";
let nextCartonSerial = "1";
let cartonSerialWasEdited = false;
let applyingCartonSuggestion = false;
let batchSubmissionId = crypto.randomUUID();

const requestedBatchId = new URLSearchParams(window.location.search).get("edit_batch");
let editingBatch = null;
function batchReturnUrl() {
  const candidate = new URLSearchParams(window.location.search).get("return_to") || "";
  // Never accept an external redirect from a link.
  return /^\.?\/?records\.html\?(?!.*[<>])/i.test(candidate)
    ? candidate.replace(/^\//, "./")
    : "./records.html?category=stock&view=all";
}
function selectBatchRadio(name, value) {
  const desired = value === null || value === undefined ? "" : value ? "yes" : "no";
  els.packingBatchForm.querySelectorAll(`[name="${name}"]`).forEach((el) => {
    el.checked = el.value === desired;
  });
}
function originalSharedMeasurements(row) {
  return {
    species: row.species,
    weight_value: row.weight_value,
    weight_unit: row.weight_unit,
    stabilizer_added: Boolean(row.stabilizer_added),
    chemical_dose_value: row.stabilizer_added ? row.chemical_dose_value : null,
    citric_acid_added: Boolean(row.citric_acid_added),
    citric_acid_dose_value: row.citric_acid_added ? row.citric_acid_dose_value : null,
    salinity_value: row.salinity_value,
    salinity_unit: row.salinity_unit,
    ph_value: row.ph_value,
    electrical_conductivity_ms_cm: row.electrical_conductivity_ms_cm,
    brix_value: row.brix_value
  };
}
function sameBatchValue(a, b) {
  if (a == null || a === "") return b == null || b === "";
  if (b == null || b === "") return false;
  return String(a) === String(b);
}
function fillOriginalBatch(row, rows) {
  els.packingBatchFirst.value = rows[0].carton_serial;
  els.packingBatchLast.value = rows[rows.length - 1].carton_serial;
  els.packingBatchDate.value = row.packed_on;
  els.packingBatchRecordedBy.value = row.recorded_by_name || "";
  els.packingBatchSpecies.value = row.species;
  els.packingBatchVolume.value = row.weight_value ?? "";
  els.packingBatchVolumeUnit.value = row.weight_unit || "L";
  selectBatchRadio("packingBatchStabilizerAdded", row.stabilizer_added);
  selectBatchRadio("packingBatchCitricAcidAdded", row.citric_acid_added);
  updateBatchStabilizerControls();
  els.packingBatchDose.value = row.chemical_dose_value ?? "";
  els.packingBatchCitricAcidDose.value = row.citric_acid_dose_value ?? "";
  els.packingBatchSalinity.value = row.salinity_value ?? "";
  els.packingBatchSalinityUnit.value = row.salinity_unit || "PSU";
  els.packingBatchPh.value = row.ph_value ?? "";
  els.packingBatchEc.value = row.electrical_conductivity_ms_cm ?? "";
  els.packingBatchBrix.value = row.brix_value ?? "";
  els.packingBatchHydrometer.value = row.hydrometer_value ?? "";
  selectBatchRadio("packingBatchEColiSampleTaken", row.e_coli_sample_taken);
  els.packingBatchNotes.value = row.notes || "";
  updateBatchState();
}
async function loadOriginalBatchForEditing() {
  if (!requestedBatchId) return;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedBatchId)) {
    throw new Error("Invalid batch reference.");
  }
  els.savePackingBatch.disabled = true;
  const { data, error } = await authClient.rpc("ag_get_stabilization_packing_batch_for_edit", {
    p_batch_submission_id: requestedBatchId
  });
  if (error) throw error;
  const batch = Array.isArray(data) ? data[0] : data;
  const rows = (batch?.rows || []).slice().sort((a,b) => {
    const first = BigInt(a.carton_serial);
    const second = BigInt(b.carton_serial);
    return first < second ? -1 : first > second ? 1 : 0;
  });
  if (!rows.length) throw new Error("Batch was not found.");
  const first = rows[0];
  const compareKeys = ["packed_on", "recorded_by_name", "notes", "hydrometer_value", "hydrometer_scale", "e_coli_sample_taken"];
  const base = originalSharedMeasurements(first);
  const mixed = rows.some((row) => (
    compareKeys.some((key) => !sameBatchValue(row[key], first[key])) ||
    Object.keys(base).some((key) => !sameBatchValue(originalSharedMeasurements(row)[key], base[key]))
  ));
  editingBatch = {
    id: requestedBatchId, rows, expectedCount: batch.expected_count,
    latest: batch.expected_latest_updated_at, originalShared: base, mixed
  };
  fillOriginalBatch(first,rows);
  els.packingBatchTab.click();
  els.packingSingleTab.hidden = true;
  els.packingBatchEditNotice.hidden = false;
  els.packingBatchEditCancel.href = batchReturnUrl();
  els.packingBatchEditWarning.textContent = mixed
    ? " Some containers have different measurements; saving shared QC will replace those individual values."
    : " Changes will update this existing batch, not create another.";
  els.savePackingBatch.textContent = "Save batch changes";
  els.clearPackingBatch.textContent = "Restore saved values";
  els.savePackingBatch.disabled = false;
  els.packingBatchFirst.focus();
}

let cartonSuggestion = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "packingRecordForm", "cartonSerial", "cartonSerialHint", "existingCartonSerials",
    "packedOn", "packedOnLabel", "packingSpecies",
    "packingRecordedBy", "packingWeight", "packingWeightUnit",
    "packingSalinity", "packingSalinityUnit", "packingPh",
    "packingBrix", "packingHydrometer",
    "packingRetestTargetField", "packingRetestTarget",
    "packingEc", "packingStabilizerYes", "packingStabilizerNo", "packingStabilizerFields",
    "packingChemical", "packingDose", "packingDoseUnit", "packingDoseDefault", "packingNotes",
    "packingPhotoFiles", "packingCameraPhoto", "packingTakePhoto", "packingChoosePhotos", "packingPhotoPreview", "packingPhotoStatus", "packingSavedPhotoLink",
    "packingCitricAcidYes", "packingCitricAcidNo", "packingCitricAcidFields",
    "packingCitricAcidChemical", "packingCitricAcidDose", "packingCitricAcidDoseUnit",
    "packingCitricAcidDoseDefault",
    "savePackingRecord", "clearPackingRecord", "favoritePackingForm", "printPackingWorksheet", "packingRecordStatus",
    "packingPrintWorksheet", "printPackingRecordedBy", "printPackingChemical",
    "printPackingWeightHeader", "printPackingSalinityHeader", "printPackingDoseHeader",
    "packingEntryTabs", "packingSingleTab", "packingBatchTab", "packingBatchForm",
    "packingBatchRecordedBy", "packingBatchFirst", "packingBatchLast", "packingBatchDate",
    "packingBatchSpecies", "packingBatchVolume", "packingBatchVolumeUnit", "packingBatchVolumePreview",
    "packingBatchStabilizerYes", "packingBatchStabilizerNo", "packingBatchStabilizerFields",
    "packingBatchChemical", "packingBatchDose", "packingBatchDoseUnit", "packingBatchDoseDefault",
    "packingBatchCitricAcidYes", "packingBatchCitricAcidNo", "packingBatchCitricAcidFields",
    "packingBatchCitricAcidChemical", "packingBatchCitricAcidDose",
    "packingBatchCitricAcidDoseUnit", "packingBatchCitricAcidDoseDefault",
    "packingBatchSalinity", "packingBatchSalinityUnit", "packingBatchPh",
    "packingBatchEc", "packingBatchBrix", "packingBatchHydrometer",
    "packingBatchNotes", "packingBatchCount", "savePackingBatch", "clearPackingBatch",
    "packingBatchStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  setupPdfWorksheet({
    button: els.printPackingWorksheet,
    worksheet: els.packingPrintWorksheet,
    rowCount: 20,
    columnCount: 14,
    prepare: preparePackingWorksheet
  });

  const access = await requireOrganisationCapability(
    "form_stock_record",
    "can_submit_collection",
    "stabilization_packing.html"
  );
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
  els.packingTakePhoto.addEventListener("click", () => els.packingCameraPhoto.click());
  els.packingChoosePhotos.addEventListener("click", () => els.packingPhotoFiles.click());
  for (const control of [els.packingPhotoFiles, els.packingCameraPhoto]) {
    control.addEventListener("change", () => {
      try {
        const files = pendingStockPhotos();
        renderPhotoPreviews(els.packingPhotoPreview, files);
        els.packingPhotoStatus.textContent = `${files.length} of 2 photos`;
      } catch (error) {
        control.value = "";
        renderPhotoPreviews(els.packingPhotoPreview, pendingStockPhotos());
        els.packingPhotoStatus.textContent = error.message;
      }
    });
  }
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
    hideRetestTarget();
  });
  els.cartonSerial.addEventListener("change", () => {
    if (selectedRecordType() === "retest") refreshRetestTargets();
  });
  els.packingRecordForm.querySelectorAll('[name="packingRecordType"]').forEach((control) => {
    control.addEventListener("change", handleRecordTypeChange);
  });
  els.packingRecordForm.querySelectorAll('[name="packingStabilizerAdded"]').forEach((control) => {
    control.addEventListener("change", handleStabilizerChange);
  });
  els.packingRecordForm.querySelectorAll('[name="packingCitricAcidAdded"]').forEach((control) => {
    control.addEventListener("change", handleStabilizerChange);
  });
  els.packingBatchForm.querySelectorAll('[name="packingBatchStabilizerAdded"], [name="packingBatchCitricAcidAdded"]').forEach((control) => {
    control.addEventListener("change", updateBatchStabilizerControls);
  });
  allDoseConfigs().forEach((config) => {
    config.defaultControl.addEventListener("change", () => handleDoseDefaultChange(config));
    config.dose.addEventListener("input", () => saveCheckedDoseDefault(config));
  });

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
    if (requestedBatchId) {
      await loadOriginalBatchForEditing();
    } else {
      els.cartonSerial.focus();
    }
  } catch (error) {
    if (requestedBatchId) {
      els.packingBatchTab.click();
      els.packingSingleTab.hidden = true;
      els.savePackingBatch.disabled = true;
      setBatchStatus(error.message || "Could not open this batch for editing.", "error");
    } else {
      setStatus(error.message, "error");
    }
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

function pendingStockPhotos() {
  return validateStockPhotoFiles([...(els.packingPhotoFiles.files || []), ...(els.packingCameraPhoto.files || [])]);
}

async function submitRecord(event) {
  event.preventDefault();
  if (!els.packingRecordForm.reportValidity()) return;
  const stabilizerAdded = selectedStabilizerAdded();
  const citricAcidAdded = selectedCitricAcidAdded();

  els.savePackingRecord.disabled = true;
  setStatus("Checking carton number...");
  let uploadedPhotos = [];
  try {
    let allowDuplicate = false;
    let cartonInstanceId = null;
    const isRetest = selectedRecordType() === "retest";
    const enteredSerial = els.cartonSerial.value.trim();
    if (enteredSerial && (isRetest || cartonSerialWasEdited)) {
      const { data: matchData, error: matchError } = await authClient.rpc(
        "ag_stabilization_carton_matches", { p_serial: enteredSerial }
      );
      if (matchError) throw matchError;
      const matched = Number(matchData?.physical_count || 0);
      if (!isRetest && matched > 0) {
        allowDuplicate = window.confirm(
          `Carton ${enteredSerial} already exists (${matched} physical carton${matched === 1 ? "" : "s"}).\n\nSave another separate carton with this same number anyway?`
        );
        if (!allowDuplicate) {
          setStatus("Not saved. You can change the serial, or save another carton with the same number.");
          return;
        }
      }
      if (isRetest) {
        if (!matched) throw new Error(`Carton ${enteredSerial} has no existing stock record.`);
        if (matched > 1) {
          renderRetestTargets(matchData.cartons);
          cartonInstanceId = els.packingRetestTarget.value;
          if (!cartonInstanceId) {
            setStatus("More than one physical carton shares this number. Select which carton to retest, then Save again.", "error");
            return;
          }
        } else {
          cartonInstanceId = matchData.cartons?.[0]?.carton_instance_id || null;
        }
      }
    }
    setStatus("Saving...");
    uploadedPhotos = await uploadStockPhotos(pendingStockPhotos(), submissionId, (await authClient.auth.getUser()).data?.user?.id);
    const { data, error } = await authClient.rpc("ag_submit_stabilization_stock_with_ecoli_v1", {
      p_submission_id: submissionId,
      p_photos: uploadedPhotos,
      p_record: {
        record_type: selectedRecordType(),
        auto_carton_serial: selectedRecordType() === "initial" && !cartonSerialWasEdited && !allowDuplicate,
        allow_duplicate_carton: allowDuplicate,
        carton_instance_id: cartonInstanceId,
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
        brix_value: numberOrNull(els.packingBrix.value),
        hydrometer_value: numberOrNull(els.packingHydrometer.value),
        hydrometer_scale: els.packingHydrometer.value !== "" ? "SG" : null,
        e_coli_sample_taken: selectedYesNo(els.packingRecordForm, "packingEColiSampleTaken"),
        stabilizer_added: stabilizerAdded ?? false,
        chemical_dose_value: stabilizerAdded ? numberOrNull(els.packingDose.value) : null,
        chemical_dose_unit: els.packingDoseUnit.value,
        citric_acid_added: citricAcidAdded ?? false,
        citric_acid_dose_value: citricAcidAdded ? numberOrNull(els.packingCitricAcidDose.value) : null,
        citric_acid_dose_unit: els.packingCitricAcidDoseUnit.value,
        notes: textOrNull(els.packingNotes.value)
      }
    });
    if (error) throw error;
    uploadedPhotos = [];
    const saved = Array.isArray(data) ? data[0] : data;
    const serial = saved?.carton_serial || els.cartonSerial.value.trim();
    const recordType = saved?.record_type || selectedRecordType();
    rememberCarton(serial, recordType);
    resetInputs(saved?.next_carton_serial || nextSerialAfter(serial));
    if (saved?.record_id) {
      els.packingSavedPhotoLink.href = `./stock_record_photos.html?id=${encodeURIComponent(saved.record_id)}`;
      els.packingSavedPhotoLink.hidden = false;
    }
    setStatus(recordType === "retest"
      ? `Retest for carton ${serial} saved.`
      : allowDuplicate
        ? `Another physical carton numbered ${serial} saved with a separate record.`
        : `Carton ${serial} saved. Next carton ${nextCartonSerial} is ready.`);
  } catch (error) {
    await removeStockPhotos(uploadedPhotos);
    setStatus(error.message, "error");
  } finally {
    els.savePackingRecord.disabled = false;
  }
}

function clearForm() {
  resetInputs();
  els.packingSavedPhotoLink.hidden = true;
  setStatus("");
}

function applyPackingFormContext(value) {
  const context = Array.isArray(value) ? value[0] : value;
  nextCartonSerial = String(context?.next_carton_serial || "1");
  els.existingCartonSerials.replaceChildren();
  (context?.recent_cartons || []).forEach((carton) => {
    const option = document.createElement("option");
    option.value = carton.carton_serial;
    const physicalCount = Number(carton.physical_count || 1);
    const recordCount = Number(carton.test_count || 1);
    option.label = `${physicalCount} carton${physicalCount === 1 ? "" : "s"}, ${recordCount} record${recordCount === 1 ? "" : "s"}`;
    els.existingCartonSerials.append(option);
  });
  setNewCartonMode();
  setBatchRangeDefaults();
}

function selectedRecordType() {
  return els.packingRecordForm.querySelector('[name="packingRecordType"]:checked')?.value || "initial";
}

function selectedStabilizerAdded() {
  return selectedYesNo(els.packingRecordForm, "packingStabilizerAdded");
}

function selectedCitricAcidAdded() {
  return selectedYesNo(els.packingRecordForm, "packingCitricAcidAdded");
}

function selectedYesNo(form, name) {
  const value = form.querySelector(`[name="${name}"]:checked`)?.value;
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function handleStabilizerChange() {
  updateStabilizerControls();
  updateFieldHighlights();
}

function updateStabilizerControls() {
  updateChemicalControls(singleDoseConfigs());
}

function handleRecordTypeChange() {
  hideRetestTarget();
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

function rememberCarton(serial, recordType) {
  let option = [...els.existingCartonSerials.options].find(
    (item) => canonicalSerial(item.value) === canonicalSerial(serial)
  );
  if (!option) {
    option = document.createElement("option");
    option.value = serial;
    els.existingCartonSerials.prepend(option);
  }
  option.label = recordType === "retest" ? "Retest recorded" : "Carton recorded";
}

function canonicalSerial(serial) {
  return String(serial || "").replace(/^0+(?=\d)/, "");
}

function hideRetestTarget() {
  els.packingRetestTarget.replaceChildren();
  els.packingRetestTargetField.hidden = true;
}

function renderRetestTargets(cartons) {
  const previous = els.packingRetestTarget.value;
  els.packingRetestTarget.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Select physical carton";
  els.packingRetestTarget.append(empty);
  (cartons || []).forEach((carton, index) => {
    const option = document.createElement("option");
    option.value = carton.carton_instance_id;
    option.textContent = `Carton ${index + 1} — ${carton.packed_on || "no date"}, ${carton.volume_value || "?"} ${carton.volume_unit || ""} (${carton.recorded_by_name || "unknown recorder"})`;
    els.packingRetestTarget.append(option);
  });
  if ([...els.packingRetestTarget.options].some(option => option.value === previous)) {
    els.packingRetestTarget.value = previous;
  }
  els.packingRetestTargetField.hidden = false;
}

async function refreshRetestTargets() {
  const serial = els.cartonSerial.value.trim();
  if (selectedRecordType() !== "retest" || !/^\d{1,30}$/.test(serial)) return;
  try {
    const { data, error } = await authClient.rpc("ag_stabilization_carton_matches", { p_serial: serial });
    if (error) throw error;
    if (canonicalSerial(els.cartonSerial.value.trim()) !== canonicalSerial(serial)) return;
    if (Number(data?.physical_count || 0) > 1) renderRetestTargets(data.cartons);
    else hideRetestTarget();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function nextSerialAfter(serial) {
  const match = String(serial || "").match(/^([0-9]+)$/);
  if (!match) return nextCartonSerial;
  const width = match[1].length;
  const next = (BigInt(match[1]) + 1n).toString();
  return next.padStart(Math.max(width, next.length), "0");
}

function handleDoseDefaultChange(config) {
  if (!config.defaultControl.checked) {
    localStorage.removeItem(doseDefaultKey(config.kind));
    setStatus(`Default ${config.label} dose cleared.`);
    return;
  }
  if (config.dose.value === "") {
    config.defaultControl.checked = false;
    config.dose.focus();
    setStatus(`Enter a ${config.label} dose before setting the default.`, "error");
    return;
  }
  saveCheckedDoseDefault(config);
  setStatus(`Default ${config.label} dose set to ${config.dose.value} g/container.`);
}

function saveCheckedDoseDefault(config = singleDoseConfigs()[0]) {
  if (!config.defaultControl.checked || config.dose.value === "") return;
  localStorage.setItem(doseDefaultKey(config.kind), JSON.stringify({
    value: config.dose.value,
    unit: "g/container"
  }));
}

function applyDoseDefault(config = singleDoseConfigs()[0]) {
  config.defaultControl.checked = false;
  try {
    const saved = JSON.parse(localStorage.getItem(doseDefaultKey(config.kind)) || "null");
    if (!saved || saved.value === "" || !Number.isFinite(Number(saved.value))) return;
    config.dose.value = String(saved.value);
    config.defaultControl.checked = true;
  } catch {
    localStorage.removeItem(doseDefaultKey(config.kind));
  }
}

function doseDefaultKey(kind = "sodium-benzoate") {
  const prefix = kind === "sodium-benzoate"
    ? "seaweed-harvest:packing-dose-default"
    : `seaweed-harvest:packing-${kind}-dose-default`;
  return `${prefix}:${doseDefaultScope}`;
}

function preparePackingWorksheet() {
  setPrintValue(els.printPackingRecordedBy, els.packingRecordedBy.value);
  setPrintValue(els.printPackingChemical, `${els.packingChemical.value}; ${els.packingCitricAcidChemical.value}`);
  els.printPackingWeightHeader.dataset.pdfUnit = els.packingWeightUnit.value || "L";
  els.printPackingSalinityHeader.dataset.pdfUnit = els.packingSalinityUnit.value || "PSU";
  els.printPackingDoseHeader.dataset.pdfUnit = "g/container";
}

function resetInputs(nextSerial = nextCartonSerial) {
  hideRetestTarget();
  const recordedBy = els.packingRecordedBy.value;
  nextCartonSerial = String(nextSerial || nextCartonSerial || "1");
  els.packingRecordForm.reset();
  els.packingPhotoPreview.replaceChildren();
  els.packingPhotoStatus.textContent = "0 of 2 photos";
  els.packedOn.value = kenyaDate();
  els.packingSpecies.value = defaultSpecies;
  els.packingRecordedBy.value = recordedBy;
  els.packingChemical.value = "Sodium benzoate";
  els.packingCitricAcidChemical.value = "Citric acid";
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
  if (requestedBatchId && !editingBatch) {
    setBatchStatus("The existing batch has not loaded. No changes were saved.", "error");
    return;
  }
  if (!els.packingBatchForm.reportValidity()) return;
  const count = batchRangeCount();
  if (count < 1 || count > 100) {
    setBatchStatus("Enter an inclusive range of 1 to 100 containers.", "error");
    els.packingBatchLast.focus();
    return;
  }

  const submittedVolume = Number(els.packingBatchVolume.value);
  const eachLitres = els.packingBatchVolumeUnit.value === "mL"
    ? submittedVolume / 1000 : submittedVolume;
  if (eachLitres > 40 && count > 1) {
    const totalLitres = count * eachLitres;
    const confirmation = count + " containers × " + formatBatchNumber(eachLitres) +
      " L per container = " + formatBatchNumber(totalLitres) +
      " L total.\n\nIf " + formatBatchNumber(eachLitres) +
      " L is the WHOLE batch, enter " + formatBatchNumber(eachLitres / count) +
      " L per container instead.\n\nSave this batch total?";
    if (!window.confirm(confirmation)) {
      setBatchStatus("Not saved. Review the volume per container.", "error");
      return;
    }
  }
  els.savePackingBatch.disabled = true;
  setBatchStatus(`Saving ${count} containers...`);
  try {
    const stabilizerAdded = selectedYesNo(els.packingBatchForm, "packingBatchStabilizerAdded");
    const citricAcidAdded = selectedYesNo(els.packingBatchForm, "packingBatchCitricAcidAdded");
    const batchValues = {
        first_carton_serial: els.packingBatchFirst.value.trim(),
        last_carton_serial: els.packingBatchLast.value.trim(),
        packed_on: els.packingBatchDate.value,
        species: els.packingBatchSpecies.value,
        recorded_by_name: textOrNull(els.packingBatchRecordedBy.value),
        volume_value: Number(els.packingBatchVolume.value),
        volume_unit: els.packingBatchVolumeUnit.value,
        stabilizer_added: stabilizerAdded ?? false,
        chemical_dose_value: stabilizerAdded
          ? numberOrNull(els.packingBatchDose.value)
          : null,
        chemical_dose_unit: els.packingBatchDoseUnit.value,
        citric_acid_added: citricAcidAdded ?? false,
        citric_acid_dose_value: citricAcidAdded
          ? numberOrNull(els.packingBatchCitricAcidDose.value)
          : null,
        citric_acid_dose_unit: els.packingBatchCitricAcidDoseUnit.value,
        salinity_value: numberOrNull(els.packingBatchSalinity.value),
        salinity_unit: els.packingBatchSalinityUnit.value,
        ph_value: numberOrNull(els.packingBatchPh.value),
        electrical_conductivity_ms_cm: numberOrNull(els.packingBatchEc.value),
        brix_value: numberOrNull(els.packingBatchBrix.value),
        hydrometer_value: numberOrNull(els.packingBatchHydrometer.value),
        hydrometer_scale: els.packingBatchHydrometer.value !== "" ? "SG" : null,
        e_coli_sample_taken: selectedYesNo(els.packingBatchForm, "packingBatchEColiSampleTaken"),
        notes: textOrNull(els.packingBatchNotes.value)
    };
    let result;
    if (editingBatch) {
      const before = editingBatch.originalShared;
      const sharedValues = {
        species: batchValues.species,
        weight_value: batchValues.volume_value, weight_unit: batchValues.volume_unit,
        stabilizer_added: batchValues.stabilizer_added,
        chemical_dose_value: batchValues.chemical_dose_value,
        citric_acid_added: batchValues.citric_acid_added,
        citric_acid_dose_value: batchValues.citric_acid_dose_value,
        salinity_value: batchValues.salinity_value, salinity_unit: batchValues.salinity_unit,
        ph_value: batchValues.ph_value,
        electrical_conductivity_ms_cm: batchValues.electrical_conductivity_ms_cm,
        brix_value: batchValues.brix_value
      };
      const sharedChanged = Object.keys(sharedValues)
        .some((key) => !sameBatchValue(sharedValues[key], before[key]));
      const first = BigInt(batchValues.first_carton_serial);
      const last = BigInt(batchValues.last_carton_serial);
      const removals = editingBatch.rows.filter((row) => {
        const serial = BigInt(row.carton_serial);
        return serial < first || serial > last;
      });
      if (removals.length && !window.confirm(
        `Remove ${removals.length} container(s) outside the new range? Their removal will be recorded in Deleted Records.`
      )) return;
      if (sharedChanged && editingBatch.mixed && !window.confirm(
        "This batch has different recorded measurements across some containers. Replace their common QC values with these form values?"
      )) return;
      const { data, error } = await authClient.rpc("ag_update_stabilization_packing_batch_from_form", {
        p_batch_submission_id: editingBatch.id,
        p_record: {
          ...batchValues,
          ...sharedValues,
          first_carton_serial: batchValues.first_carton_serial,
          last_carton_serial: batchValues.last_carton_serial,
          apply_shared: sharedChanged,
          allow_remove: removals.length > 0,
          expected_count: editingBatch.expectedCount,
          expected_latest_updated_at: editingBatch.latest
        }
      });
      if (error) throw error;
      setBatchStatus(`Batch updated. ${data?.added_count || 0} containers added, ${data?.removed_count || 0} removed.`);
      window.location.assign(batchReturnUrl());
      return;
    }
    result = await authClient.rpc("ag_submit_stabilization_packing_batch_v3", {
      p_batch_submission_id: batchSubmissionId, p_record: batchValues
    });
    if (result.error) throw result.error;
    const saved = Array.isArray(result.data) ? result.data[0] : result.data;
    nextCartonSerial = String(saved?.next_carton_serial || nextSerialAfter(els.packingBatchLast.value));
    setBatchStatus(saved?.duplicate
      ? "This batch was already saved. Existing container records and QC were not changed."
      : `${saved?.created_count || count} containers saved: ${saved?.first_carton_serial || els.packingBatchFirst.value} to ${saved?.last_carton_serial || els.packingBatchLast.value} · ${els.packingBatchVolumePreview.textContent}.${saved?.qc_measurements_recorded ? " Shared vessel QC applied to all containers." : ""}`
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
  if (editingBatch) {
    fillOriginalBatch(editingBatch.rows[0], editingBatch.rows);
  } else {
    resetBatchInputs();
  }
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
  updateChemicalControls(batchDoseConfigs());
}

function updateChemicalControls(configs) {
  configs.forEach((config) => {
    const selected = selectedYesNo(config.form, config.addedName);
    const enabled = selected === true;
    config.fields.setAttribute("aria-disabled", String(!enabled));
    config.dose.disabled = !enabled;
    config.defaultControl.disabled = !enabled;
    config.dose.required = false;
    if (selected !== false) {
      applyDoseDefault(config);
    } else {
      config.dose.value = "";
      config.defaultControl.checked = false;
    }
  });
}

function singleDoseConfigs() {
  return [
    {
      kind: "sodium-benzoate",
      label: "sodium benzoate",
      form: els.packingRecordForm,
      addedName: "packingStabilizerAdded",
      fields: els.packingStabilizerFields,
      dose: els.packingDose,
      defaultControl: els.packingDoseDefault
    },
    {
      kind: "citric-acid",
      label: "citric acid",
      form: els.packingRecordForm,
      addedName: "packingCitricAcidAdded",
      fields: els.packingCitricAcidFields,
      dose: els.packingCitricAcidDose,
      defaultControl: els.packingCitricAcidDoseDefault
    }
  ];
}

function batchDoseConfigs() {
  return [
    {
      kind: "sodium-benzoate",
      label: "sodium benzoate",
      form: els.packingBatchForm,
      addedName: "packingBatchStabilizerAdded",
      fields: els.packingBatchStabilizerFields,
      dose: els.packingBatchDose,
      defaultControl: els.packingBatchDoseDefault
    },
    {
      kind: "citric-acid",
      label: "citric acid",
      form: els.packingBatchForm,
      addedName: "packingBatchCitricAcidAdded",
      fields: els.packingBatchCitricAcidFields,
      dose: els.packingBatchCitricAcidDose,
      defaultControl: els.packingBatchCitricAcidDoseDefault
    }
  ];
}

function allDoseConfigs() {
  return [...singleDoseConfigs(), ...batchDoseConfigs()];
}

function formatBatchNumber(value) {
  return Number(value).toLocaleString("en-KE", { maximumFractionDigits: 3 });
}

function updateBatchState() {
  const count = batchRangeCount();
  els.packingBatchCount.textContent = count > 0 && count <= 100 ? String(count) : "Check range";
  const volume = Number(els.packingBatchVolume.value);
  const unit = els.packingBatchVolumeUnit.value;
  const litresEach = unit === "mL" ? volume / 1000 : volume;
  const valid = count > 0 && count <= 100 && Number.isFinite(volume) && volume > 0;
  els.packingBatchVolumePreview.textContent = valid
    ? count + " containers × " + formatBatchNumber(volume) + " " + unit +
      " = " + formatBatchNumber(count * litresEach) + " L total" +
      (litresEach > 40 && count > 1 ? " · Check: is this volume per container?" : "")
    : "Enter the volume in each container to see the batch total.";
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
