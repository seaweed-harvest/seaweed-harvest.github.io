const SERVICE_WORKER_URL = "./service-worker.js";

export function registerPwa() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(SERVICE_WORKER_URL)
      .then((registration) => registration.update())
      .catch((error) => {
        console.warn("Service worker registration failed.", error);
      });
  });
}

registerPwa();
