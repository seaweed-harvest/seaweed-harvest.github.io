const FIELD_ID = "sackIdField";
const INPUT_ID = "sackId";

function restoreSackIdField() {
  const field = document.getElementById(FIELD_ID);
  const input = document.getElementById(INPUT_ID);
  if (!field || !input) return;

  if (field.hidden) field.hidden = false;
  if (input.disabled) input.disabled = false;
  if (input.required) input.required = false;
}

function initialiseSackIdField() {
  const field = document.getElementById(FIELD_ID);
  const input = document.getElementById(INPUT_ID);
  if (!field || !input) return;

  restoreSackIdField();

  const observer = new MutationObserver(restoreSackIdField);
  observer.observe(field, {
    attributes: true,
    attributeFilter: ["hidden"]
  });
  observer.observe(input, {
    attributes: true,
    attributeFilter: ["disabled", "required"]
  });

  document.addEventListener("seaweed-collection-language-change", restoreSackIdField);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialiseSackIdField, { once: true });
} else {
  initialiseSackIdField();
}
