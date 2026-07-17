const SPLASH_IMAGE = "./assets/images/seaweed-harvest-splash.gif";
const LAUNCH_SESSION_KEY = "seaweed-harvest:launch-splash-shown";
const REDUCED_MOTION = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

export async function completeLaunchSplash() {
  const root = document.documentElement;
  if (!root.classList.contains("app-launch-pending")) return;

  const startedAt = Number(globalThis.__seaweedHarvestLaunchStartedAt || performance.now());
  const minimumVisibleMs = REDUCED_MOTION ? 0 : 1700;
  await wait(Math.max(0, minimumVisibleMs - (performance.now() - startedAt)));

  const overlay = document.getElementById("appLaunchSplash");
  overlay?.classList.add("is-leaving");
  await wait(REDUCED_MOTION ? 0 : 320);
  root.classList.remove("app-launch-pending");
  overlay?.remove();
}

export async function transitionTo(destination) {
  const overlay = ensureTransitionOverlay();
  const image = overlay.querySelector("img");

  try {
    sessionStorage.setItem(LAUNCH_SESSION_KEY, "1");
  } catch {
    // Session storage can be unavailable in privacy-restricted browsers.
  }

  document.body.classList.add("brand-transition-active");
  overlay.hidden = false;
  restartAnimation(image);
  requestAnimationFrame(() => overlay.classList.add("is-visible"));

  await wait(REDUCED_MOTION ? 80 : 1750);
  overlay.classList.add("is-leaving");
  await wait(REDUCED_MOTION ? 0 : 320);
  window.location.replace(destination);
}

function ensureTransitionOverlay() {
  const existing = document.getElementById("authSuccessTransition");
  if (existing) return existing;

  const overlay = document.createElement("div");
  overlay.id = "authSuccessTransition";
  overlay.className = "brand-transition";
  overlay.hidden = true;
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-label", "Opening Seaweed Harvest");
  overlay.innerHTML = `<img src="${SPLASH_IMAGE}" alt="">`;
  document.body.append(overlay);
  return overlay;
}

function restartAnimation(image) {
  if (!image || REDUCED_MOTION) return;
  image.src = "";
  requestAnimationFrame(() => {
    image.src = `${SPLASH_IMAGE}?play=${Date.now()}`;
  });
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

