import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PlatformApplicationInviteStaticTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.auth_client = (ROOT / "assets/js/auth_client.js").read_text(encoding="utf-8")
        cls.users_page = (ROOT / "assets/js/users_page.js").read_text(encoding="utf-8")
        cls.users_html = (ROOT / "admin_users.html").read_text(encoding="utf-8")

    def test_admin_users_ui_can_invite_and_manage_tide_access(self):
        self.assertIn('id="applicationInviteForm"', self.users_html)
        self.assertIn('id="editApplicationAccess"', self.users_html)
        self.assertIn('id="saveApplicationAccess"', self.users_html)
        self.assertIn("invokePlatformAppUsers", self.auth_client)
        self.assertIn('action: "invite"', self.users_page)
        self.assertIn('app_key: "tide"', self.users_page)
        self.assertIn('authClient.rpc("ag_admin_user_app_access"', self.users_page)
        self.assertIn('authClient.rpc("ag_admin_set_user_app_access"', self.users_page)

    def test_invite_calls_only_the_reviewed_edge_function(self):
        self.assertIn('authClient.functions.invoke("platform-app-users"', self.auth_client)
        self.assertIn("functionSession", self.auth_client)
        self.assertIn("refreshFunctionSession", self.auth_client)
        self.assertIn("authSessionRequiredError", self.auth_client)

    def test_tide_only_users_are_not_forced_into_harvest_editor(self):
        self.assertIn('user.app_role === "platform_user"', self.users_page)
        self.assertIn("configurePlatformOnlyEditor", self.users_page)
        self.assertIn("els.saveUser.hidden = platformOnly", self.users_page)


if __name__ == "__main__":
    unittest.main()
