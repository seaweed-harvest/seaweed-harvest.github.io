const CACHE_VERSION = "seaweed-harvest-collection-v38";
const NETWORK_TIMEOUT_MS = 5000;
const APP_SHELL = [
  "./",
  "./index.html",
  "./collection.html",
  "./stabilization_packing.html",
  "./site_water_sample.html",
  "./today.html",
  "./reset_password.html",
  "./privacy.html",
  "./manifest.webmanifest",
  "./assets/css/ag.css",
  "./assets/css/site_water_sample.css",
  "./assets/images/seaweed-harvest-logo.svg",
  "./assets/images/seaweed-harvest-splash.gif",
  "./assets/images/seaweed-harvest-icon.svg",
  "./assets/images/seaweed-harvest-icon-192.png",
  "./assets/images/seaweed-harvest-icon-512.png",
  "./assets/js/collection_form.js",
  "./assets/js/stabilization_packing_form.js",
  "./assets/js/site_water_sample_form.js",
  "./assets/js/app_navigation.js",
  "./assets/js/favorite_forms.js",
  "./assets/js/print_worksheet.js",
  "./assets/js/app_transition.js",
  "./assets/js/collection_language.js",
  "./assets/js/offline_store.js",
  "./assets/js/offline_sync.js",
  "./assets/js/operation_feedback.js",
  "./assets/js/today_page.js",
  "./assets/js/reset_password_page.js",
  "./assets/js/config.js",
  "./assets/js/fixed_table_scrollbar.js",
  "./assets/js/supabase_client.js",
  "./assets/js/vendor/jspdf.umd.min.js",
  "./assets/js/vendor/jsQR.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("seaweed-harvest-collection-") && key !== CACHE_VERSION)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.hostname.endsWith("supabase.co")) return;
  if (url.pathname.endsWith(".apk") || url.pathname.endsWith(".aab") || url.pathname.includes("/downloads/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./collection.html"));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});

async function networkFirst(request, fallbackUrl = null) {
  const cache = await caches.open(CACHE_VERSION);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response && (response.ok || response.type === "opaque")) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl, { ignoreSearch: true });
      if (fallback) return fallback;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
