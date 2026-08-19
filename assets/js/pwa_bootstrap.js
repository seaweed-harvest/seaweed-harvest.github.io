const canRegister = !globalThis.SeaweedNativeBundle
  && ["http:", "https:"].includes(window.location.protocol)
  && "serviceWorker" in navigator;

if (window.location.pathname.endsWith("/reef_nursery.html")) {
  const parameters = new URLSearchParams(window.location.search);
  if (parameters.get("share") && parameters.get("org")) {
    import("./reef_review_matrix_collaboration.js?v=1").catch((error) => {
      console.warn("Reef review matrix collaboration could not be loaded.", error);
    });
  }
}

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
