import { authClient } from "./auth_client.js";

let dialog = null;
let currentFarmer = null;
let communities = null;

export function setupFarmerCards(root = document) {
  const target = root || document;
  if (target.dataset?.farmerCardsReady === "true") return;
  target.dataset && (target.dataset.farmerCardsReady = "true");
  target.addEventListener("click", (event) => {
    const button = event.target.closest("[data-farmer-card]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    void openFarmerCard(button.dataset.farmerCard);
  });
}

export function farmerButtonMarkup(farmerId, farmerName, fallback = "-") {
  const id = String(farmerId || "").trim();
  const name = String(farmerName || "").trim();
  if (!id) return escapeHtml(name || fallback);
  const label = [id, name].filter(Boolean).join(" - ");
  return `<button class="farmer-card-link" type="button" data-farmer-card="${escapeAttribute(id)}">${escapeHtml(label)}</button>`;
}

export async function openFarmerCard(farmerId) {
  const card = ensureDialog();
  setStatus("Loading...");
  if (!card.open) card.showModal();
  setEditing(false);

  const { data, error } = await authClient.rpc("ag_farmer_card_detail", {
    p_farmer_id: farmerId
  });
  if (error) {
    setStatus(error.message || "Farmer details could not be loaded.", "error");
    return;
  }

  try {
    currentFarmer = data;
    await loadCommunities();
    renderFarmer(data);
    setStatus("");
  } catch (loadError) {
    setStatus(loadError.message || "Farmer details could not be loaded.", "error");
  }
}

async function loadCommunities() {
  if (communities) return;
  const { data, error } = await authClient
    .from("ag_secure_communities")
    .select("community_id,community_name")
    .order("community_name");
  if (error) throw error;
  communities = Array.isArray(data) ? data : [];
}

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "farmer-detail-dialog";
  dialog.innerHTML = `
    <form class="farmer-detail-panel" method="dialog" data-farmer-form>
      <div class="farmer-detail-head">
        <div>
          <p class="eyebrow">Farmer</p>
          <h2 data-farmer-title>Farmer details</h2>
        </div>
        <button type="button" class="icon-button" data-farmer-close aria-label="Close farmer details" title="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
        </button>
      </div>
      <div class="farmer-detail-grid">
        <label>Farmer ID<input name="farmer_id" type="text" readonly></label>
        <label>Name<input name="name" type="text" maxlength="160" readonly></label>
        <label>Phone<input name="phone" type="tel" maxlength="40" readonly></label>
        <label>Community<select name="community_id" disabled></select></label>
        <label>Farm size<input name="farm_size_value" type="number" inputmode="decimal" min="0" step="0.01" readonly></label>
        <label>Unit<input name="farm_size_unit" type="text" maxlength="40" readonly></label>
        <label class="farmer-detail-wide">Address<input name="address" type="text" maxlength="500" readonly></label>
        <label>Date of birth<input name="date_of_birth" type="date" readonly></label>
        <label>Status<select name="active" disabled><option value="true">Active</option><option value="false">Inactive</option></select></label>
        <label class="farmer-detail-wide">Notes<textarea name="notes" rows="2" maxlength="1000" readonly></textarea></label>
      </div>
      <div class="farmer-detail-actions">
        <span data-farmer-status aria-live="polite"></span>
        <button type="button" data-farmer-edit>Edit</button>
        <button type="button" data-farmer-save hidden>Save</button>
        <button type="button" data-farmer-cancel hidden>Cancel</button>
      </div>
    </form>
  `;
  dialog.querySelector("[data-farmer-close]").addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-farmer-edit]").addEventListener("click", () => setEditing(true));
  dialog.querySelector("[data-farmer-cancel]").addEventListener("click", () => {
    renderFarmer(currentFarmer);
    setEditing(false);
    setStatus("Changes discarded.");
  });
  dialog.querySelector("[data-farmer-save]").addEventListener("click", saveFarmer);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  return dialog;
}

function renderFarmer(farmer) {
  const form = dialog.querySelector("[data-farmer-form]");
  form.elements.farmer_id.value = farmer.farmer_id || "";
  form.elements.name.value = farmer.name || "";
  form.elements.phone.value = farmer.phone || "";
  form.elements.farm_size_value.value = farmer.farm_size_value ?? "";
  form.elements.farm_size_unit.value = farmer.farm_size_unit || "lines";
  form.elements.address.value = farmer.address || "";
  form.elements.date_of_birth.value = farmer.date_of_birth || "";
  form.elements.active.value = String(farmer.active !== false);
  form.elements.notes.value = farmer.notes || "";
  const community = form.elements.community_id;
  community.replaceChildren(new Option("Unassigned", ""));
  (communities || []).forEach((item) => {
    community.append(new Option(
      `${item.community_id} - ${item.community_name}`,
      item.community_id
    ));
  });
  community.value = farmer.community_id || "";
  dialog.querySelector("[data-farmer-title]").textContent = farmer.name || farmer.farmer_id || "Farmer details";
  dialog.querySelector("[data-farmer-edit]").hidden = !farmer.can_edit;
}

function setEditing(editing) {
  if (!dialog) return;
  const form = dialog.querySelector("[data-farmer-form]");
  ["name", "phone", "farm_size_value", "farm_size_unit", "address", "date_of_birth", "notes"]
    .forEach((name) => { form.elements[name].readOnly = !editing; });
  ["community_id", "active"].forEach((name) => { form.elements[name].disabled = !editing; });
  dialog.querySelector("[data-farmer-edit]").hidden = editing || !currentFarmer?.can_edit;
  dialog.querySelector("[data-farmer-save]").hidden = !editing;
  dialog.querySelector("[data-farmer-cancel]").hidden = !editing;
  dialog.classList.toggle("is-editing", editing);
}

async function saveFarmer() {
  if (!currentFarmer?.can_edit) return;
  const form = dialog.querySelector("[data-farmer-form]");
  const save = dialog.querySelector("[data-farmer-save]");
  save.disabled = true;
  setStatus("Saving...");
  const value = (name) => String(form.elements[name].value || "").trim() || null;
  const farmSize = value("farm_size_value");
  const { error } = await authClient.rpc("ag_sec_admin_update_member_registry", {
    p_farmer_id: currentFarmer.farmer_id,
    p_name: value("name"),
    p_phone: value("phone"),
    p_community_id: value("community_id"),
    p_active: form.elements.active.value === "true",
    p_notes: value("notes"),
    p_farm_size_value: farmSize === null ? null : Number(farmSize),
    p_farm_size_unit: value("farm_size_unit") || "lines",
    p_address: value("address"),
    p_date_of_birth: value("date_of_birth")
  });
  save.disabled = false;
  if (error) {
    setStatus(error.message || "Farmer details could not be saved.", "error");
    return;
  }
  setStatus("Saved.");
  setEditing(false);
  await openFarmerCard(currentFarmer.farmer_id);
  document.dispatchEvent(new CustomEvent("farmer-card-updated", {
    detail: { farmerId: currentFarmer.farmer_id }
  }));
}

function setStatus(message, state = "") {
  if (!dialog) return;
  const status = dialog.querySelector("[data-farmer-status]");
  status.textContent = message || "";
  status.dataset.status = state;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
