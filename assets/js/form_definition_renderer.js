const SCHEMA_VERSION = 1;
const FORM_TEMPLATES = new Set(["linear", "grid"]);
const FIELD_TYPES = new Set([
  "text",
  "textarea",
  "number",
  "currency",
  "select",
  "multi-select",
  "checkbox",
  "date",
  "time",
  "datetime",
  "email",
  "tel",
  "calculation",
  "readonly",
  "file",
  "gps",
  "qr-text"
]);
const SAVE_STATES = new Set(["none", "local", "syncing", "saved"]);
const VALUE_STATES = new Set(["default", "calculated", "suggested"]);
const ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{1,49}$/;

const FORM_KEYS = new Set([
  "schemaVersion",
  "id",
  "title",
  "template",
  "sections",
  "ledgerColumns"
]);
const SECTION_KEYS = new Set(["id", "title", "description", "columns", "fields"]);
const FIELD_KEYS = new Set([
  "key",
  "label",
  "type",
  "hint",
  "placeholder",
  "unit",
  "options",
  "defaultValue",
  "required",
  "recommended",
  "readOnly",
  "disabled",
  "disabledReason",
  "calculated",
  "suggested",
  "min",
  "max",
  "step"
]);
const LEDGER_KEYS = new Set(["key", "label", "type", "unit"]);
const FIELD_STATE_KEYS = new Set([
  "invalid",
  "message",
  "disabled",
  "disabledReason",
  "readOnly",
  "valueState"
]);

export class FormDefinitionValidationError extends Error {
  constructor(errors) {
    super(`Invalid form definition: ${errors.join("; ")}`);
    this.name = "FormDefinitionValidationError";
    this.errors = [...errors];
  }
}

export function validateFormDefinition(candidate) {
  const errors = [];
  if (!isPlainObject(candidate)) {
    throw new FormDefinitionValidationError(["definition must be an object"]);
  }

  rejectUnknownKeys(candidate, FORM_KEYS, "definition", errors);
  const id = requiredIdentifier(candidate.id, "definition.id", ID_PATTERN, errors);
  const title = requiredText(candidate.title, "definition.title", 120, errors);
  const template = String(candidate.template || "");
  if (!FORM_TEMPLATES.has(template)) {
    errors.push(`definition.template must be one of ${[...FORM_TEMPLATES].join(", ")}`);
  }
  if (candidate.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`definition.schemaVersion must be ${SCHEMA_VERSION}`);
  }

  const sections = Array.isArray(candidate.sections)
    ? candidate.sections.map((section, index) => normalizeSection(section, index, errors))
    : [];
  if (!Array.isArray(candidate.sections) || !candidate.sections.length) {
    errors.push("definition.sections must contain at least one section");
  }

  const sectionIds = sections.map((section) => section.id).filter(Boolean);
  rejectDuplicates(sectionIds, "section id", errors);
  const fields = sections.flatMap((section) => section.fields);
  const fieldKeys = fields.map((field) => field.key).filter(Boolean);
  rejectDuplicates(fieldKeys, "field key", errors);

  const ledgerColumns = Array.isArray(candidate.ledgerColumns)
    ? candidate.ledgerColumns.map((column, index) => normalizeLedgerColumn(column, index, fieldKeys, errors))
    : [];
  if (candidate.ledgerColumns !== undefined && !Array.isArray(candidate.ledgerColumns)) {
    errors.push("definition.ledgerColumns must be an array");
  }
  rejectDuplicates(ledgerColumns.map((column) => column.key).filter(Boolean), "ledger column key", errors);

  if (errors.length) throw new FormDefinitionValidationError(errors);
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    title,
    template,
    sections,
    ledgerColumns
  };
}

