const observed = new WeakSet();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

function init() {
  if (window.location.pathname.endsWith("/stabilization_packing.html")) {
    waitForElement("packingStockActions", setupPackingActionBridge);
  }
  if (window.location.pathname.endsWith("/records.html")) {
    waitForElement("stockActionLedgerStatus", setupLedgerLookupBridge);
  }
}

function setupPackingActionBridge(actionSelector) {
  if (observed.has(actionSelector)) return;
  observed.add(actionSelector);

  const clearButton = document.getElementById("clearPackingRecord");
  const status = document.getElementById("packingRecordStatus");

  clearButton?.addEventListener("click", () => {
    setTimeout(syncVisibleActionFromLegacy, 0);
  });

  if (status) {
    let previousText = status.textContent || "";
    const observer = new MutationObserver(() => {
      const text = status.textContent || "";
      if (text === previousText) return;
      previousText = text;
      if (status.dataset.status === "error" || !/\bsaved\./i.test(text)) return;
      setTimeout(syncVisibleActionFromLegacy, 0);
    });
    observer.observe(status, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
}

function syncVisibleActionFromLegacy() {
  const visibleRemoval = document.querySelector(
    '[name="packingStockAction"][value="remove"]:checked'
  );
  if (visibleRemoval) return;

  const legacy = document.querySelector('[name="packingRecordType"]:checked');
  const value = legacy?.value === "retest" ? "retest" : "initial";
  const visible = document.querySelector(
    `[name="packingStockAction"][value="${value}"]`
  );
  if (!visible || visible.checked) return;
  visible.checked = true;
  visible.dispatchEvent(new Event("change", { bubbles: true }));
}

function setupLedgerLookupBridge(status) {
  if (observed.has(status)) return;
  observed.add(status);

  let previousText = status.textContent || "";
  const observer = new MutationObserver(() => {
    const text = status.textContent || "";
    if (text === previousText) return;
    previousText = text;
    if (!/restored to active stock/i.test(text)) return;
    document.dispatchEvent(new CustomEvent("stabilization-stock-restored"));
  });
  observer.observe(status, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function waitForElement(id, callback) {
  const existing = document.getElementById(id);
  if (existing) {
    callback(existing);
    return;
  }

  const observer = new MutationObserver(() => {
    const element = document.getElementById(id);
    if (!element) return;
    observer.disconnect();
    callback(element);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}
