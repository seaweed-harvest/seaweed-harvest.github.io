import {
  authClient,
  currentProfile,
  currentSession,
  enabledSocialProviders,
  routeForProfile,
  sendPasswordReset,
  signInWithPassword,
  signInWithProvider,
  updatePassword
} from "./auth_client.js";

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "loginPanel", "loginForm", "loginEmail", "loginPassword", "socialLoginActions",
    "googleSignIn", "facebookSignIn", "showResetPassword", "passwordPanel",
    "passwordForm", "newPassword", "confirmPassword", "resetPanel", "resetForm",
    "resetEmail", "cancelResetPassword", "authStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  bindEvents();
  await configureSocialButtons();

  const mode = new URLSearchParams(window.location.search).get("mode");
  const session = await currentSession();
  if ((mode === "invite" || mode === "recovery" || mode === "change") && session) {
    showPanel("password");
    setStatus(mode === "change" || requiresPasswordChange(session)
      ? "Set a new password before continuing."
      : "Set your password to finish signing in.");
    return;
  }

  if (requiresPasswordChange(session)) {
    showPanel("password");
    setStatus("Set a new password before continuing.");
    return;
  }

  if (session) await routeSignedInUser();
  showQueryMessage();

  authClient.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") showPanel("password");
  });
}

function bindEvents() {
  els.loginForm.addEventListener("submit", handleLogin);
  els.passwordForm.addEventListener("submit", handlePasswordUpdate);
  els.resetForm.addEventListener("submit", handleReset);
  els.showResetPassword.addEventListener("click", () => showPanel("reset"));
  els.cancelResetPassword.addEventListener("click", () => showPanel("login"));
  els.googleSignIn.addEventListener("click", () => socialSignIn("google"));
  els.facebookSignIn.addEventListener("click", () => socialSignIn("facebook"));
}

async function handleLogin(event) {
  event.preventDefault();
  setStatus("Signing in...");
  try {
    const result = await signInWithPassword(els.loginEmail.value.trim(), els.loginPassword.value);
    if (requiresPasswordChange(result)) {
      els.loginPassword.value = "";
      showPanel("password");
      setStatus("Temporary password accepted. Set a new password before continuing.");
      return;
    }
    await routeSignedInUser();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handlePasswordUpdate(event) {
  event.preventDefault();
  if (els.newPassword.value !== els.confirmPassword.value) {
    setStatus("Passwords do not match.", "error");
    return;
  }
  setStatus("Saving password...");
  try {
    await updatePassword(els.newPassword.value);
    setStatus("Password saved.");
    await routeSignedInUser();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleReset(event) {
  event.preventDefault();
  setStatus("Sending reset email...");
  try {
    await sendPasswordReset(els.resetEmail.value.trim());
    setStatus("If the account exists, a reset link will be sent by the configured email service.");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function socialSignIn(provider) {
  setStatus(`Opening ${provider}...`);
  try {
    await signInWithProvider(provider);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function routeSignedInUser() {
  const profile = await currentProfile(true);
  const requested = new URLSearchParams(window.location.search).get("return");
  const canUseRequestedPage = profile?.app_role === "system_admin" || profile?.can_access_admin;
  const destination = requested && canUseRequestedPage ? `./${safePage(requested)}` : routeForProfile(profile);
  window.location.replace(destination);
}

async function configureSocialButtons() {
  const { google, facebook } = await enabledSocialProviders();
  els.googleSignIn.hidden = !google;
  els.facebookSignIn.hidden = !facebook;
  els.socialLoginActions.hidden = !(google || facebook);
}

function showPanel(panel) {
  els.loginPanel.hidden = panel !== "login";
  els.passwordPanel.hidden = panel !== "password";
  els.resetPanel.hidden = panel !== "reset";
  setStatus("");
}

function showQueryMessage() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("error")) setStatus(params.get("error"), "error");
  if (params.get("mode") === "invite") setStatus("Open the newest invite link, then set your password.");
}

function safePage(value) {
  const file = String(value || "").replace(/^\.\//, "");
  return /^[a-z0-9_.?=&%-]+$/i.test(file) ? file : "admin.html";
}

function requiresPasswordChange(value) {
  const user = value?.user || value?.session?.user || null;
  return Boolean(user?.user_metadata?.must_change_password);
}

function setStatus(message, type = "") {
  els.authStatus.textContent = message || "";
  els.authStatus.dataset.status = type;
}
