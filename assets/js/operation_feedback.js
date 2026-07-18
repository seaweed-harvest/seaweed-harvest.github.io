export function createOperationFeedback(root) {
  if (!root) throw new Error("Operation feedback panel is missing.");

  const title = root.querySelector("[data-operation-title]");
  const message = root.querySelector("[data-operation-message]");
  const action = root.querySelector("[data-operation-action]");
  let actionHandler = null;

  action.addEventListener("click", () => {
    const handler = actionHandler;
    actionHandler = null;
    if (handler) handler();
    else hide();
  });

  function show(options = {}) {
    root.dataset.state = options.state || "progress";
    root.setAttribute("aria-busy", String(root.dataset.state === "progress"));
    title.textContent = options.title || "Working...";
    message.textContent = options.message || "";
    actionHandler = typeof options.onAction === "function" ? options.onAction : null;
    action.textContent = options.actionLabel || "Done";
    action.hidden = !options.actionLabel;
    root.hidden = false;
  }

  function update(options = {}) {
    if (options.title !== undefined) title.textContent = options.title;
    if (options.message !== undefined) message.textContent = options.message;
  }

  function hide() {
    root.hidden = true;
    root.removeAttribute("data-state");
    root.setAttribute("aria-busy", "false");
    action.hidden = true;
    actionHandler = null;
  }

  return { hide, show, update };
}
