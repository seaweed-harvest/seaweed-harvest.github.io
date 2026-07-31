const canRegister = !globalThis.SeaweedNativeBundle
  && ["http:", "https:"].includes(window.location.protocol)
  && "serviceWorker" in navigator;

if (canRegister) {
  const upgradingExistingWorker = Boolean(navigator.serviceWorker.controller);
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!upgradingExistingWorker || reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js", {
        updateViaCache: "none"
      });
      await registration.update();
    } catch (error) {
      console.warn("Seaweed Harvest offline support could not be registered.", error);
    }
  }, { once: true });
}
