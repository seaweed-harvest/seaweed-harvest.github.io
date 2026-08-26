import { APP_CONFIG } from "./config.js";
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
  },
  tide_activation: {
    title: "Set up your Tide Tool account",
    copy: "Continue to validate this private activation link and create your password.",
    button: "Continue account setup",
    destination: "./login.html?mode=invite"
  }
});

const els = {};
let flow = null;
let flowType = "";
let tokenHash = "";
let activationToken = "";
let returnPath = "";

document.addEventListener("DOMContentLoaded", init);

function init() {
  [
    "confirmationTitle", "confirmationCopy", "confirmationForm",
    "confirmationButton", "confirmationStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  const params = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  flowType = fragment.get("type") === "tide_activation"
    ? "tide_activation"
    : String(params.get("type") || "");
  flow = FLOW_COPY[params.get("type")] || FLOW_COPY[flowType] || null;
  returnPath = safeReturnPath(fragment.get("return") || params.get("return"));
  els.confirmationForm.addEventListener("submit", confirmLink);

  if (flowType === "tide_activation") {
    activationToken = String(fragment.get("token") || "").trim();
    if (!returnPath) returnPath = "tide/index.html";
    window.history.replaceState({}, "", "./auth_confirm.html?activation=1");
    if (!/^[A-Za-z0-9_-]{32,200}$/.test(activationToken)) {
      disableConfirmation("This activation link is invalid or incomplete. Ask the Tide administrator for a new link.");
      return;
    }
  } else {
    tokenHash = String(params.get("token_hash") || "").trim();
    if (!flow || tokenHash.length < 20 || tokenHash.length > 2048) {
      disableConfirmation("This secure link is invalid or incomplete. Request a new email.");
      return;
    }
  }

  if (!flow) {
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
  if (!flow) return;
  if (flowType === "tide_activation" && !activationToken) return;
  if (flowType !== "tide_activation" && !tokenHash) return;

  els.confirmationButton.disabled = true;
  setStatus("Verifying secure link...");
  try {
    let verificationToken = tokenHash;
    let verificationType = flowType;

    if (flowType === "tide_activation") {
      const exchange = await invokeTideActivation({
        action: "redeem_link",
        token: activationToken
      });
      verificationToken = String(exchange.token_hash || "").trim();
      verificationType = "invite";
      if (verificationToken.length < 20) {
        throw new Error("The activation service did not return a secure account token.");
      }
    }

    const { data, error } = await authClient.auth.verifyOtp({
      token_hash: verificationToken,
      type: verificationType
    });
    if (error) throw error;
    if (!data?.session) throw new Error("The secure link did not create an account session.");

    if (flowType === "tide_activation") {
      await invokeTideActivation({ action: "complete_link" }).catch(() => {});
    }

    tokenHash = "";
    activationToken = "";
    window.history.replaceState({}, "", "./auth_confirm.html?complete=1");
    setStatus("Verified. Opening your account...");
    const destination = returnPath && verificationType === "invite"
      ? `${flow.destination}&return=${encodeURIComponent(returnPath)}`
      : flow.destination;
    window.location.replace(destination);
  } catch (error) {
    if (error?.code === "already_active") {
      activationToken = "";
      setStatus("This Tide account is already active. Opening sign in...");
      window.location.replace(error.signInUrl || "./login.html?return=tide%2Findex.html");
      return;
    }

    els.confirmationButton.disabled = false;
    setStatus(
      flowType === "tide_activation"
        ? "This activation link is invalid, was replaced, or is no longer available. Ask the Tide administrator for a new link."
        : "This secure link has expired or has already been used. Request a new email.",
      "error"
    );
  }
}

async function invokeTideActivation(payload) {
  if (payload.action === "redeem_link") {
    const response = await fetch(`${APP_CONFIG.supabase.url}/functions/v1/tide-activation`, {
      method: "POST",
      headers: {
        apikey: APP_CONFIG.supabase.anonKey,
        Authorization: `Bearer ${APP_CONFIG.supabase.anonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const details = await response.json().catch(() => ({}));
    if (!response.ok || details?.error) {
      throw activationError(details, `Activation request failed (${response.status}).`);
    }
    return details;
  }

  const { data, error } = await authClient.functions.invoke("tide-activation", {
    body: payload
  });
  if (!error && !data?.error) return data || {};

  let details = data || {};
  try {
    details = await error?.context?.json() || details;
  } catch {
    // Keep the available response data when no JSON error body is available.
  }
  throw activationError(details, error?.message || "Activation request failed.");
}

function activationError(details, fallback) {
  const failure = new Error(details?.error || fallback);
  failure.code = details?.code || "";
  failure.signInUrl = details?.sign_in_url || "";
  return failure;
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
