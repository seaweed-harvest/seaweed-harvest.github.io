from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


class AuthFirstPartyLinksStaticTest(unittest.TestCase):
    def test_public_login_pages_do_not_offer_self_registration(self):
        for page_name in ("index.html", "login.html"):
            page = read(page_name)
            self.assertNotIn('href="./register.html"', page)
            self.assertNotIn("Make account", page)
            self.assertIn('id="showResetPassword"', page)

        self.assertTrue((ROOT / "register.html").exists())

    def test_confirmation_gateway_requires_a_deliberate_user_action(self):
        page = read("auth_confirm.html")
        script = read("assets/js/auth_confirm_page.js")

        self.assertIn('meta name="referrer" content="no-referrer"', page)
        self.assertIn('id="confirmationForm"', page)
        self.assertIn('id="confirmationButton"', page)
        self.assertIn("verifyOtp", script)
        self.assertIn('addEventListener("submit", confirmLink)', script)
        self.assertIn("window.history.replaceState", script)
        self.assertIn("./login.html?mode=invite", script)
        self.assertIn("./login.html?mode=recovery", script)

    def test_confirmation_gateway_rejects_unknown_flows_and_missing_tokens(self):
        script = read("assets/js/auth_confirm_page.js")

        self.assertIn('FLOW_COPY[params.get("type")]', script)
        self.assertIn("tokenHash.length < 20", script)
        self.assertIn("tokenHash.length > 2048", script)
        self.assertIn("invalid or incomplete", script)
        self.assertIn("expired or has already been used", script)


if __name__ == "__main__":
    unittest.main()
