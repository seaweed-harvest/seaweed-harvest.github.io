const canRegister = !globalThis.SeaweedNativeBundle
  && ["http:", "https:"].includes(window.location.protocol)
  && "serviceWorker" in navigator;

if (canRegister) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Seaweed Harvest offline support could not be registered.", error);
    });
  }, { once: true });
}
