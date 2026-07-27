import { authClient, requireAdminAccess } from "./auth_client.js?v=25";

const ACCESS_OPTIONS = {
  private: [
    ["private", "Private"],
    ["paused", "Paused"]
  ],
  review: [
    ["private", "Private"],
    ["review", "Review link"],
    ["paused", "Paused"]
  ],
  live: [
    ["private", "Private"],
    ["link", "Anyone with link"],
    ["public", "Public"],
    ["paused", "Paused"]
  ]
};

const ACCESS_HELP = {
  private: "Only signed-in users with form access can submit.",
  link: "Anyone with the current private link can submit live records.",
  public: "Anyone who opens the form can submit live records.",
  review: "The link accepts test submissions only. Operational records are untouched.",
  paused: "Nobody can open or submit this form."
};

const state = {
  organisation: null,
  forms: [],
  activeDialogForm: null
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "reloadFormManager", "formManagerOrganisation", "formManagerStatus",
    "formManagerRows", "formShareDialog", "formShareDialogTitle",
    "formShareDialogHelp", "formShareLink", "copyFormShareLink",
    "openFormShareLink", "closeFormShareDialog", "formShareDialogStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  els.reloadFormManager.addEventListener("click", loadManager);
  els.formManagerRows.addEventListener("change", handleRowChange);
  els.formManagerRows.addEventListener("click", handleRowAction);
  els.copyFormShareLink.addEventListener("click", copyDialogLink);
  els.openFormShareLink.addEventListener("click", openDialogLink);
  els.closeFormShareDialog.addEventListener("click", closeShareDialog);
  els.formShareDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeShareDialog();
  });

  const access = await requireAdminAccess("can_manage_settings");
  if (!access) return;
  await loadManager();
}

async function loadManager() {
  setStatus("Loading forms...");
  els.reloadFormManager.disabled = true;
  try {
    const { data, error } = await authClient.rpc("ag_admin_form_manager");
    if (error) throw error;
    state.organisation = data?.organisation || null;
    state.forms = Array.isArray(data?.forms) ? data.forms : [];
    els.formManagerOrganisation.textContent = state.organisation
      ? `${state.organisation.name} (${state.organisation.code})`
      : "Active organisation";
    renderRows();
    setStatus(state.forms.length
      ? `${state.forms.length} ${state.forms.length === 1 ? "form" : "forms"} available.`
      : "No forms are enabled for this organisation.");
  } catch (error) {
    state.forms = [];
    renderRows();
    setStatus(error.message || "Forms could not be loaded.", "error");
  } finally {
    els.reloadFormManager.disabled = false;
  }
}

function renderRows() {
  els.formManagerRows.replaceChildren();
  if (!state.forms.length) {
    const empty = document.createElement("p");
    empty.className = "form-manager-empty";
    empty.textContent = "Enable forms under Permissions before managing their entry access.";
    els.formManagerRows.append(empty);
    return;
  }

  state.forms.forEach((form) => {
    const row = document.createElement("article");
    row.className = "form-manager-row";
    row.dataset.formKey = form.form_key;
    row.dataset.savedAccess = form.entry_access;

    const copy = document.createElement("div");
    copy.className = "form-manager-form-copy";
    const name = document.createElement("h3");
    name.textContent = form.name;
    const description = document.createElement("p");
    description.textContent = form.description;
    copy.append(name, description);

    const access = document.createElement("div");
    access.className = "form-manager-access";
    const accessLabel = document.createElement("label");
    accessLabel.htmlFor = `formAccess-${form.form_key}`;
    accessLabel.textContent = "Entry";
    const select = document.createElement("select");
    select.id = `formAccess-${form.form_key}`;
    select.dataset.formAccess = "";
    (ACCESS_OPTIONS[form.sharing_support] || ACCESS_OPTIONS.private).forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    });
    select.value = form.entry_access;
    access.append(accessLabel, select);

    const records = document.createElement("div");
    records.className = "form-manager-records";
    const recordsLabel = document.createElement("span");
    recordsLabel.textContent = "Records";
    const recordsValue = document.createElement("strong");
    recordsValue.textContent = "Private";
    records.append(recordsLabel, recordsValue);

    const actions = document.createElement("div");
    actions.className = "form-manager-actions";
    actions.append(
      actionButton("Save", "save", "form-manager-save", true),
      actionButton("Preview", "preview")
    );
    if (form.builder_route) {
      const builder = document.createElement("a");
      builder.href = `./${form.builder_route}`;
      builder.textContent = "Form Builder";
      actions.append(builder);
    }
    if (form.share_link_id) {
      actions.append(
        actionButton("Copy link", "share"),
        actionButton("New link", "regenerate")
      );
    }

    const summary = document.createElement("div");
    summary.className = "form-manager-share-summary";
    summary.dataset.accessSummary = "";
    row.append(copy, access, records, actions, summary);
    els.formManagerRows.append(row);
    renderRowState(row, form);
  });
}

function renderRowState(row, form) {
  const select = row.querySelector("[data-form-access]");
  const current = select.value;
  const dirty = current !== row.dataset.savedAccess;
  row.classList.toggle("is-dirty", dirty);
  const save = row.querySelector('[data-form-action="save"]');
  save.disabled = !dirty;

  const summary = row.querySelector("[data-access-summary]");
  summary.replaceChildren();
  const help = document.createElement("span");
  help.textContent = ACCESS_HELP[current] || "";
  summary.append(help);
  if (form.shared_submission_count > 0 && form.sharing_support === "review") {
    const count = document.createElement("strong");
    count.textContent = `${form.shared_submission_count} test ${form.shared_submission_count === 1 ? "submission" : "submissions"}`;
    summary.append(count);
  }
}

