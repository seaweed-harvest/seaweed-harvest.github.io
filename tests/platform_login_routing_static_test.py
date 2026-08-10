import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PlatformLoginRoutingStaticTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.login = (ROOT / "assets/js/login_page.js").read_text(encoding="utf-8")
        cls.access = (ROOT / "assets/js/platform_access.js").read_text(encoding="utf-8")
        cls.shell = (ROOT / "tide/assets/js/platform_shell.js").read_text(encoding="utf-8")

    def test_login_accepts_only_a_safe_tide_return_path(self):
        self.assertIn("^tide\\/", self.login)
        self.assertIn("applicationForPage", self.login)
        self.assertIn('return "tide"', self.login)
        self.assertIn("Boolean(applications?.[requestedApp])", self.login)

    def test_platform_user_defaults_to_tide_when_granted(self):
        self.assertIn('profile?.app_role === "platform_user"', self.login)
        self.assertIn("applications?.tide", self.login)
        self.assertIn('return "./tide/index.html"', self.login)

    def test_existing_report_subscription_return_is_preserved(self):
        self.assertIn('requestedFile === "report_subscriptions.html"', self.login)

    def test_tide_shell_returns_unauthenticated_users_to_shared_login(self):
        self.assertIn("redirectToLogin", self.shell)
        self.assertIn("/login.html?return=", self.shell)
        self.assertIn("tideReturnPath", self.shell)
        self.assertIn('authClient.rpc("platform_my_app_access")', self.access)


if __name__ == "__main__":
    unittest.main()
