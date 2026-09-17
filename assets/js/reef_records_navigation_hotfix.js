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
  const groups = new Set();
  document.querySelectorAll([
    'a[href*="dryer_table_records.html"]',
    'a[href*="reef_nursery_records.html"]',
    'a[href*="record_type=training"]',
    'a[href*="record_type=seaweed"]',
    'a[href*="reef_seaweed_records.html"]',
    'a[href$="photos.html"]'
  ].join(",")).forEach((anchor) => {
    groups.add(anchor.closest(".admin-menu-group-links, .mobile-primary-popover") || anchor.parentElement);
  });

  groups.forEach((group) => {
    if (group) normalizeRecordsGroup(group);
  });
}

function normalizeRecordsGroup(group) {
  let anchors = [...group.querySelectorAll(":scope > a")];
  const dryer = firstByHref(anchors, "dryer_table_records.html");
  const photos = anchors.find((anchor) => fileName(anchor.href) === "photos.html") || null;
  let training = anchors.find((anchor) => isTrainingRecordsHref(anchor.href)) || null;
  let seaweed = anchors.find((anchor) => isSeaweedRecordsHref(anchor.href)) || null;
  const legacy = anchors.find((anchor) => anchor.href.includes("reef_nursery_records.html")) || null;

  if (!training && legacy) {
    training = legacy;
  } else if (legacy && legacy !== training) {
    legacy.remove();
  }

  if (training) setLink(training, "Nursery - Training", "./reef_nursery.html?tab=records&record_type=training");

  if (!seaweed && training) {
    seaweed = training.cloneNode(true);
    training.after(seaweed);
  }
  if (seaweed) setLink(seaweed, "Nursery - Seaweed", "./reef_seaweed_records.html");

  if (dryer) setLink(dryer, "Dryer Table", "./dryer_table_records.html");
  if (photos && photos.textContent !== "Photos") photos.textContent = "Photos";

  anchors = [...group.querySelectorAll(":scope > a")];
  removeDuplicateMatches(anchors, (anchor) => isTrainingRecordsHref(anchor.href), training);
  removeDuplicateMatches(anchors, (anchor) => isSeaweedRecordsHref(anchor.href), seaweed);

  placeAfter(dryer, training);
  placeAfter(training, seaweed);
  placeAfter(seaweed, photos);
  syncCurrentState([dryer, training, seaweed, photos]);
}

function setLink(anchor, text, href) {
  if (anchor.textContent !== text) anchor.textContent = text;
  const expected = new URL(href, window.location.href).href;
  if (anchor.href !== expected) anchor.href = href;
}

function placeAfter(anchor, node) {
  if (!anchor || !node || anchor.nextElementSibling === node) return;
  anchor.after(node);
}

function syncCurrentState(anchors) {
  anchors.filter(Boolean).forEach((anchor) => {
    const current = routeMatchesCurrent(anchor.href);
    if (current) anchor.setAttribute("aria-current", "page");
    else if (anchor.getAttribute("aria-current") === "page") anchor.removeAttribute("aria-current");
  });
}

function routeMatchesCurrent(href) {
  try {
    const target = new URL(href, window.location.href);
    const current = new URL(window.location.href);
    if (target.pathname !== current.pathname) return false;
    if (fileName(href) === "reef_nursery.html" && target.searchParams.get("record_type")) {
      return current.searchParams.get("record_type") === target.searchParams.get("record_type")
        && current.searchParams.get("tab") === "records";
    }
    return true;
  } catch {
    return false;
  }
}

function removeDuplicateMatches(anchors, predicate, keep) {
  anchors.forEach((anchor) => {
    if (anchor !== keep && predicate(anchor)) anchor.remove();
  });
}

function firstByHref(anchors, token) {
  return anchors.find((anchor) => anchor.href.includes(token)) || null;
}

function isTrainingRecordsHref(href) {
  return href.includes("reef_nursery_records.html")
    || (href.includes("reef_nursery.html") && href.includes("record_type=training"));
}

function isSeaweedRecordsHref(href) {
  return href.includes("reef_seaweed_records.html")
    || (href.includes("reef_nursery.html") && href.includes("record_type=seaweed"));
}

function fileName(href) {
  try {
    return new URL(href, window.location.href).pathname.split("/").pop() || "";
  } catch {
    return "";
  }
}
