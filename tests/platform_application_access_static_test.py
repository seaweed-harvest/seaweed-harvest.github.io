import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PlatformApplicationAccessStaticTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.access = (ROOT / "assets/js/platform_access.js").read_text(encoding="utf-8")
        cls.shell = (ROOT / "tide/assets/js/platform_shell.js").read_text(encoding="utf-8")
        cls.backend = (ROOT / "tide/assets/js/platform_backend.js").read_text(encoding="utf-8")
        cls.users = (ROOT / "assets/js/users_page.js").read_text(encoding="utf-8")

    def test_shared_client_uses_controlled_application_access_rpc(self):
        self.assertIn('authClient.rpc("platform_my_app_access")', self.access)
        self.assertIn("ROLE_RANK", self.access)
        self.assertIn("applicationAccess", self.access)
        self.assertIn("hasApplicationAccess", self.access)

    def test_tide_shell_requires_a_shared_session_and_tide_grant(self):
        self.assertIn('import("/assets/js/auth_client.js?v=22")', self.shell)
        self.assertIn('import("/assets/js/platform_access.js?v=1")', self.shell)
        self.assertIn('applicationAccess(TIDE_APP_KEY, true)', self.shell)
        self.assertIn('const TIDE_APP_KEY = "tide"', self.shell)
        self.assertIn("requiredRoleForPath", self.shell)

    def test_tide_backend_uses_the_shared_production_project(self):
        self.assertIn('import("/assets/js/config.js")', self.backend)
        self.assertIn('mode: "seaweed-harvest-platform"', self.backend)
        self.assertIn('locations: "tide_location_context"', self.backend)
        self.assertIn('requireTidePlatformRole("user")', self.backend)

    def test_application_administration_is_platform_admin_only(self):
        self.assertIn("canManageApplicationAccess", self.users)
        self.assertIn('state.actor?.app_role === "system_admin"', self.users)
        self.assertIn("state.actor?.is_protected_owner === true", self.users)


if __name__ == "__main__":
    unittest.main()
