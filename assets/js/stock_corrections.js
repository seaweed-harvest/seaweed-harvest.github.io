import { callRpc } from "./supabase_client.js";

const $ = (id) => document.getElementById(id);
const panel = $("stockCorrections");
const state = { rows: [], batches: [], batchId: "", recordId: "", mode: "record", busy: false };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (value) => value === "" || value === null || value === undefined ? null : Number(value);
const localDate = () => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const get = (key) => p.find((part) => part.type === key)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const serialNumber = (row) => BigInt(row.carton_serial || 0);
const bySerial = (a, b) => serialNumber(a) < serialNumber(b) ? -1 : serialNumber(a) > serialNumber(b) ? 1 : 0;
const displaySerial = (row) => row?.carton_serial || "–";
const batchFor = (id) => state.batches.find((batch) => batch.id === id);
const recordFor = (id) => state.rows.find((row) => String(row.id) === String(id));
function status(text, error = false) {
  const el = $("scStatus");
  el.textContent = text;
  el.style.color = error ? "#b42318" : "";
}
function editableFieldsDisabled(disabled) {
  // Do not override per-record permission-disabled Save buttons after rendering.
  ["scRefresh", "scDate", "scBatchSelect"].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = disabled;
  });
}

if (panel) {
  $("scDate").value = localDate();
  $("scRefresh").addEventListener("click", () => void refresh());
  $("scDate").addEventListener("change", () => void refresh());
  $("scModeRecord").addEventListener("click", () => switchMode("record"));
  $("scModeBatch").addEventListener("click", () => switchMode("batch"));
  $("scBatchSelect").addEventListener("change", (event) => {
    state.batchId = event.target.value;
    render();
  });
  $("scRecordList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-sc-record-id]");
    if (!button) return;
    state.recordId = button.dataset.scRecordId;
    render();
  });
  $("scRecordEditor").addEventListener("submit", (event) => {
    event.preventDefault();
    void saveRecord(event.target);
  });
  $("scBatchEditor").addEventListener("submit", (event) => {
    event.preventDefault();
    void saveBatch(event.target);
  });
  $("scApplyShared").addEventListener("change", (event) => {
    $("scBatchSharedFields").hidden = !event.target.checked;
  });
  void refresh();
}

