from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


class OfflineAutoSyncStaticTest(unittest.TestCase):
    def test_browser_and_native_collection_pages_auto_sync_pending_records(self):
        collection = read("assets/js/collection_form.js")
        today = read("assets/js/today_page.js")

        self.assertNotIn("!state.offline.native || !state.offline.ready", collection)
        self.assertNotIn("!globalThis.SeaweedNative?.isNative || !state.online", today)
        self.assertIn("syncOutbox({ announce: true, automatic: true })", collection)
        self.assertIn("syncAllLocalRecords({ automatic: true })", today)
        self.assertIn('window.addEventListener("online"', collection)
        self.assertIn('window.addEventListener("online"', today)

    def test_normal_app_pages_start_a_shared_automatic_retry_loop(self):
        navigation = read("assets/js/app_navigation.js")
        autosync = read("assets/js/offline_autosync.js")

        self.assertIn("startOfflineCollectionAutoSync", navigation)
        self.assertIn('window.addEventListener("online"', autosync)
        self.assertIn('window.addEventListener("focus"', autosync)
        self.assertIn('window.addEventListener("pageshow"', autosync)
        self.assertIn('document.addEventListener("visibilitychange"', autosync)
        self.assertIn("RETRY_INTERVAL_MS = 60 * 1000", autosync)

    def test_automatic_sync_respects_record_ownership_and_permanent_rejections(self):
        sync = read("assets/js/offline_sync.js")
        autosync = read("assets/js/offline_autosync.js")

        self.assertIn('item.failureType !== "server_rejected"', sync)
        self.assertIn("item.ownerUserId === options.currentUserId", sync)
        self.assertIn("item.ownerUserId === currentUserId", autosync)
        self.assertIn('item.mode === "public"', autosync)

    def test_service_worker_precaches_the_auto_sync_module(self):
        worker = read("service-worker.js")

        self.assertIn('"./assets/js/offline_autosync.js"', worker)
        self.assertIn('CACHE_VERSION = "seaweed-harvest-collection-v139"', worker)
