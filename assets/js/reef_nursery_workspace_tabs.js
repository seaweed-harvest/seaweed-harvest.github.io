const TRAINING_TAB_NAMES = new Set([
  "session",
  "participants",
  "training",
  "competency",
  "inspection",
  "photos",
  "records"
]);

function selectedTrainingTab(secondaryTabs) {
  const selected = secondaryTabs.querySelector('[data-reef-tab][aria-selected="true"]');
  return selected && TRAINING_TAB_NAMES.has(selected.dataset.reefTab)
    ? selected.dataset.reefTab
    : null;
}

function visibleTrainingTabs(secondaryTabs) {
  return [...secondaryTabs.querySelectorAll("[data-reef-tab]")]
    .filter((tab) => TRAINING_TAB_NAMES.has(tab.dataset.reefTab) && !tab.hidden && !tab.disabled);
}

function initWorkspaceTabs() {
  const workspace = document.getElementById("reefTrainingWorkspace");
  const secondaryTabs = document.getElementById("reefNurseryTabs");
  const sourceSeaweedTab = document.getElementById("reefSeaweedTab");
  if (!workspace || !secondaryTabs || !sourceSeaweedTab || document.getElementById("reefWorkspaceTabs")) return;

  let lastTrainingTab = selectedTrainingTab(secondaryTabs) || "session";

  const workspaceTabs = document.createElement("nav");
  workspaceTabs.id = "reefWorkspaceTabs";
  workspaceTabs.className = "reef-workspace-tabs standard-tabs";
  workspaceTabs.setAttribute("aria-label", "Reef nursery workspace");
  workspaceTabs.setAttribute("role", "tablist");

  const trainingWorkspaceTab = document.createElement("button");
  trainingWorkspaceTab.id = "reefNurseryTrainingWorkspaceTab";
  trainingWorkspaceTab.className = "standard-tab reef-workspace-tab";
  trainingWorkspaceTab.type = "button";
  trainingWorkspaceTab.setAttribute("role", "tab");
  trainingWorkspaceTab.setAttribute("aria-selected", "true");
  trainingWorkspaceTab.setAttribute("aria-controls", "reefNurseryTabs");
  trainingWorkspaceTab.textContent = "Nursery Training";

  const seaweedWorkspaceTab = document.createElement("button");
  seaweedWorkspaceTab.id = "reefSeaweedWorkspaceTab";
  seaweedWorkspaceTab.className = "standard-tab reef-workspace-tab";
  seaweedWorkspaceTab.type = "button";
  seaweedWorkspaceTab.setAttribute("role", "tab");
  seaweedWorkspaceTab.setAttribute("aria-selected", "false");
  seaweedWorkspaceTab.setAttribute("aria-controls", "reefSeaweedPanel");
  seaweedWorkspaceTab.textContent = "Seaweed Data Collection";
  seaweedWorkspaceTab.tabIndex = -1;

  workspaceTabs.append(trainingWorkspaceTab, seaweedWorkspaceTab);
  workspace.insertBefore(workspaceTabs, secondaryTabs);
  sourceSeaweedTab.classList.add("reef-workspace-source-tab");

  const style = document.createElement("style");
  style.id = "reefWorkspaceTabsStyle";
  style.textContent = `
    .reef-workspace-tabs {
      margin-bottom: 0.6rem;
    }
    .reef-workspace-tabs .reef-workspace-tab {
      font-weight: 700;
    }
    #reefNurseryTabs .reef-workspace-source-tab {
      display: none !important;
    }
    #reefNurseryTabs[hidden] {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  function setWorkspace(mode) {
    const seaweedActive = mode === "seaweed";
    trainingWorkspaceTab.setAttribute("aria-selected", String(!seaweedActive));
    trainingWorkspaceTab.tabIndex = seaweedActive ? -1 : 0;
    seaweedWorkspaceTab.setAttribute("aria-selected", String(seaweedActive));
    seaweedWorkspaceTab.tabIndex = seaweedActive ? 0 : -1;
    secondaryTabs.hidden = seaweedActive;
  }

  function activateTrainingWorkspace() {
    const target = secondaryTabs.querySelector(`[data-reef-tab="${lastTrainingTab}"]`)
      || secondaryTabs.querySelector('[data-reef-tab="session"]');
    if (target) target.click();
    setWorkspace("training");
  }

  function activateSeaweedWorkspace() {
    if (sourceSeaweedTab.hidden || sourceSeaweedTab.disabled) return;
    sourceSeaweedTab.click();
    setWorkspace("seaweed");
  }

  function syncSourceAvailability() {
    const unavailable = sourceSeaweedTab.hidden || sourceSeaweedTab.disabled;
    seaweedWorkspaceTab.hidden = unavailable;
    seaweedWorkspaceTab.disabled = unavailable;
    if (unavailable && seaweedWorkspaceTab.getAttribute("aria-selected") === "true") {
      activateTrainingWorkspace();
    }
  }

  trainingWorkspaceTab.addEventListener("click", activateTrainingWorkspace);
  seaweedWorkspaceTab.addEventListener("click", activateSeaweedWorkspace);

  secondaryTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-reef-tab]");
    if (!tab || !TRAINING_TAB_NAMES.has(tab.dataset.reefTab)) return;
    lastTrainingTab = tab.dataset.reefTab;
    setWorkspace("training");
  });

  secondaryTabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = visibleTrainingTabs(secondaryTabs);
    const current = event.target.closest("[data-reef-tab]");
    const index = tabs.indexOf(current);
    if (index < 0 || !tabs.length) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    let next = index;
    if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    tabs[next].focus();
    tabs[next].click();
  }, true);

  workspaceTabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [trainingWorkspaceTab, seaweedWorkspaceTab].filter((tab) => !tab.hidden && !tab.disabled);
    const current = tabs.indexOf(event.target.closest(".reef-workspace-tab"));
    if (current < 0 || !tabs.length) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    let next = current;
    if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    tabs[next].focus();
    tabs[next].click();
  }, true);

  const observer = new MutationObserver(() => {
    syncSourceAvailability();
    if (sourceSeaweedTab.getAttribute("aria-selected") === "true" && !sourceSeaweedTab.hidden) {
      setWorkspace("seaweed");
      return;
    }
    const selected = selectedTrainingTab(secondaryTabs);
    if (selected) {
      lastTrainingTab = selected;
      setWorkspace("training");
    }
  });

  [sourceSeaweedTab, ...visibleTrainingTabs(secondaryTabs)].forEach((tab) => {
    observer.observe(tab, {
      attributes: true,
      attributeFilter: ["aria-selected", "hidden", "disabled"]
    });
  });

  syncSourceAvailability();
  if (sourceSeaweedTab.getAttribute("aria-selected") === "true" && !sourceSeaweedTab.hidden) {
    setWorkspace("seaweed");
  } else {
    setWorkspace("training");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWorkspaceTabs, { once: true });
} else {
  initWorkspaceTabs();
}
