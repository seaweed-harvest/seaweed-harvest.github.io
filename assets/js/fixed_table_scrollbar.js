const TABLE_WRAP_SELECTOR = ".responsive-table-wrap, .map-table-wrap";

export function setupFixedTableScrollbar() {
  const existing = document.querySelector(".fixed-table-scrollbar");
  if (existing) return existing;

  const dock = document.createElement("div");
  const dockContent = document.createElement("div");
  dock.className = "fixed-table-scrollbar";
  dock.setAttribute("role", "region");
  dock.setAttribute("aria-label", "Horizontal table scroll control");
  dock.hidden = true;
  dockContent.className = "fixed-table-scrollbar-content";
  dock.append(dockContent);
  document.body.append(dock);

  let activeWrap = null;
  let frame = 0;
  let syncing = false;

  const refresh = () => {
    frame = 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const candidates = [...document.querySelectorAll(TABLE_WRAP_SELECTOR)]
      .filter((wrap) => wrap.scrollWidth > wrap.clientWidth + 2)
      .map((wrap) => {
        const rect = wrap.getBoundingClientRect();
        const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        return { wrap, rect, visibleHeight };
      })
      .filter(({ rect, visibleHeight }) => (
        visibleHeight > 0
        && rect.bottom > viewportHeight
        && rect.right > 0
        && rect.left < viewportWidth
      ))
      .sort((first, second) => second.visibleHeight - first.visibleHeight);

    const candidate = candidates[0];
    if (!candidate) {
      activeWrap = null;
      dock.hidden = true;
      document.body.classList.remove("has-fixed-table-scrollbar");
      return;
    }

    activeWrap = candidate.wrap;
    const left = Math.max(0, candidate.rect.left);
    const right = Math.min(viewportWidth, candidate.rect.right);
    dock.style.left = `${left}px`;
    dock.style.width = `${Math.max(0, right - left)}px`;
    dockContent.style.width = `${activeWrap.scrollWidth}px`;
    dock.hidden = false;
    document.body.classList.add("has-fixed-table-scrollbar");
    if (!syncing && Math.abs(dock.scrollLeft - activeWrap.scrollLeft) > 1) {
      dock.scrollLeft = activeWrap.scrollLeft;
    }
  };

  const scheduleRefresh = () => {
    if (!frame) frame = window.requestAnimationFrame(refresh);
  };

  dock.addEventListener("scroll", () => {
    if (!activeWrap || syncing) return;
    syncing = true;
    activeWrap.scrollLeft = dock.scrollLeft;
    syncing = false;
  });
  document.addEventListener("scroll", (event) => {
    if (event.target === activeWrap && !syncing) {
      syncing = true;
      dock.scrollLeft = activeWrap.scrollLeft;
      syncing = false;
    }
    scheduleRefresh();
  }, true);
  window.addEventListener("resize", scheduleRefresh);
  if (window.ResizeObserver) new ResizeObserver(scheduleRefresh).observe(document.body);
  if (window.MutationObserver) {
    new MutationObserver(scheduleRefresh).observe(document.body, { childList: true, subtree: true });
  }
  scheduleRefresh();
  return dock;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupFixedTableScrollbar, { once: true });
} else {
  setupFixedTableScrollbar();
}
