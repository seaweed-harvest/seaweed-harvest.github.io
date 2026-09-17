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
    .filter((tab) => TRAINING_TAB_NAMES.has(tab.dataset.reefTab));
}

function initWorkspaceTabs() {
  const workspace = document.getElementById("reefTrainingWorkspace");
  const secondaryTabs = document.getElementById("reefNurseryTabs");
  const seaweedTab = document.getElementById("reefSeaweedTab");
  if (!workspace || !secondaryTabs || !seaweedTab || document.getElementById("reefWorkspaceTabs")) return;

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

  seaweedTab.textContent = "Seaweed Data Collection";
  seaweedTab.classList.add("reef-workspace-tab");
  seaweedTab.removeAttribute("data-reef-training-tab");

  workspaceTabs.append(trainingWorkspaceTab, seaweedTab);
  workspace.insertBefore(workspaceTabs, secondaryTabs);

  const style = document.createElement("style");
  style.id = "reefWorkspaceTabsStyle";
  style.textContent = `
    .reef-workspace-tabs {
      margin-bottom: 0.6rem;
    }
    .reef-workspace-tabs .reef-workspace-tab {
      font-weight: 700;
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
    seaweedTab.setAttribute("aria-selected", String(seaweedActive));
    seaweedTab.tabIndex = seaweedActive ? 0 : -1;
    secondaryTabs.hidden = seaweedActive;
  }

  function activateTrainingWorkspace() {
    const target = secondaryTabs.querySelector(`[data-reef-tab="${lastTrainingTab}"]`)
      || secondaryTabs.querySelector('[data-reef-tab="session"]');
    if (target) target.click();
    setWorkspace("training");
  }

  function activateSeaweedWorkspace() {
    seaweedTab.click();
    setWorkspace("seaweed");
  }

  trainingWorkspaceTab.addEventListener("click", activateTrainingWorkspace);
  seaweedTab.addEventListener("click", () => setWorkspace("seaweed"));

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
    if (!event.target.closest(".reef-workspace-tab")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.target === trainingWorkspaceTab) {
      activateSeaweedWorkspace();
      seaweedTab.focus();
    } else {
      activateTrainingWorkspace();
      trainingWorkspaceTab.focus();
    }
  }, true);

  const observer = new MutationObserver(() => {
    if (seaweedTab.getAttribute("aria-selected") === "true") {
      setWorkspace("seaweed");
      return;
    }
    const selected = selectedTrainingTab(secondaryTabs);
    if (selected) {
      lastTrainingTab = selected;
      setWorkspace("training");
    }
  });

  [seaweedTab, ...visibleTrainingTabs(secondaryTabs)].forEach((tab) => {
    observer.observe(tab, { attributes: true, attributeFilter: ["aria-selected"] });
  });

  if (seaweedTab.getAttribute("aria-selected") === "true") setWorkspace("seaweed");
  else setWorkspace("training");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWorkspaceTabs, { once: true });
} else {
  initWorkspaceTabs();
}