export function createFormViewModel(candidate, runtime = {}) {
  const definition = validateFormDefinition(candidate);
  const values = isPlainObject(runtime.values) ? runtime.values : {};
  const fieldStates = isPlainObject(runtime.fieldStates) ? runtime.fieldStates : {};
  const fieldKeys = new Set(definition.sections.flatMap((section) => section.fields.map((field) => field.key)));
  const runtimeErrors = [];

  Object.keys(fieldStates).forEach((key) => {
    if (!fieldKeys.has(key)) runtimeErrors.push(`runtime field state references unknown field ${key}`);
    else rejectUnknownKeys(fieldStates[key], FIELD_STATE_KEYS, `runtime.fieldStates.${key}`, runtimeErrors);
  });

  const saveState = runtime.saveState === undefined ? "none" : String(runtime.saveState);
  if (!SAVE_STATES.has(saveState)) {
    runtimeErrors.push(`runtime.saveState must be one of ${[...SAVE_STATES].join(", ")}`);
  }
  if (runtimeErrors.length) throw new FormDefinitionValidationError(runtimeErrors);

  return {
    ...definition,
    saveState,
    saveMessage: optionalText(runtime.saveMessage, 180),
    sections: definition.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        const runtimeState = isPlainObject(fieldStates[field.key]) ? fieldStates[field.key] : {};
        const valueState = runtimeState.valueState
          || (field.calculated ? "calculated" : field.suggested ? "suggested" : "default");
        if (!VALUE_STATES.has(valueState)) {
          throw new FormDefinitionValidationError([
            `runtime.fieldStates.${field.key}.valueState must be one of ${[...VALUE_STATES].join(", ")}`
          ]);
        }
        return {
          ...field,
          value: Object.hasOwn(values, field.key) ? values[field.key] : field.defaultValue,
          invalid: Boolean(runtimeState.invalid),
          message: optionalText(runtimeState.message, 180),
          disabled: runtimeState.disabled === undefined ? field.disabled : Boolean(runtimeState.disabled),
          disabledReason: optionalText(runtimeState.disabledReason, 180) || field.disabledReason,
          readOnly: runtimeState.readOnly === undefined ? field.readOnly : Boolean(runtimeState.readOnly),
          valueState
        };
      })
    }))
  };
}

export function ledgerColumnsFromDefinition(candidate) {
  return validateFormDefinition(candidate).ledgerColumns.map((column) => ({ ...column }));
}

export function renderFormDefinition(container, candidate, runtime = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("A DOM container with replaceChildren() is required.");
  }
  const model = createFormViewModel(candidate, runtime);
  const root = document.createElement("section");
  root.className = `standard-form standard-form-definition standard-form-${model.template}-layout`;
  root.dataset.formDefinitionId = model.id;
  root.dataset.formTemplate = model.template;
  root.setAttribute("aria-label", model.title);

  if (model.saveState !== "none") root.append(renderSaveStatus(model.saveState, model.saveMessage));
  model.sections.forEach((section) => root.append(renderSection(model.id, section)));
  container.replaceChildren(root);
  return { definition: model, root, ledgerColumns: model.ledgerColumns.map((column) => ({ ...column })) };
}

function normalizeSection(candidate, index, errors) {
  const path = `definition.sections[${index}]`;
  if (!isPlainObject(candidate)) {
    errors.push(`${path} must be an object`);
    return { id: "", title: "", description: "", columns: 1, fields: [] };
  }
  rejectUnknownKeys(candidate, SECTION_KEYS, path, errors);
  const fields = Array.isArray(candidate.fields)
    ? candidate.fields.map((field, fieldIndex) => normalizeField(field, `${path}.fields[${fieldIndex}]`, errors))
    : [];
  if (!Array.isArray(candidate.fields) || !candidate.fields.length) {
    errors.push(`${path}.fields must contain at least one field`);
  }
  const columns = Number(candidate.columns ?? 1);
  if (!Number.isInteger(columns) || columns < 1 || columns > 4) {
    errors.push(`${path}.columns must be an integer from 1 to 4`);
  }
  return {
    id: requiredIdentifier(candidate.id, `${path}.id`, ID_PATTERN, errors),
    title: requiredText(candidate.title, `${path}.title`, 120, errors),
    description: optionalText(candidate.description, 300),
    columns: Number.isInteger(columns) && columns >= 1 && columns <= 4 ? columns : 1,
    fields
  };
}

