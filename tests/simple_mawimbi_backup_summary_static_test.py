import pathlib
import unittest
from html.parser import HTMLParser


ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


class IdCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []

    def handle_starttag(self, _tag, attrs):
        for name, value in attrs:
            if name == "id" and value:
                self.ids.append(value)


class SimpleMawimbiBackupSummaryStaticTest(unittest.TestCase):
    def setUp(self):
        self.page = read("admin_backups.html")
        self.script = read("assets/js/admin_backups_summary.js")

    def test_page_uses_the_shared_records_ledger_shell(self):
        self.assertIn('data-auth-pending', self.page)
        self.assertIn('class="app-shell admin-shell admin-layout"', self.page)
        self.assertIn('id="backupSidebar" class="admin-sidebar"', self.page)
        self.assertIn('class="admin-content"', self.page)
        self.assertIn('class="panel admin-page-section backup-panel"', self.page)
        self.assertIn('class="today-records-heading form-ledger-heading"', self.page)
        self.assertIn('class="form-ledger-metric-strip backup-summary-metrics"', self.page)
        self.assertEqual(self.page.count('class="form-ledger-metric"'), 6)
        self.assertNotIn('class="backup-shell"', self.page)
        self.assertNotIn('backup-summary-card', self.page)

    def test_page_uses_the_shared_header_and_current_module(self):
        self.assertIn('src="./assets/js/pwa_bootstrap.js"', self.page)
        self.assertIn('src="./assets/js/admin_backups_summary.js?v=7"', self.page)
        self.assertIn('<a href="./collection.html">Collection</a>', self.page)
        self.assertIn('<a href="./home.html">Home</a>', self.page)
        self.assertIn('id="backupConnectionStatus" role="status" aria-live="polite"', self.page)
        self.assertIn('id="backupConnectionRetry" type="button" hidden', self.page)
        self.assertIn('<details id="legacyBackup" hidden>', self.page)

    def test_all_summary_values_and_dataset_rows_remain_live_bindable(self):
        for element_id in (
            "backupActiveRecordCount",
            "backupDeletedRecordCount",
            "backupTotalRecordCount",
            "backupLinkedPhotoCount",
            "backupAvailablePhotoCount",
            "backupRecordExportSize",
        ):
            self.assertIn(f'id="{element_id}"', self.page)

        for dataset_key in (
            "intake",
            "site_water_samples",
            "stock_records",
            "process_records",
            "active-total",
            "deleted_record_archive",
        ):
            self.assertIn(f'data-backup-dataset="{dataset_key}"', self.page)

        for field in (
            "records",
            "photos-linked",
            "photos-available",
            "record-export",
            "date-range",
        ):
            self.assertIn(f'data-backup-field="{field}"', self.page)

    def test_summary_initialises_shared_navigation_and_account_controls(self):
        self.assertIn("setupAccountControls", self.script)
        self.assertIn("populateAppSidebar", self.script)
        self.assertIn("setupAppNavigation", self.script)
        self.assertIn("routeForProfile", self.script)
        self.assertIn("populateAppSidebar(els.backupSidebar", self.script)
        self.assertIn("setupAccountControls(access.profile)", self.script)
        self.assertIn("setupAppNavigation({ profile: access.profile, sidebar, dashboardHref })", self.script)
        self.assertIn('document.body.removeAttribute("data-auth-pending")', self.script)

    def test_owner_guard_and_live_summary_rpc_are_preserved(self):
        self.assertIn('requireAuthenticatedAccount("admin_backups.html")', self.script)
        self.assertIn('access.profile?.is_protected_owner === true', self.script)
        self.assertIn('access.profile?.app_role === "system_admin"', self.script)
        self.assertIn('access.profile?.can_export_backups === true', self.script)
        self.assertIn('window.location.replace("./access_pending.html")', self.script)
        self.assertIn('authClient.rpc("ag_backup_dashboard")', self.script)
        self.assertEqual(self.script.count("authClient.rpc("), 1)
        for prohibited in (".insert(", ".update(", ".upsert(", ".delete("):
            self.assertNotIn(prohibited, self.script)

    def test_export_control_is_initially_safe_and_has_progress_and_fallback_download(self):
        self.assertIn(
            '<button id="backupExportButton" type="button" disabled aria-describedby="backupExportStatus">',
            self.page,
        )
        self.assertIn('id="backupExportProgress"', self.page)
        self.assertIn('max="100" value="0" hidden', self.page)
        self.assertIn('id="backupDownloadLink"', self.page)
        self.assertIn('role="status" aria-live="polite"', self.page)
        self.assertIn("Operational records are not changed.", self.page)
        self.assertNotIn("Export backend not connected", self.page)

    def test_export_uses_one_authenticated_server_side_engine(self):
        self.assertEqual(self.script.count('authClient.functions.invoke("system-backup"'), 1)
        self.assertIn('action: "create"', self.script)
        self.assertIn('trigger_type: "manual"', self.script)
        self.assertIn('action: "status"', self.script)
        self.assertIn('action: "download"', self.script)
        self.assertIn("response?.duplicate", self.script)
        self.assertIn("POLL_INTERVAL_MS = 2000", self.script)
        self.assertIn("POLL_TIMEOUT_MS = 15 * 60 * 1000", self.script)
        self.assertNotIn("package_type", self.script)
        self.assertNotIn('package_type: "complete"', self.script)
        self.assertNotIn('action: "complete"', self.script)
        self.assertNotIn('downloadPackage("complete")', self.script)

    def test_export_resumes_active_jobs_and_does_not_duplicate_browser_clicks(self):
        self.assertIn("dashboard?.latest_attempt", self.script)
        self.assertIn('["queued", "running"].includes', self.script)
        self.assertIn("ACTIVE_JOB_STORAGE_KEY", self.script)
        self.assertIn("window.sessionStorage.setItem", self.script)
        self.assertIn("window.sessionStorage.removeItem", self.script)
        self.assertIn("if (!state.summaryReady || state.exportBusy) return", self.script)
        self.assertIn("rememberActiveJob(jobId)", self.script)
        self.assertIn("Retry verified download", self.script)

    def test_export_is_explicit_read_only_and_handles_missing_photos(self):
        self.assertIn("window.confirm", self.script)
        self.assertIn("Operational records will not be changed", self.script)
        self.assertIn("missingPhotoCount", self.script)
        self.assertIn("missing reference", self.script)
        self.assertIn("The Mawimbi operational records were not changed", self.script)
        self.assertIn("The operational records were not changed", self.script)

    def test_download_and_error_paths_are_resilient(self):
        self.assertIn("response?.signed_url", self.script)
        self.assertIn("els.backupDownloadLink.download = fileName", self.script)
        self.assertIn("els.backupDownloadLink?.click()", self.script)
        self.assertIn("error?.context?.json()", self.script)
        self.assertIn("Click Check backup status to retry", self.script)
        self.assertIn("Start a new export to continue", self.script)

    def test_html_ids_are_unique(self):
        parser = IdCollector()
        parser.feed(self.page)
        duplicates = sorted({value for value in parser.ids if parser.ids.count(value) > 1})
        self.assertEqual(duplicates, [])


if __name__ == "__main__":
    unittest.main()

