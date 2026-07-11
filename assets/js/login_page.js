import {
  authClient,
  currentProfile,
  currentSession,
  enabledSocialProviders,
  routeForProfile,
  sendPasswordReset,
  signOut,
  signInWithPassword,
  signInWithProvider,
  updateMyDisplayName,
  updatePassword
} from "./auth_client.js";

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  [
    "loginPanel", "loginForm", "loginEmail", "loginPassword", "socialLoginActions",
    "googleSignIn", "facebookSignIn", "showResetPassword", "passwordPanel",
    "passwordPanelTitle", "passwordForm", "accountDisplayName", "newPassword", "confirmPassword",
    "cancelPasswordUpdate", "resetPanel", "resetForm",
    "resetEmail", "cancelResetPassword", "authStatus"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  bindEvents();
  await configureSocialButtons();

  const mode = new URLSearchParams(window.location.search).get("mode");
  const session = await currentSession();
  if ((mode === "invite" || mode === "recovery" || mode === "change") && session) {
    await preparePasswordPanel(session, passwordModeTitle(mode), mode === "invite"
      ? "Create your password to finish setting up the account."
      : "Enter and confirm your new password.");
    return;
  }

  if (requiresPasswordChange(session)) {
    const email = session.user.email || "";
    await signOut();
    els.loginEmail.value = email;
    showPanel("login");
    setStatus("Sign in with your temporary password to continue.");
    return;
  }

  if (session) await routeSignedInUser();
  showQueryMessage();

  authClient.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      currentSession().then((activeSession) => {
        if (activeSession) preparePasswordPanel(activeSession, "Reset Password", "Enter and confirm your new password.");
      });
    }
  });
}

function bindEvents() {
  els.loginForm.addEventListener("submit", handleLogin);
  els.passwordForm.addEventListener("submit", handlePasswordUpdate);
  els.resetForm.addEventListener("submit", handleReset);
  els.showResetPassword.addEventListener("click", () => showPanel("reset"));
  els.cancelResetPassword.addEventListener("click", () => showPanel("login"));
  els.cancelPasswordUpdate.addEventListener("click", () => showPanel("login"));
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
      await preparePasswordPanel(
        result.session,
        "Change Password",
        "Temporary password accepted. Confirm your name and choose a new password."
      );
      return;
    }
    await routeSignedInUser();
  } catch (error) {
    setStatus(signInErrorMessage(error), "error");
  }
}

async function handlePasswordUpdate(event) {
  event.preventDefault();
  if (els.newPassword.value !== els.confirmPassword.value) {
    setStatus("Passwords do not match.", "error");
    return;
  }
  const displayName = els.accountDisplayName.value.trim();
  if (displayName.length < 2) {
    setStatus("Enter your name before continuing.", "error");
    els.accountDisplayName.focus();
    return;
  }
  setStatus("Saving password...");
  try {
    await updateMyDisplayName(displayName);
    await updatePassword(els.newPassword.value, displayName);
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

function passwordModeTitle(mode) {
  if (mode === "invite") return "Create Password";
  if (mode === "recovery") return "Reset Password";
  return "Change Password";
}

function signInErrorMessage(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("invalid login credentials") || message.includes("invalid email or password")) {
    return "Email or password is incorrect.";
  }
  if (message.includes("email not confirmed")) return "Confirm your email before signing in.";
  if (message.includes("rate limit") || message.includes("too many")) {
    return "Too many sign-in attempts. Wait a moment and try again.";
  }
  return "Unable to sign in. Check your details and try again.";
}

function safePage(value) {
  const file = String(value || "").replace(/^\.\//, "");
  return /^[a-z0-9_.?=&%-]+$/i.test(file) ? file : "admin.html";
}

function requiresPasswordChange(value) {
  const user = value?.user || value?.session?.user || null;
  return Boolean(user?.user_metadata?.must_change_password);
}

async function preparePasswordPanel(session, title, message) {
  showPanel("password");
  els.passwordPanelTitle.textContent = title;
  let profile = null;
  try {
    profile = await currentProfile(true);
  } catch {
    // The metadata name remains available if the profile request is unavailable.
  }
  els.accountDisplayName.value = profile?.display_name
    || session?.user?.user_metadata?.full_name
    || "";
  setStatus(els.accountDisplayName.value ? message : `${message} Your name is also required.`);
}

function setStatus(message, type = "") {
  els.authStatus.textContent = message || "";
  els.authStatus.dataset.status = type;
}
