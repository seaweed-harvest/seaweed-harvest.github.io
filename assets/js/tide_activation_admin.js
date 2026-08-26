import { authClient } from "./auth_client.js?v=25";

const BUTTON_SELECTOR = "[data-copy-tide-activation-link]";
let rows = null;
let status = null;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

function init() {
  rows = document.getElementById("applicationTesterRows");
  status = document.getElementById("applicationTesterStatus");
  if (!rows || !status) return;

  rows.addEventListener("click", handleClick);
  const observer = new MutationObserver(decoratePendingTesterRows);
  observer.observe(rows, { childList: true, subtree: true });
  decoratePendingTesterRows();
}

function decoratePendingTesterRows() {
  rows.querySelectorAll("[data-application-tester]").forEach((row) => {
    const testerStatus = row.querySelector(".application-tester-status")?.dataset.status || "";
    const actions = row.querySelector(".row-actions");
    const existing = row.querySelector(BUTTON_SELECTOR);

    if (testerStatus !== "invitation_sent" || !actions) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.copyTideActivationLink = "";
    button.textContent = "Copy activation link";
    button.title = "Creates and copies a new activation link. Any earlier activation link for this tester is replaced.";
    actions.prepend(button);
  });
}

async function handleClick(event) {
  const button = event.target.closest(BUTTON_SELECTOR);
  if (!button) return;

  const row = button.closest("[data-application-tester]");
  const accessId = String(row?.dataset.applicationTester || "").trim();
  if (!accessId) return;

  button.disabled = true;
  setStatus("Creating a new activation link...");
  try {
    const result = await invokeTideActivation({
      action: "create_link",
      app_key: "tide",
      access_id: accessId
    });
    const activationUrl = String(result.activation_url || "").trim();
    if (!activationUrl) throw new Error("The activation service did not return a link.");

    const copied = await copyText(activationUrl);
    if (copied) {
      setStatus("New activation link copied. Any previous activation link for this tester has been replaced.");
    } else {
      window.prompt("Copy this activation link", activationUrl);
      setStatus("A new activation link was created. Copy it from the open prompt; any previous link was replaced.");
    }
  } catch (error) {
    setStatus(error.message || "The activation link could not be created.", "error");
  } finally {
    button.disabled = false;
  }
}

async function invokeTideActivation(payload) {
  const { data, error } = await authClient.functions.invoke("tide-activation", {
    body: payload
  });
  if (!error && !data?.error) return data || {};

  let message = data?.error || error?.message || "Activation-link request failed.";
  try {
    const details = await error?.context?.json();
    message = details?.error || message;
  } catch {
    // Keep the available client error when the response body is unavailable.
  }
  throw new Error(message);
}

async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall back to a temporary selection for browsers that deny Clipboard API access.
    }
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.focus();
  input.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  input.remove();
  return copied;
}

function setStatus(message, state = "") {
  status.textContent = message;
  if (state) status.dataset.status = state;
  else delete status.dataset.status;
}
