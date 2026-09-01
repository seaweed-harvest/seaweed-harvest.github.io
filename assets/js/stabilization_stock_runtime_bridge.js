const observed = new WeakSet();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

function init() {
  if (window.location.pathname.endsWith("/stabilization_packing.html")) {
    installPackingStockActionStyles();
    waitForElement("packingStockActions", setupPackingActionBridge);
  }
  if (window.location.pathname.endsWith("/records.html")) {
    waitForElement("stockActionLedgerStatus", setupLedgerLookupBridge);
  }
}

function installPackingStockActionStyles() {
  if (document.getElementById("packingStockActionTabStyles")) return;
  const style = document.createElement("style");
  style.id = "packingStockActionTabStyles";
  style.textContent = `
    body.form-record-page #packingStockActions .standard-segmented-control {
      width: fit-content;
      max-width: 100%;
      grid-template-columns: repeat(var(--packing-stock-action-columns, 3), minmax(130px, 1fr));
    }
    body.form-record-page #packingStockActions .standard-segmented-control label {
      display: block;
      color: var(--text-sec);
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: none;
      cursor: pointer;
    }
    body.form-record-page #packingStockActions .standard-segmented-control input {
      position: absolute;
      width: 1px;
      height: 1px;
      min-width: 1px;
      min-height: 1px;
      padding: 0;
      border: 0;
      margin: 0;
      opacity: 0;
      pointer-events: none;
    }
    @media (max-width: 640px) {
      body.form-record-page #packingStockActions .standard-segmented-control {
        width: 100%;
        grid-template-columns: repeat(var(--packing-stock-action-columns, 3), minmax(0, 1fr));
      }
    }
  `;
  document.head.append(style);
}

function setupPackingActionBridge(actionSelector) {
  if (observed.has(actionSelector)) return;
  observed.add(actionSelector);

  const entryTabs = document.getElementById("packingEntryTabs");
  const clearButton = document.getElementById("clearPackingRecord");
  const status = document.getElementById("packingRecordStatus");
  const retestLabel = actionSelector.querySelector("#packingRetestActionLabel");

  entryTabs?.addEventListener("click", syncEntryTabBeforeHandlers, true);

  const syncColumns = () => {
    actionSelector.style.setProperty(
      "--packing-stock-action-columns",
      retestLabel?.hidden ? "2" : "3"
    );
  };
  syncColumns();

  if (retestLabel) {
    const observer = new MutationObserver(syncColumns);
    observer.observe(retestLabel, {
      attributes: true,
      attributeFilter: ["hidden"]
    });
  }

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

function syncEntryTabBeforeHandlers(event) {
  const button = event.target?.closest?.("[data-packing-entry-tab]");
  if (!button) return;
  const selected = button.dataset.packingEntryTab;
  button.parentElement?.querySelectorAll("[data-packing-entry-tab]").forEach((tab) => {
    const active = tab.dataset.packingEntryTab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
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