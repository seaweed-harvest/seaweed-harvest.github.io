if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

function init() {
  patch();
  new MutationObserver(patch).observe(document.documentElement, { childList: true, subtree: true });
}

function patch() {
  document.querySelectorAll('a[href*="reef_nursery_records.html"]').forEach((anchor) => {
    if (anchor.dataset.reefRecordsSplit === "done") return;
    const training = anchor.cloneNode(true);
    const seaweed = anchor.cloneNode(true);
    training.textContent = "Nursery - Training Records";
    training.href = "./reef_nursery.html?tab=records&record_type=training";
    training.dataset.reefRecordsSplit = "done";
    seaweed.textContent = "Nursery - Seaweed Records";
    seaweed.href = "./reef_nursery.html?tab=records&record_type=seaweed";
    seaweed.dataset.reefRecordsSplit = "done";
    anchor.before(training, seaweed);
    anchor.remove();
  });
}
