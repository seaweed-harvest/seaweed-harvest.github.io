export function installSuggestedInput(input) {
  if (!input || input.dataset.suggestedInputReady === "true") return null;
  let internalChange = false;

  const isSuggested = () => input.dataset.suggestedValue === "true";
  const clearSuggestedState = () => {
    input.dataset.suggestedValue = "false";
    input.classList.remove("suggested-value-control");
  };
  const replaceValue = (value) => {
    internalChange = true;
    input.value = value;
    clearSuggestedState();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    internalChange = false;
  };

  input.addEventListener("beforeinput", (event) => {
    if (!isSuggested()) return;
    const typing = event.inputType?.startsWith("insert");
    const deleting = event.inputType?.startsWith("delete");
    if (!typing && !deleting) return;
    event.preventDefault();
    replaceValue(typing ? String(event.data || "") : "");
  });
  input.addEventListener("keydown", (event) => {
    if (!isSuggested() || event.ctrlKey || event.metaKey || event.altKey) return;
    const printable = event.key.length === 1;
    const deleting = event.key === "Backspace" || event.key === "Delete";
    if (!printable && !deleting) return;
    event.preventDefault();
    replaceValue(printable ? event.key : "");
  });
  input.addEventListener("input", () => {
    if (!internalChange) clearSuggestedState();
  });

  input.dataset.suggestedInputReady = "true";
  return {
    set(value) {
      internalChange = true;
      input.value = value ?? "";
      input.dataset.suggestedValue = input.value ? "true" : "false";
      input.classList.toggle("suggested-value-control", Boolean(input.value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      internalChange = false;
    },
    clear() {
      clearSuggestedState();
    },
    get suggested() {
      return isSuggested();
    }
  };
}