function normalizeField(candidate, path, errors) {
  if (!isPlainObject(candidate)) {
    errors.push(`${path} must be an object`);
    return emptyField();
  }
  rejectUnknownKeys(candidate, FIELD_KEYS, path, errors);
  const type = String(candidate.type || "");
  if (!FIELD_TYPES.has(type)) {
    errors.push(`${path}.type must be one of ${[...FIELD_TYPES].join(", ")}`);
  }
  const required = Boolean(candidate.required);
  const recommended = Boolean(candidate.recommended);
  if (required && recommended) errors.push(`${path} cannot be both required and recommended`);
  const options = Array.isArray(candidate.options)
    ? candidate.options.map((option) => String(option).trim()).filter(Boolean)
    : [];
  if (["select", "multi-select"].includes(type) && !options.length) {
    errors.push(`${path}.options must contain at least one option for ${type}`);
  }
  rejectDuplicates(options, `${path} option`, errors);
  const calculated = type === "calculation" || Boolean(candidate.calculated);
  const readOnly = type === "readonly" || calculated || Boolean(candidate.readOnly);
  if (calculated && candidate.suggested) {
    errors.push(`${path} cannot be both calculated and suggested`);
  }
  const min = optionalFiniteNumber(candidate.min, `${path}.min`, errors);
  const max = optionalFiniteNumber(candidate.max, `${path}.max`, errors);
  const step = optionalFiniteNumber(candidate.step, `${path}.step`, errors);
  if (min !== null && max !== null && min > max) errors.push(`${path}.min cannot exceed max`);
  if (step !== null && step <= 0) errors.push(`${path}.step must be greater than zero`);

  return {
    key: requiredIdentifier(candidate.key, `${path}.key`, FIELD_KEY_PATTERN, errors),
    label: requiredText(candidate.label, `${path}.label`, 120, errors),
    type: FIELD_TYPES.has(type) ? type : "text",
    hint: optionalText(candidate.hint, 300),
    placeholder: optionalText(candidate.placeholder, 180),
    unit: optionalText(candidate.unit, 40),
    options,
    defaultValue: normalizeDefaultValue(candidate.defaultValue),
    required,
    recommended,
    readOnly,
    disabled: Boolean(candidate.disabled),
    disabledReason: optionalText(candidate.disabledReason, 180),
    calculated,
    suggested: Boolean(candidate.suggested),
    min,
    max,
    step
  };
}

function normalizeLedgerColumn(candidate, index, fieldKeys, errors) {
  const path = `definition.ledgerColumns[${index}]`;
  if (!isPlainObject(candidate)) {
    errors.push(`${path} must be an object`);
    return { key: "", label: "", type: "text", unit: "" };
  }
  rejectUnknownKeys(candidate, LEDGER_KEYS, path, errors);
  const key = requiredIdentifier(candidate.key, `${path}.key`, FIELD_KEY_PATTERN, errors);
  if (key && !fieldKeys.includes(key)) errors.push(`${path}.key must reference a defined field`);
  return {
    key,
    label: requiredText(candidate.label, `${path}.label`, 120, errors),
    type: optionalText(candidate.type, 40) || "text",
    unit: optionalText(candidate.unit, 40)
  };
}

function renderSection(formId, section) {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "standard-form-section standard-definition-section";
  fieldset.dataset.sectionId = section.id;
  const legend = document.createElement("legend");
  legend.textContent = section.title;
  fieldset.append(legend);
  if (section.description) {
    const description = document.createElement("p");
    description.className = "standard-section-description";
    description.textContent = section.description;
    fieldset.append(description);
  }
  const grid = document.createElement("div");
  grid.className = "standard-form-grid";
  grid.dataset.columns = String(section.columns);
  section.fields.forEach((field) => grid.append(renderField(formId, section.id, field)));
  fieldset.append(grid);
  return fieldset;
}

