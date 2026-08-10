import { t } from "./language.js?v=20260810-beta-notice";

const PLATFORM_HOSTED = window.location.pathname === "/tide"
  || window.location.pathname.startsWith("/tide/");

if (PLATFORM_HOSTED) {
  // Under seaweed-harvest.com/tide, Tide shares the platform login/account shell
  // and the canonical Seaweed Harvest suggestion widget implementation.
  import("./platform_shell.js?v=1");
  import("/assets/js/site_feedback.js?v=8");
} else {
  // Keep the standalone/legacy Tide source runnable during migration.
  import("./site_feedback.js?v=2");
}

const DISCLAIMER_SESSION_KEY = "seaweedTidePlannerMarineDisclaimerAccepted";
const BETA_NOTICE_SESSION_KEY = "seaweedTidePlannerBetaNoticeAccepted";

document.addEventListener("DOMContentLoaded", () => {
  ensureBetaNoticeModal();
  ensureDisclaimerModal();
  bindFooterDisclaimerLinks();
  document.addEventListener("seaweed-language-change", refreshNoticeText);

  if (!hasAcceptedBetaThisSession()) {
    openBetaNotice();
  } else if (!hasAcceptedThisSession()) {
    openDisclaimer({ requireAcknowledgement: true });
  }
});

function ensureBetaNoticeModal() {
  if (document.getElementById("betaNoticeModal")) return;

  const modal = document.createElement("section");
  modal.id = "betaNoticeModal";
  modal.className = "marine-disclaimer-modal beta-notice-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "betaNoticeTitle");
  modal.setAttribute("hidden", "");
  modal.innerHTML = `
    <div class="marine-disclaimer-panel beta-notice-panel" role="document">
      <p class="eyebrow" data-beta-notice-eyebrow>${t("betaNotice.eyebrow")}</p>
      <h2 id="betaNoticeTitle">${t("betaNotice.title")}</h2>
      <div class="marine-disclaimer-copy" data-beta-notice-copy>
        ${t("betaNotice.body")}
      </div>
      <div class="marine-disclaimer-actions">
        <button type="button" id="betaNoticeAccept">${t("betaNotice.accept")}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector("#betaNoticeAccept").addEventListener("click", acknowledgeBetaNotice);
}

function ensureDisclaimerModal() {
  if (document.getElementById("marineDisclaimerModal")) return;

  const modal = document.createElement("section");
  modal.id = "marineDisclaimerModal";
  modal.className = "marine-disclaimer-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "marineDisclaimerTitle");
  modal.setAttribute("hidden", "");
  modal.innerHTML = `
    <div class="marine-disclaimer-panel" role="document">
      <p class="eyebrow" data-disclaimer-eyebrow>${t("disclaimer.eyebrow")}</p>
      <h2 id="marineDisclaimerTitle">${t("disclaimer.title")}</h2>
      <div class="marine-disclaimer-copy">
        ${t("disclaimer.body")}
      </div>
      <div class="marine-disclaimer-actions">
        <button type="button" id="marineDisclaimerAccept">${t("disclaimer.accept")}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector("#marineDisclaimerAccept").addEventListener("click", acknowledgeDisclaimer);
}

function refreshNoticeText() {
  const betaModal = document.getElementById("betaNoticeModal");
  if (betaModal) {
    const eyebrow = betaModal.querySelector("[data-beta-notice-eyebrow]");
    const title = betaModal.querySelector("#betaNoticeTitle");
    const copy = betaModal.querySelector("[data-beta-notice-copy]");
    const accept = betaModal.querySelector("#betaNoticeAccept");

    if (eyebrow) eyebrow.textContent = t("betaNotice.eyebrow");
    if (title) title.textContent = t("betaNotice.title");
    if (copy) copy.innerHTML = t("betaNotice.body");
    if (accept) accept.textContent = t("betaNotice.accept");
  }

  const modal = document.getElementById("marineDisclaimerModal");
  if (!modal) return;

  const eyebrow = modal.querySelector("[data-disclaimer-eyebrow]");
  const title = modal.querySelector("#marineDisclaimerTitle");
  const copy = modal.querySelector(".marine-disclaimer-copy");
  const accept = modal.querySelector("#marineDisclaimerAccept");

  if (eyebrow) eyebrow.textContent = t("disclaimer.eyebrow");
  if (title) title.textContent = t("disclaimer.title");
  if (copy) copy.innerHTML = t("disclaimer.body");
  if (accept) accept.textContent = t("disclaimer.accept");
}

function openBetaNotice() {
  const modal = document.getElementById("betaNoticeModal");
  const button = document.getElementById("betaNoticeAccept");
  if (!modal || !button) return;

  modal.hidden = false;
  document.body.classList.add("disclaimer-open");
  window.setTimeout(() => button.focus(), 0);
}

function bindFooterDisclaimerLinks() {
  document.querySelectorAll("[data-disclaimer-open]").forEach((button) => {
    button.addEventListener("click", () => openDisclaimer({ requireAcknowledgement: false }));
  });
}

function openDisclaimer() {
  const modal = document.getElementById("marineDisclaimerModal");
  const button = document.getElementById("marineDisclaimerAccept");
  if (!modal || !button) return;

  modal.hidden = false;
  document.body.classList.add("disclaimer-open");
  window.setTimeout(() => button.focus(), 0);
}

function acknowledgeDisclaimer() {
  try {
    window.sessionStorage.setItem(DISCLAIMER_SESSION_KEY, "true");
  } catch (error) {
    // If storage is unavailable, continue after the user has explicitly acknowledged this view.
  }

  const modal = document.getElementById("marineDisclaimerModal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("disclaimer-open");
}

function acknowledgeBetaNotice() {
  try {
    window.sessionStorage.setItem(BETA_NOTICE_SESSION_KEY, "true");
  } catch (error) {
    // If storage is unavailable, continue after acknowledgement in this view.
  }

  const modal = document.getElementById("betaNoticeModal");
  if (modal) modal.hidden = true;

  if (!hasAcceptedThisSession()) {
    openDisclaimer({ requireAcknowledgement: true });
    return;
  }

  document.body.classList.remove("disclaimer-open");
}

function hasAcceptedThisSession() {
  try {
    return window.sessionStorage.getItem(DISCLAIMER_SESSION_KEY) === "true";
  } catch (error) {
    return false;
  }
}

function hasAcceptedBetaThisSession() {
  try {
    return window.sessionStorage.getItem(BETA_NOTICE_SESSION_KEY) === "true";
  } catch (error) {
    return false;
  }
}