function handleRowChange(event) {
  const select = event.target.closest("[data-form-access]");
  if (!select) return;
  const row = select.closest("[data-form-key]");
  const form = formForRow(row);
  renderRowState(row, form);
}

async function handleRowAction(event) {
  const button = event.target.closest("[data-form-action]");
  if (!button) return;
  const row = button.closest("[data-form-key]");
  const form = formForRow(row);
  if (!form) return;

  const action = button.dataset.formAction;
  if (action === "save") await saveAccess(row, form);
  if (action === "preview") openPreview(row, form);
  if (action === "share") openShareDialog(form);
  if (action === "regenerate") await regenerateLink(row, form);
}

async function saveAccess(row, form) {
  const access = row.querySelector("[data-form-access]").value;
  setRowDisabled(row, true);
  setStatus(`Saving ${form.name}...`);
  try {
    const { data, error } = await authClient.rpc("ag_admin_save_form_access", {
      p_form_key: form.form_key,
      p_entry_access: access
    });
    if (error) throw error;
    replaceManagerData(data);
    setStatus(`${form.name} entry access is now ${accessLabel(access)}.`);
    const savedForm = state.forms.find((item) => item.form_key === form.form_key);
    if (savedForm?.share_link_id && ["link", "review"].includes(savedForm.entry_access)) {
      openShareDialog(savedForm);
    }
  } catch (error) {
    setRowDisabled(row, false);
    setStatus(error.message || `${form.name} could not be saved.`, "error");
  }
}

async function regenerateLink(row, form) {
  if (!window.confirm(`Create a new link for ${form.name}? The previous link will stop working.`)) return;
  setRowDisabled(row, true);
  setStatus(`Creating a new ${form.name} link...`);
  try {
    const { data, error } = await authClient.rpc("ag_admin_regenerate_form_share_link", {
      p_form_key: form.form_key
    });
    if (error) throw error;
    replaceManagerData(data);
    const refreshed = state.forms.find((item) => item.form_key === form.form_key);
    setStatus(`A new ${form.name} link is ready.`);
    openShareDialog(refreshed);
  } catch (error) {
    setRowDisabled(row, false);
    setStatus(error.message || "A new link could not be created.", "error");
  }
}

function replaceManagerData(data) {
  state.organisation = data?.organisation || state.organisation;
  state.forms = Array.isArray(data?.forms) ? data.forms : state.forms;
  renderRows();
}

function openPreview(row, form) {
  const selectedAccess = row.querySelector("[data-form-access]").value;
  if (selectedAccess !== row.dataset.savedAccess) {
    setStatus("Save the entry setting before previewing the form.", "error");
    return;
  }
  if (selectedAccess === "paused") {
    setStatus("This form is paused. Change and save its entry setting before previewing.", "error");
    return;
  }
  const url = formUrl(form, { includeShareToken: true });
  window.open(url, "_blank", "noopener,noreferrer");
}

function openShareDialog(form) {
  if (!form?.share_link_id) {
    setStatus("Save a link entry mode first.", "error");
    return;
  }
  state.activeDialogForm = form;
  const url = formUrl(form, { includeShareToken: true });
  els.formShareDialogTitle.textContent = form.name;
  els.formShareDialogHelp.textContent = form.entry_access === "review"
    ? "This review link saves test submissions separately. It cannot read or change operational records."
    : "Anyone with this link can submit the form. Stored records remain private.";
  els.formShareLink.value = url;
  els.formShareDialogStatus.textContent = "";
  els.formShareDialog.showModal();
  requestAnimationFrame(() => els.formShareLink.select());
}

async function copyDialogLink() {
  try {
    await navigator.clipboard.writeText(els.formShareLink.value);
    setDialogStatus("Link copied.");
  } catch {
    els.formShareLink.select();
    const copied = document.execCommand("copy");
    setDialogStatus(copied ? "Link copied." : "Select and copy the link.");
  }
}

function openDialogLink() {
  if (!els.formShareLink.value) return;
  window.open(els.formShareLink.value, "_blank", "noopener,noreferrer");
}

function closeShareDialog() {
  state.activeDialogForm = null;
  els.formShareDialog.close();
}

function formUrl(form, { includeShareToken = false } = {}) {
  const route = String(form.route || "").replace(/^\.?\//, "");
  const url = new URL(route, window.location.href);
  if (state.organisation?.code) url.searchParams.set("org", state.organisation.code);
  if (includeShareToken && form.share_link_id) {
    url.searchParams.set("share", form.share_link_id);
  }
  return url.toString();
}

function formForRow(row) {
  return state.forms.find((form) => form.form_key === row?.dataset.formKey) || null;
}

function actionButton(label, action, className = "", disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.formAction = action;
  if (className) button.className = className;
  button.disabled = disabled;
  return button;
}

function setRowDisabled(row, disabled) {
  row.querySelectorAll("button, select").forEach((control) => {
    control.disabled = disabled;
  });
}

function accessLabel(access) {
  const pair = Object.values(ACCESS_OPTIONS).flat()
    .find(([value]) => value === access);
  return pair?.[1] || access;
}

function setStatus(message, kind = "") {
  els.formManagerStatus.textContent = message;
  els.formManagerStatus.dataset.status = kind;
}

function setDialogStatus(message, kind = "") {
  els.formShareDialogStatus.textContent = message;
  els.formShareDialogStatus.dataset.status = kind;
}