function renderField(formId, sectionId, field) {
  const wrapper = document.createElement("div");
  wrapper.className = "standard-field standard-definition-field";
  wrapper.dataset.fieldKey = field.key;
  wrapper.dataset.fieldType = field.type;
  wrapper.dataset.requirement = field.required ? "required" : field.recommended ? "recommended" : "optional";
  wrapper.dataset.validationState = field.invalid ? "invalid" : "valid";
  wrapper.dataset.valueState = field.valueState;
  wrapper.dataset.valueEmpty = isEmptyValue(field.value) ? "true" : "false";
  wrapper.dataset.controlState = field.disabled ? "disabled" : field.readOnly ? "read-only" : "editable";

  const controlId = `${formId}-${sectionId}-${field.key}`;
  const label = document.createElement("label");
  label.className = "standard-field-label";
  label.htmlFor = controlId;
  const labelText = document.createElement("span");
  labelText.textContent = field.unit ? `${field.label} (${field.unit})` : field.label;
  label.append(labelText);
  const badges = renderFieldBadges(field);
  if (badges) label.append(badges);
  wrapper.append(label);

  const control = renderControl(controlId, field);
  const describedBy = [];
  if (field.unit && !["checkbox", "select", "multi-select"].includes(field.type)) {
    const group = document.createElement("div");
    group.className = "standard-input-group standard-input-group-unit standard-definition-input-group";
    const unit = document.createElement("span");
    unit.className = "standard-input-addon";
    unit.textContent = field.unit;
    unit.setAttribute("aria-hidden", "true");
    group.append(control, unit);
    wrapper.append(group);
  } else {
    wrapper.append(control);
  }

  if (field.hint || (field.disabled && field.disabledReason)) {
    const hint = document.createElement("p");
    hint.id = `${controlId}-hint`;
    hint.className = "standard-field-hint";
    hint.textContent = field.disabled && field.disabledReason ? field.disabledReason : field.hint;
    wrapper.append(hint);
    describedBy.push(hint.id);
  }
  if (field.invalid) {
    const error = document.createElement("p");
    error.id = `${controlId}-error`;
    error.className = "standard-field-error";
    error.textContent = field.message || "Check this field.";
    error.setAttribute("role", "alert");
    wrapper.append(error);
    describedBy.push(error.id);
    control.setAttribute("aria-invalid", "true");
  }
  if (describedBy.length) control.setAttribute("aria-describedby", describedBy.join(" "));
  return wrapper;
}

function renderFieldBadges(field) {
  const items = [];
  if (field.required) items.push(["required", "Required"]);
  else if (field.recommended) items.push(["recommended", "Recommended"]);
  if (field.valueState === "calculated") items.push(["calculated", "Calculated"]);
  if (field.valueState === "suggested") items.push(["suggested", "Suggested"]);
  if (field.disabled) items.push(["disabled", "Unavailable"]);
  else if (field.readOnly && field.valueState !== "calculated") items.push(["read-only", "Read only"]);
  if (!items.length) return null;

  const badges = document.createElement("span");
  badges.className = "standard-field-badges";
  items.forEach(([state, text]) => {
    const badge = document.createElement("span");
    badge.className = "standard-field-badge";
    badge.dataset.fieldBadge = state;
    badge.textContent = text;
    badges.append(badge);
  });
  return badges;
}