async function refresh() {
  if (state.busy) return;
  state.busy = true;
  editableFieldsDisabled(true);
  status("Loading stock entries…");
  try {
    const result = await callRpc("ag_today_form_records", { p_record_date: $("scDate").value });
    state.rows = (result.stock_records || [])
      .filter((row) => row.record_type === "initial")
      .sort(bySerial);
    const groups = new Map();
    state.rows.forEach((row) => {
      if (!row.batch_submission_id) return;
      if (!groups.has(row.batch_submission_id)) groups.set(row.batch_submission_id, []);
      groups.get(row.batch_submission_id).push(row);
    });
    state.batches = [...groups].map(([id, rows]) => ({ id, rows: rows.sort(bySerial) }));
    if (!batchFor(state.batchId)) state.batchId = state.batches[0]?.id || "";
    if (!recordFor(state.recordId)) state.recordId = state.rows[0]?.id || "";
    render();
    status(`${state.rows.length} stock record${state.rows.length === 1 ? "" : "s"} for ${$("scDate").value}.`);
  } catch (error) {
    state.rows = [];
    state.batches = [];
    render();
    status(error?.message || "Stock records could not be loaded.", true);
  } finally {
    state.busy = false;
    editableFieldsDisabled(false);
  }
}
function switchMode(mode) {
  state.mode = mode;
  render();
}
function render() {
  for (const mode of ["record", "batch"]) {
    const selected = mode === state.mode;
    $(mode === "record" ? "scModeRecord" : "scModeBatch").setAttribute("aria-pressed", String(selected));
  }
  $("scRecordArea").hidden = state.mode !== "record";
  $("scBatchArea").hidden = state.mode !== "batch";
  renderRecordChoices();
  renderRecord();
  renderBatchChoices();
  renderBatch();
}
function renderRecordChoices() {
  const items = state.rows;
  $("scRecordList").innerHTML = items.length
    ? items.map((row) => `<button type="button" data-sc-record-id="${esc(row.id)}"
         aria-pressed="${String(row.id === state.recordId)}">
         ${esc(displaySerial(row))}</button>`).join("")
    : '<p>No stock entries on this date.</p>';
}
function textField(key, label, value, { type = "text", required = false, step = "any", min = "", max = "" } = {}) {
  return `<label>${esc(label)}<input name="${esc(key)}" type="${type}" value="${esc(value)}"
   ${required ? "required" : ""} ${type === "number" ? `step="${step}" ${min !== "" ? `min="${min}"` : ""} ${max !== "" ? `max="${max}"` : ""}` : ""}></label>`;
}
function selectField(key, label, value, options) {
  return `<label>${esc(label)}<select name="${esc(key)}">${options.map(([v, name]) =>
    `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(name)}</option>`).join("")}</select></label>`;
}
function checkField(key, label, checked) {
  return `<label class="sc-check"><input type="checkbox" name="${esc(key)}" ${checked ? "checked" : ""}> ${esc(label)}</label>`;
}
const speciesOptions = [["spinosum", "Spinosum"], ["cottonii", "Cottonii"], ["other", "Other"]];
const salinityOptions = [["ppt", "ppt"], ["PSU", "PSU"]];
const volumeOptions = [["L", "L"], ["mL", "mL"]];
function renderRecord() {
  const row = recordFor(state.recordId);
  const el = $("scRecordEditor");
  if (!row) { el.innerHTML = ""; return; }
  const canEdit = !!row.can_edit;
  el.innerHTML = `
    <h3>Container ${esc(row.carton_serial)}</h3>
    <div class="sc-grid">
      ${textField("carton_serial","Container number",row.carton_serial,{ required:true })}
      ${textField("packed_on","Production date",row.packed_on,{ type:"date", required:true })}
      ${selectField("species","Species",row.species,speciesOptions)}
      ${textField("weight_value","Volume",row.weight_value,{ type:"number",required:true,min:"0.001" })}
      ${selectField("weight_unit","Volume unit",row.weight_unit,volumeOptions)}
      ${textField("salinity_value","Salinity",row.salinity_value,{type:"number",min:"0"})}
      ${selectField("salinity_unit","Salinity unit",row.salinity_unit,salinityOptions)}
      ${textField("ph_value","pH",row.ph_value,{type:"number",min:"0",max:"14"})}
      ${textField("electrical_conductivity_ms_cm","EC (mS/cm)",row.electrical_conductivity_ms_cm,{type:"number",min:"0"})}
      ${textField("brix_value","Brix (°Bx)",row.brix_value,{type:"number",min:"0",max:"100"})}
      ${textField("hydrometer_value","Hydrometer reading",row.hydrometer_value,{type:"number"})}
      ${selectField("hydrometer_scale","Hydrometer scale",row.hydrometer_scale || "",[["","Not recorded"],["SG","SG"],["Baume","Baumé"],["g/mL","g/mL"],["unconfirmed","Unconfirmed"]])}
      ${textField("room_temperature_c","Temperature (°C)",row.room_temperature_c,{type:"number"})}
      ${checkField("stabilizer_added","Stabiliser added",row.stabilizer_added)}
      ${textField("chemical_dose_value","Stabiliser (g/container)",row.chemical_dose_value,{type:"number",min:"0"})}
      ${checkField("citric_acid_added","Citric acid added",row.citric_acid_added)}
      ${textField("citric_acid_dose_value","Citric acid (g/container)",row.citric_acid_dose_value,{type:"number",min:"0"})}
      ${textField("recorded_by_name","Recorded by",row.recorded_by_name,{required:true})}
      ${textField("notes","Notes",row.notes)}
    </div>
    <div class="sc-actions"><button type="submit" ${canEdit ? "" : "disabled"}>Save record</button></div>
    ${canEdit ? "" : '<p class="sc-help">You do not have permission to edit this record.</p>'}
  `;
}
function renderBatchChoices() {
  const select = $("scBatchSelect");
  select.innerHTML = state.batches.length
    ? state.batches.map((batch) => `<option value="${esc(batch.id)}" ${batch.id === state.batchId ? "selected" : ""}>
       ${esc(displaySerial(batch.rows[0]))}–${esc(displaySerial(batch.rows.at(-1)))}
       (${batch.rows.length} containers)</option>`).join("")
    : '<option value="">No batches on this date</option>';
}
function renderBatch() {
  const batch = batchFor(state.batchId);
  const form = $("scBatchEditor");
  form.hidden = !batch;
  if (!batch) return;
  const first = batch.rows[0];
  const last = batch.rows.at(-1);
  $("scBatchFirst").value = first.carton_serial;
  $("scBatchLast").value = last.carton_serial;
  $("scApplyShared").checked = false;
  $("scBatchSharedFields").hidden = true;
  const values = {
    species: first.species, weight_value: first.weight_value,weight_unit:first.weight_unit,
    stabilizer_added:first.stabilizer_added,chemical_dose_value:first.chemical_dose_value,
    citric_acid_added:first.citric_acid_added,citric_acid_dose_value:first.citric_acid_dose_value,
    salinity_value:first.salinity_value,salinity_unit:first.salinity_unit,ph_value:first.ph_value,
    electrical_conductivity_ms_cm:first.electrical_conductivity_ms_cm,brix_value:first.brix_value
  };
  const different = batch.rows.some((row) => Object.keys(values).some((key) =>
    String(row[key] ?? "") !== String(values[key] ?? "")));
  $("scBatchSummary").textContent = `${batch.rows.length} containers on ${first.packed_on}.` +
    (different ? " Some containers have different measurements; batch-wide edits will replace them." : "");
  $("scBatchSharedFields").innerHTML = `<div class="sc-grid">
    ${selectField("species","Species",first.species,speciesOptions)}
    ${textField("weight_value","Volume per container",first.weight_value,{type:"number",required:true,min:"0.001"})}
    ${selectField("weight_unit","Volume unit",first.weight_unit,volumeOptions)}
    ${textField("salinity_value","Salinity",first.salinity_value,{type:"number",min:"0"})}
    ${selectField("salinity_unit","Salinity unit",first.salinity_unit,salinityOptions)}
    ${textField("ph_value","pH",first.ph_value,{type:"number",min:"0",max:"14"})}
    ${textField("electrical_conductivity_ms_cm","EC (mS/cm)",first.electrical_conductivity_ms_cm,{type:"number",min:"0"})}
    ${textField("brix_value","Brix (°Bx)",first.brix_value,{type:"number",min:"0",max:"100"})}
    ${checkField("stabilizer_added","Stabiliser added",first.stabilizer_added)}
    ${textField("chemical_dose_value","Stabiliser (g/container)",first.chemical_dose_value,{type:"number",min:"0"})}
    ${checkField("citric_acid_added","Citric acid added",first.citric_acid_added)}
    ${textField("citric_acid_dose_value","Citric acid (g/container)",first.citric_acid_dose_value,{type:"number",min:"0"})}
  </div>`;
  form.querySelector('button[type="submit"]').disabled = !batch.rows.every((row) => row.can_edit);
}
async function saveRecord(form) {
  const row = recordFor(state.recordId);
  if (!row || !row.can_edit || state.busy) return;
  const data = new FormData(form);
  const entry = Object.fromEntries(data.entries());
  const changes = {
    id:row.id,expected_updated_at:row.updated_at,
    carton_serial:String(entry.carton_serial||"").trim(),
    packed_on:entry.packed_on,
    species:entry.species,weight_value:num(entry.weight_value),
    weight_unit:entry.weight_unit,
    salinity_value:num(entry.salinity_value),salinity_unit:entry.salinity_unit,
    ph_value:num(entry.ph_value),
    electrical_conductivity_ms_cm:num(entry.electrical_conductivity_ms_cm),
    brix_value:num(entry.brix_value),hydrometer_value:num(entry.hydrometer_value),
    hydrometer_scale:entry.hydrometer_scale||null,room_temperature_c:num(entry.room_temperature_c),
    stabilizer_added:data.has("stabilizer_added"),
    chemical_dose_value:num(entry.chemical_dose_value),chemical_dose_unit:"g/container",
    citric_acid_added:data.has("citric_acid_added"),
    citric_acid_dose_value:num(entry.citric_acid_dose_value),
    citric_acid_dose_unit:"g/container",
    recorded_by_name:String(entry.recorded_by_name||"").trim(),
    notes:String(entry.notes||"").trim()||null
  };
  state.busy=true;
  form.querySelector('button[type="submit"]').disabled=true;
  status("Saving record…");
  try {
    await callRpc("ag_correct_stabilization_packing_record",{p_update:changes});
    $("scDate").value = changes.packed_on;
    await refreshAfterSave(`Container ${changes.carton_serial} saved.`);
  } catch(error) {
    status(error?.message||"Record could not be saved.",true);
  } finally {
    state.busy=false;
    const button=form.querySelector('button[type="submit"]');
    if(button) button.disabled=false;
  }
}
async function saveBatch(form) {
  const batch=batchFor(state.batchId);
  if(!batch || state.busy) return;
  const data=new FormData(form);
  const first=String(data.get("first_carton_serial")||"").trim();
  const last=String(data.get("last_carton_serial")||"").trim();
  if(!/^[0-9]{1,18}$/.test(first)|| !/^[0-9]{1,18}$/.test(last)||BigInt(last)<BigInt(first)
      ||BigInt(last)-BigInt(first)>=100n) {
    status("Enter a valid range of up to 100 container numbers.",true);return;
  }
  const removals=batch.rows.filter((row)=>serialNumber(row)<BigInt(first)||serialNumber(row)>BigInt(last));
  if(removals.length && !window.confirm(`Remove ${removals.length} container${removals.length===1?"":"s"} outside the new range? They will be archived in Deleted Records.`)) return;
  const apply=data.has("apply_shared");
  if(apply && !window.confirm("Apply these measurements to every container in this batch?")) return;
  const p={
    first_carton_serial:first,last_carton_serial:last,
    expected_count:batch.rows.length,
    expected_latest_updated_at:batch.rows.map((row)=>row.updated_at).sort().at(-1),
    allow_remove:removals.length>0,apply_shared:apply
  };
  if(apply) {
    for(const key of ["species","weight_unit","salinity_unit"]) p[key]=data.get(key);
    for(const key of ["weight_value","chemical_dose_value","citric_acid_dose_value",
      "salinity_value","ph_value","electrical_conductivity_ms_cm","brix_value"]) {
      p[key]=num(data.get(key));
    }
    p.stabilizer_added=data.has("stabilizer_added");
    p.citric_acid_added=data.has("citric_acid_added");
  }
  state.busy=true;
  form.querySelector('button[type="submit"]').disabled=true;
  status("Saving batch corrections…");
  try {
    const result=await callRpc("ag_correct_stabilization_packing_batch",{
      p_batch_submission_id:batch.id,p_correction:p
    });
    await refreshAfterSave(
      `Batch saved: ${result.added_count} added, ${result.removed_count} removed` +
      (result.updated_count ? `, ${result.updated_count} measurement records updated.` : ".")
    );
  } catch(error) {
    status(error?.message||"Batch could not be saved.",true);
  } finally {
    state.busy=false;
    const button=form.querySelector('button[type="submit"]');
    if(button) button.disabled=false;
  }
}
async function refreshAfterSave(message) {
  state.busy=false;
  await refresh();
  status(message);
}
