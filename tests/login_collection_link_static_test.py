from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class LoginCollectionLinkStaticTest(unittest.TestCase):
    def test_login_page_omits_public_collection_shortcut(self):
        page = (ROOT / "login.html").read_text(encoding="utf-8")

        self.assertNotIn('class="auth-collection-link"', page)
        self.assertNotIn('>Collection form</a>', page)

    def test_offline_collection_recovery_link_remains_available(self):
        page = (ROOT / "login.html").read_text(encoding="utf-8")

        self.assertIn('id="offlineCollectionLink"', page)
        self.assertIn('href="./collection.html" hidden', page)


if __name__ == "__main__":
    unittest.main()
