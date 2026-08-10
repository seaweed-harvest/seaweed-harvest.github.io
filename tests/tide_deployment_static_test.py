import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TIDE = ROOT / "tide"


class TideDeploymentStaticTests(unittest.TestCase):
    def test_exact_lean_runtime_file_count_is_published(self):
        files = sorted(
            path.relative_to(TIDE).as_posix()
            for path in TIDE.glob("**/*")
            if path.is_file() and "__pycache__" not in path.parts
        )
        self.assertEqual(len(files), 62)
        for relative_path in (
            "index.html",
            "map.html",
            "manifest.webmanifest",
            "service-worker.js",
            "assets/js/platform_backend.js",
            "assets/js/platform_shell.js",
            "assets/js/disclaimer.js",
            "06_Location_Observations/2026-06-15_local_tide_observation_paper_form.pdf",
        ):
            self.assertIn(relative_path, files)

    def test_heavy_legacy_source_material_is_not_published(self):
        for directory in (
            "01_Tide_Planning_Documents",
            "02_Tide_Data_Sources",
            "03_Build_And_Handover_Documents",
            "04_Superbase",
            "05_Farm_References",
        ):
            self.assertFalse((TIDE / directory).exists(), directory)

    def test_pwa_scope_stays_inside_tide(self):
        manifest = json.loads((TIDE / "manifest.webmanifest").read_text(encoding="utf-8"))
        service_worker = (TIDE / "service-worker.js").read_text(encoding="utf-8")
        self.assertEqual(manifest["scope"], "./")
        self.assertTrue(manifest["start_url"].startswith("./"))
        self.assertIn('scopeUrl.pathname === "/tide/"', service_worker)

    def test_shared_backend_beta_notice_and_single_source_are_deployed(self):
        backend = (TIDE / "assets/js/platform_backend.js").read_text(encoding="utf-8")
        language = (TIDE / "assets/js/language.js").read_text(encoding="utf-8")
        tide_page = (TIDE / "assets/js/tide_page.js").read_text(encoding="utf-8")
        platform_config = (ROOT / "assets/js/config.js").read_text(encoding="utf-8")
        self.assertIn('import("/assets/js/config.js")', backend)
        self.assertIn("wwzmajhdusfyfskppupg.supabase.co", platform_config)
        self.assertIn("Welcome to the CNbS Tidal Tool", language)
        self.assertIn("limited testing cohort", language)
        self.assertIn("kmfri_2026_mombasa", tide_page)


if __name__ == "__main__":
    unittest.main()
