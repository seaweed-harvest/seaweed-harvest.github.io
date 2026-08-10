import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND = ROOT / "assets/js/platform_backend.js"
DATA = ROOT / "assets/js/tide_data.js"
OBSERVATION = ROOT / "assets/js/observation_form.js"
WEATHER = ROOT / "assets/js/weather_alerts.js"
ADMIN = ROOT / "assets/js/admin_page.js"
CALIBRATION = ROOT / "assets/js/calibration_page.js"
TIDE_PAGE = ROOT / "assets/js/tide_page.js"
MAP_PAGE = ROOT / "assets/js/map_page.js"


class PlatformBackendStaticTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend = BACKEND.read_text(encoding="utf-8")
        cls.data = DATA.read_text(encoding="utf-8")
        cls.observation = OBSERVATION.read_text(encoding="utf-8")
        cls.weather = WEATHER.read_text(encoding="utf-8")
        cls.admin = ADMIN.read_text(encoding="utf-8")
        cls.calibration = CALIBRATION.read_text(encoding="utf-8")
        cls.tide_page = TIDE_PAGE.read_text(encoding="utf-8")
        cls.map_page = MAP_PAGE.read_text(encoding="utf-8")

    def test_legacy_and_platform_backends_remain_separate(self):
        self.assertIn('mode: "legacy-v0"', self.backend)
        self.assertIn('mode: "seaweed-harvest-platform"', self.backend)
        self.assertIn('window.location.pathname.startsWith("/tide/")', self.backend)

    def test_platform_uses_root_seaweed_harvest_config_and_session(self):
        self.assertIn('import("/assets/js/config.js")', self.backend)
        self.assertIn('import("/assets/js/auth_client.js?v=22")', self.backend)
        self.assertIn('session.access_token', self.backend)
        self.assertIn('Seaweed Harvest sign-in is required for Tide access', self.backend)

    def test_platform_location_reads_use_canonical_context_view(self):
        self.assertIn('locations: "tide_location_context"', self.backend)
        self.assertIn('row.location_name || row.community_name || row.farm_name', self.data)
        self.assertIn('communityRecordId', self.data)
        self.assertIn('identitySource', self.data)
        self.assertIn('gpsSource', self.data)

    def test_legacy_location_reads_are_preserved(self):
        self.assertIn('locations: "farm_locations"', self.backend)
        self.assertIn('row.location_key || row.farm_location_key', self.data)
        self.assertIn('APP_CONFIG.supabase.publicReadsEnabled', self.data)

    def test_main_planner_uses_one_mombasa_source_while_map_keeps_references(self):
        self.assertIn('MAIN_TIDE_DATASET_KEY = "kmfri_2026_mombasa"', self.tide_page)
        self.assertIn('defaultTideDatasetKey: MAIN_TIDE_DATASET_KEY', self.tide_page)
        self.assertNotIn('loadPublicTideReferences', self.tide_page)
        self.assertIn('loadPublicTideReferences', self.map_page)

    def test_platform_rest_requests_use_user_jwt_not_anon_as_bearer(self):
        self.assertIn('Authorization: `Bearer ${backend.accessToken}`', self.data)
        self.assertIn('apikey: backend.anonKey', self.data)

    def test_platform_role_helper_requires_shared_tide_grant(self):
        self.assertIn('requireTidePlatformRole(minimumRole = "user"', self.backend)
        self.assertIn('applicationAccess("tide", force)', self.backend)
        self.assertIn('tideRoleRank(grant.role) < tideRoleRank(minimumRole)', self.backend)
        self.assertIn('userId: session.user.id', self.backend)

    def test_observation_form_uses_operator_role_and_shared_backend(self):
        self.assertIn('requireTidePlatformRole("operator")', self.observation)
        self.assertIn('requireTidePlatformRole("operator", true)', self.observation)
        self.assertIn('tideBackendTables().observations', self.observation)
        self.assertIn('Authorization: `Bearer ${backend.accessToken}`', self.observation)
        self.assertIn('folder = backend.userId || observationId', self.observation)
        self.assertIn('"authenticated_electronic_form"', self.observation)

    def test_weather_reads_and_refresh_use_selected_backend(self):
        self.assertIn('tideBackendTables().weather', self.weather)
        self.assertIn('`${backend.url}/functions/v1/${EDGE_FUNCTION_NAME}`', self.weather)
        self.assertGreaterEqual(
            self.weather.count('Authorization: `Bearer ${backend.accessToken}`'),
            2,
        )

    def test_platform_admin_uses_shared_admin_role_and_backend(self):
        self.assertIn('requireTidePlatformRole("admin")', self.admin)
        self.assertIn("state.backend = await tideBackendContext()", self.admin)
        self.assertIn('locationAdmin: "tide_locations"', self.backend)
        self.assertIn("TABLES.locationAdmin", self.admin)
        self.assertIn("Authorization: `Bearer ${token}`", self.admin)
        self.assertIn('isSeaweedHarvestPlatform() ? null : "tide_admin_users"', self.admin)
        self.assertIn("configurePlatformAdminUi", self.admin)
        self.assertIn("current.community_record_id", self.admin)
        self.assertIn("Managed in Seaweed Harvest", self.admin)
        self.assertIn("state.backend?.projectRef", self.admin)

    def test_platform_calibration_uses_shared_admin_role_and_backend(self):
        self.assertIn('requireTidePlatformRole("admin")', self.calibration)
        self.assertIn("state.backend = await tideBackendContext()", self.calibration)
        self.assertIn("const TABLES = tideBackendTables()", self.calibration)
        self.assertIn("Authorization: `Bearer ${token}`", self.calibration)

    def test_legacy_admin_login_is_preserved_outside_platform_path(self):
        self.assertIn('if (isSeaweedHarvestPlatform()) return;', self.admin)
        self.assertIn("APP_CONFIG.supabase.url}/auth/v1/token", self.admin)
        self.assertIn('if (isSeaweedHarvestPlatform()) return;', self.calibration)
        self.assertIn("APP_CONFIG.supabase.url}/auth/v1/token", self.calibration)


if __name__ == "__main__":
    unittest.main()
