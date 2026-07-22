import {
  authClient,
  currentProfile,
  recordLogin,
  routeForProfile,
  signInWithPassword
} from "./auth_client.js?v=19";

const els = {};
let resetToken = "";

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => showReadyError(error.message || "This password reset link could not be opened."));
});

async function init() {
  ["adminResetForm", "adminResetPassword", "adminResetConfirm", "adminResetSubmit", "adminResetStatus", "adminResetAccount", "adminResetAccountName"]
    .forEach((id) => { els[id] = document.getElementById(id); });
  els.adminResetForm.addEventListener("submit", resetPassword);

  resetToken = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";

  // A reset link must never operate inside a session belonging to another person.
  const { error: signOutError } = await authClient.auth.signOut({ scope: "local" });
  if (signOutError && !String(signOutError.message || "").toLowerCase().includes("session missing")) {
    throw signOutError;
  }

  if (!resetToken) throw new Error("This password reset link is incomplete.");
  const inspection = await invokeResetFunction({ action: "inspect", token: resetToken });
  if (!inspection.valid) {
    throw new Error("This password reset link is invalid, expired or already used. Ask an administrator for a new link.");
  }

  els.adminResetAccountName.textContent = inspection.display_name || "Your account";
  els.adminResetAccount.hidden = false;

  document.body.removeAttribute("data-auth-pending");
  setStatus("Enter a new password with at least 10 characters, including letters and numbers.");
  els.adminResetPassword.focus();
}

async function resetPassword(event) {
  event.preventDefault();
  const password = els.adminResetPassword.value;
  if (password !== els.adminResetConfirm.value) {
    setStatus("Passwords do not match.", "error");
    els.adminResetConfirm.focus();
    return;
  }
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    setStatus("Use at least 10 characters with letters and numbers.", "error");
    els.adminResetPassword.focus();
    return;
  }

  els.adminResetSubmit.disabled = true;
  setStatus("Saving password...");
  try {
    const result = await invokeResetFunction({ action: "reset", token: resetToken, password });
    resetToken = "";
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    await signInWithPassword(result.identifier, password);
    await recordLogin("administrator_reset_link").catch(() => {});
    const profile = await currentProfile(true);
    setStatus("Password saved. Signing you in...");
    window.location.replace(routeForProfile(profile));
  } catch (error) {
    els.adminResetSubmit.disabled = false;
    setStatus(error.message || "Password could not be changed.", "error");
  }
}

async function invokeResetFunction(body) {
  const { data, error } = await authClient.functions.invoke("password-reset-link", { body });
  if (error) {
    let message = error.message;
    try {
      const response = await error.context?.json();
      message = response?.error || message;
    } catch {
      // Use the client error if the server did not return JSON.
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function showReadyError(message) {
  document.body.removeAttribute("data-auth-pending");
  if (els.adminResetForm) {
    els.adminResetForm.querySelectorAll("input,button").forEach((control) => { control.disabled = true; });
  }
  setStatus(message, "error");
}

function setStatus(message, type = "") {
  if (!els.adminResetStatus) return;
  els.adminResetStatus.textContent = message || "";
  els.adminResetStatus.dataset.status = type;
}