function renderControl(id, field) {
  let control;
  if (field.type === "textarea") {
    control = document.createElement("textarea");
    control.rows = 2;
  } else if (field.type === "select" || field.type === "multi-select") {
    control = document.createElement("select");
    control.multiple = field.type === "multi-select";
    if (!control.multiple) {
      const prompt = document.createElement("option");
      prompt.value = "";
      prompt.textContent = field.placeholder || "Select";
      control.append(prompt);
    }
    field.options.forEach((option) => {
      const item = document.createElement("option");
      item.value = option;
      item.textContent = option;
      control.append(item);
    });
  } else {
    control = document.createElement("input");
    control.type = inputType(field.type);
  }

  control.id = id;
  control.name = field.key;
  control.required = field.required;
  control.disabled = field.disabled;
  if ("readOnly" in control) control.readOnly = field.readOnly;
  if (field.placeholder && !["select", "multi-select"].includes(field.type)) {
    control.placeholder = field.placeholder;
  }
  if (field.min !== null && "min" in control) control.min = String(field.min);
  if (field.max !== null && "max" in control) control.max = String(field.max);
  if (field.step !== null && "step" in control) control.step = String(field.step);
  applyControlValue(control, field);
  return control;
}

function applyControlValue(control, field) {
  if (field.type === "file" || field.defaultValue === null || field.defaultValue === undefined) return;
  if (field.type === "checkbox") {
    control.checked = String(field.value).toLowerCase() === "true" || field.value === 1;
    return;
  }
  if (field.type === "multi-select") {
    const selected = Array.isArray(field.value) ? new Set(field.value.map(String)) : new Set();
    [...control.options].forEach((option) => { option.selected = selected.has(option.value); });
    return;
  }
  control.value = String(field.value ?? "");
}

function renderSaveStatus(state, message) {
  const status = document.createElement("div");
  status.className = "standard-form-status";
  status.dataset.saveState = state;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const marker = document.createElement("span");
  marker.className = "standard-form-status-marker";
  marker.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = message || ({
    local: "Stored on this device",
    syncing: "Syncing changes",
    saved: "Saved"
  }[state] || "");
  status.append(marker, label);
  return status;
}

function inputType(type) {
  return {
    number: "number",
    currency: "number",
    calculation: "number",
    date: "date",
    time: "time",
    datetime: "datetime-local",
    email: "email",
    tel: "tel",
    file: "file",
    checkbox: "checkbox"
  }[type] || "text";
}

function rejectUnknownKeys(candidate, allowed, path, errors) {
  if (!isPlainObject(candidate)) {
    errors.push(`${path} must be an object`);
    return;
  }
  Object.keys(candidate).forEach((key) => {
    if (!allowed.has(key)) errors.push(`${path}.${key} is not supported`);
  });
}

function requiredIdentifier(value, path, pattern, errors) {
  const text = String(value || "").trim();
  if (!pattern.test(text)) errors.push(`${path} has an invalid identifier`);
  return text;
}

function requiredText(value, path, maximum, errors) {
  const text = String(value || "").trim();
  if (!text) errors.push(`${path} is required`);
  if (text.length > maximum) errors.push(`${path} must be ${maximum} characters or fewer`);
  return text;
}

function optionalText(value, maximum) {
  return String(value ?? "").trim().slice(0, maximum);
}

function optionalFiniteNumber(value, path, errors) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    errors.push(`${path} must be a finite number`);
    return null;
  }
  return number;
}

function normalizeDefaultValue(value) {
  if (value === undefined) return "";
  if (value === null || ["string", "number", "boolean"].includes(typeof value) || Array.isArray(value)) {
    return value;
  }
  return String(value);
}

function isEmptyValue(value) {
  return value === undefined
    || value === null
    || value === ""
    || (Array.isArray(value) && value.length === 0);
}

function rejectDuplicates(values, label, errors) {
  const seen = new Set();
  values.forEach((value) => {
    if (seen.has(value)) errors.push(`duplicate ${label}: ${value}`);
    seen.add(value);
  });
}

function emptyField() {
  return {
    key: "",
    label: "",
    type: "text",
    hint: "",
    placeholder: "",
    unit: "",
    options: [],
    defaultValue: "",
    required: false,
    recommended: false,
    readOnly: false,
    disabled: false,
    disabledReason: "",
    calculated: false,
    suggested: false,
    min: null,
    max: null,
    step: null
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export { SCHEMA_VERSION as FORM_DEFINITION_SCHEMA_VERSION };
