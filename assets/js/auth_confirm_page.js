import { authClient } from "./auth_client.js?v=22";

const FLOW_COPY = Object.freeze({
  invite: {
    title: "Set up your account",
    copy: "Continue to verify your invitation and create your password.",
    button: "Continue account setup",
    destination: "./login.html?mode=invite"
  },
  recovery: {
    title: "Reset your password",
    copy: "Continue to verify your password reset request.",
    button: "Continue password reset",
    destination: "./login.html?mode=recovery"
  }
});

const els = {};
let flow = null;
let tokenHash = "";
let returnPath = "";

document.addEventListener("DOMContentLoaded", init);

function init() {
  [
    "confirmationTitle", "confirmationCopy", "confirmationForm",
    "confirmationButton", "confirmationStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  const params = new URLSearchParams(window.location.search);
  flow = FLOW_COPY[params.get("type")] || null;
  tokenHash = String(params.get("token_hash") || "").trim();
  returnPath = safeReturnPath(params.get("return"));
  els.confirmationForm.addEventListener("submit", confirmLink);

  if (!flow || tokenHash.length < 20 || tokenHash.length > 2048) {
    disableConfirmation("This secure link is invalid or incomplete. Request a new email.");
    return;
  }
  if (!navigator.onLine) {
    disableConfirmation("Internet connection required. Reconnect and open this link again.");
    return;
  }

  els.confirmationTitle.textContent = flow.title;
  els.confirmationCopy.textContent = flow.copy;
  els.confirmationButton.textContent = flow.button;
}

async function confirmLink(event) {
  event.preventDefault();
  if (!flow || !tokenHash) return;

  els.confirmationButton.disabled = true;
  setStatus("Verifying secure link...");
  try {
    const type = new URLSearchParams(window.location.search).get("type");
    const { data, error } = await authClient.auth.verifyOtp({
      token_hash: tokenHash,
      type
    });
    if (error) throw error;
    if (!data?.session) throw new Error("The secure link did not create an account session.");

    tokenHash = "";
    window.history.replaceState({}, "", "./auth_confirm.html?complete=1");
    setStatus("Verified. Opening your account...");
    const destination = returnPath && type === "invite"
      ? `${flow.destination}&return=${encodeURIComponent(returnPath)}`
      : flow.destination;
    window.location.replace(destination);
  } catch {
    els.confirmationButton.disabled = false;
    setStatus("This secure link has expired or has already been used. Request a new email.", "error");
  }
}

function safeReturnPath(value) {
  const path = String(value || "").replace(/^\.\//, "");
  return /^tide\/[a-z0-9_.-]+$/i.test(path) ? path : "";
}

function disableConfirmation(message) {
  els.confirmationButton.disabled = true;
  setStatus(message, "error");
}

function setStatus(message, status = "") {
  els.confirmationStatus.textContent = message;
  if (status) els.confirmationStatus.dataset.status = status;
  else delete els.confirmationStatus.dataset.status;
}
