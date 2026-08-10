import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SHELL = ROOT / "assets/js/platform_shell.js"
DISCLAIMER = ROOT / "assets/js/disclaimer.js"
LANGUAGE = ROOT / "assets/js/language.js"
SERVICE_WORKER = ROOT / "service-worker.js"
SHELL_CSS = ROOT / "assets/css/platform_shell.css"


class PlatformShellStaticTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shell = SHELL.read_text(encoding="utf-8")
        cls.disclaimer = DISCLAIMER.read_text(encoding="utf-8")
        cls.language = LANGUAGE.read_text(encoding="utf-8")
        cls.service_worker = SERVICE_WORKER.read_text(encoding="utf-8")
        cls.shell_css = SHELL_CSS.read_text(encoding="utf-8")

    def test_platform_guard_activates_only_under_tide_subpath(self):
        self.assertIn('PLATFORM_ROUTE_PREFIX = "/tide/"', self.shell)
        self.assertIn("isPlatformHosted()", self.shell)
        self.assertIn('window.location.pathname.startsWith(PLATFORM_ROUTE_PREFIX)', self.shell)

    def test_platform_guard_uses_shared_auth_and_tide_grant(self):
        self.assertIn('/assets/js/auth_client.js?v=22', self.shell)
        self.assertIn('/assets/js/platform_access.js?v=1', self.shell)
        self.assertIn('applicationAccess(TIDE_APP_KEY, true)', self.shell)
        self.assertIn('redirectToLogin()', self.shell)

    def test_user_account_control_is_injected_into_existing_header(self):
        self.assertIn('document.querySelector(".header-actions")', self.shell)
        self.assertIn('platform-account-menu', self.shell)
        self.assertIn('Profile settings', self.shell)
        self.assertIn('Seaweed Harvest', self.shell)
        self.assertIn('Sign out', self.shell)

    def test_sensitive_pages_require_operator_or_admin_role(self):
        self.assertIn('page === "observation.html"', self.shell)
        self.assertIn('"calibration.html"', self.shell)
        self.assertIn('"tide_datasets.html"', self.shell)
        self.assertIn('accessModule.roleRank(grant.role)', self.shell)

    def test_tide_content_is_hidden_while_platform_access_is_checked(self):
        self.assertIn('html[data-platform-auth="checking"] body', self.shell_css)
        self.assertIn('visibility: hidden', self.shell_css)

    def test_shared_feedback_is_used_only_in_platform_deployment(self):
        self.assertIn('/assets/js/site_feedback.js?v=8', self.disclaimer)
        self.assertIn('./site_feedback.js?v=2', self.disclaimer)
        self.assertIn('PLATFORM_HOSTED', self.disclaimer)

    def test_beta_notice_is_acknowledged_before_navigation_disclaimer(self):
        self.assertIn('BETA_NOTICE_SESSION_KEY', self.disclaimer)
        self.assertIn('ensureBetaNoticeModal();', self.disclaimer)
        self.assertLess(
            self.disclaimer.index('openBetaNotice();'),
            self.disclaimer.index('openDisclaimer({ requireAcknowledgement: true });'),
        )
        self.assertIn('function acknowledgeBetaNotice()', self.disclaimer)
        self.assertIn('if (!hasAcceptedThisSession())', self.disclaimer)
        self.assertIn('Welcome to the CNbS Tidal Tool — Beta', self.language)
        self.assertIn('Mombasa — KMFRI 2026 Tide Predictions', self.language)
        self.assertIn('lower-right corner', self.language)

    def test_pwa_caches_platform_dependencies_only_at_tide_scope(self):
        self.assertIn('PLATFORM_SHARED_ASSETS', self.service_worker)
        self.assertIn('isSeaweedHarvestTideScope()', self.service_worker)
        self.assertIn('/assets/js/auth_client.js?v=22', self.service_worker)
        self.assertIn('/assets/js/site_feedback.js?v=8', self.service_worker)

    def test_supabase_data_cache_is_partitioned_by_auth_scope(self):
        self.assertIn('dataCacheKey(request)', self.service_worker)
        self.assertIn('__tide_cache_scope', self.service_worker)
        self.assertIn('payload.sub || payload.role', self.service_worker)


if __name__ == "__main__":
    unittest.main()
