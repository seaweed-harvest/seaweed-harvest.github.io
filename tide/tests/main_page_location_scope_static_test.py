from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


class MainPageLocationScopeStaticTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = read("index.html")
        cls.tide_page = read("assets/js/tide_page.js")
        cls.language = read("assets/js/language.js")
        cls.map_page = read("assets/js/map_page.js")

    def test_main_page_exposes_only_the_shimoni_region_presentation(self):
        self.assertIn('MAIN_PAGE_LOCATION_KEY = "kenya-coast"', self.tide_page)
        self.assertIn('MAIN_PAGE_LOCATION_NAME = "Shimoni Region"', self.tide_page)
        self.assertIn(
            'locations.find((location) => location?.key === MAIN_PAGE_LOCATION_KEY)',
            self.tide_page,
        )
        self.assertIn('name: MAIN_PAGE_LOCATION_NAME', self.tide_page)
        self.assertIn('shortName: MAIN_PAGE_LOCATION_NAME', self.tide_page)
        self.assertIn('return [{', self.tide_page)

    def test_backend_refresh_cannot_replace_the_single_option_with_all_rows(self):
        self.assertIn(
            'const refreshedLocations = mainPageLocations(farmResult.locations)',
            self.tide_page,
        )
        self.assertIn('if (refreshedLocations.length)', self.tide_page)
        self.assertIn('farmLocations = refreshedLocations', self.tide_page)

    def test_map_page_and_backend_location_inventory_remain_independent(self):
        self.assertNotIn("MAIN_PAGE_LOCATION_KEY", self.map_page)
        self.assertIn("loadPublicFarmLocations", self.map_page)
        self.assertIn("loadPublicTideReferences", self.map_page)

    def test_shimoni_label_is_translated_and_cache_busted(self):
        self.assertIn('"Shimoni Region": "Eneo la Shimoni"', self.language)
        self.assertIn("language.js?v=20260810-shimoni-region", self.index)
        self.assertIn("tide_page.js?v=20260810-shimoni-region", self.index)


if __name__ == "__main__":
    unittest.main()
