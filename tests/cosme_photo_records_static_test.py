import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class CosmePhotoRecordsStaticTest(unittest.TestCase):
    def setUp(self):
        self.records_page = (ROOT / "dryer_table_records.html").read_text(
            encoding="utf-8"
        )
        self.records_script = (
            ROOT / "assets/js/dryer_table_records.js"
        ).read_text(encoding="utf-8")
        self.photos_page = (ROOT / "photos.html").read_text(encoding="utf-8")
        self.photos_script = (ROOT / "assets/js/photos_page.js").read_text(
            encoding="utf-8"
        )
        self.photo_viewer = (ROOT / "assets/js/photo_viewer.js").read_text(
            encoding="utf-8"
        )
        self.dryer_client = (
            ROOT / "assets/js/dryer_photo_client.js"
        ).read_text(encoding="utf-8")
        self.dryer_migration = (
            ROOT
            / "supabase/migrations/20260901162000_dryer_photo_catalog_and_counts.sql"
        ).read_text(encoding="utf-8")
        self.reef_migration = (
            ROOT
            / "supabase/migrations/20260901162100_cosme_reef_photo_library.sql"
        ).read_text(encoding="utf-8")
        self.edge_function = (
            ROOT / "supabase/functions/dryer-record-photos/index.ts"
        ).read_text(encoding="utf-8")

    def test_dryer_event_header_has_direct_photo_action(self):
        self.assertIn("groupedPhotoCount(group.rows)", self.records_script)
        self.assertIn("data-dryer-photo-submission", self.records_script)
        self.assertIn("dryer-event-photo-button", self.records_script)
        self.assertIn("fetchDryerEventPhotos", self.records_script)
        self.assertIn("openPhotoUrlPreview", self.records_script)
        self.assertIn("event.preventDefault()", self.records_script)
        self.assertIn("event.stopPropagation()", self.records_script)

    def test_bay_photo_label_separates_loading_and_unloading(self):
        self.assertIn("row.loading_photo_count", self.records_script)
        self.assertIn("row.unloading_photo_count", self.records_script)
        self.assertIn('parts.push(`${formatInteger(loading)} loading`)', self.records_script)
        self.assertIn('parts.push(`${formatInteger(unloading)} unloading`)', self.records_script)
        self.assertIn("data-dryer-photo-bay", self.records_script)
        self.assertNotRegex(
            self.records_script,
            r"<td>\$\{escapeHtml\(formatInteger\(row\.photo_count\)\)\}</td>",
        )

    def test_event_count_deduplicates_table_photo_count_across_bays(self):
        self.assertIn("function groupedPhotoCount(rows)", self.records_script)
        self.assertIn("event.table = Math.max", self.records_script)
        self.assertIn("seenBays: new Set()", self.records_script)
        self.assertIn("event.table + event.bays", self.records_script)

    def test_photo_viewer_supports_signed_urls_without_navigation(self):
        self.assertIn("export function openPhotoUrlPreview", self.photo_viewer)
        self.assertIn('url.protocol === "https:"', self.photo_viewer)
        self.assertIn("dialog.showModal()", self.photo_viewer)
        self.assertIn("figcaption", self.photo_viewer)
        self.assertNotIn("window.location", self.photo_viewer)

    def test_dryer_photo_client_uses_account_token_and_guarded_function(self):
        self.assertIn("currentAccessToken", self.dryer_client)
        self.assertIn("/functions/v1/dryer-record-photos", self.dryer_client)
        self.assertIn("Authorization: `Bearer ${accountToken}`", self.dryer_client)
        self.assertIn('action: "event"', self.dryer_client)
        self.assertIn('action: "library"', self.dryer_client)
        self.assertNotIn("storage_path", self.dryer_client)

    def test_dryer_catalog_is_service_only_and_bucket_remains_private(self):
        migration = self.dryer_migration.lower()
        self.assertIn("create or replace view public.seaweed_drying_photo_catalog", migration)
        self.assertIn("with (security_invoker = true)", migration)
        self.assertIn(
            "revoke all on table public.seaweed_drying_photo_catalog from public, anon, authenticated",
            migration,
        )
        self.assertIn(
            "grant select on table public.seaweed_drying_photo_catalog to service_role",
            migration,
        )
        self.assertNotIn("update storage.buckets", migration)
        self.assertNotRegex(migration, r"public\s*=\s*true")
        self.assertNotIn("grant select on table public.seaweed_drying_photo_catalog to anon", migration)

    def test_ledger_rpc_adds_counts_without_source_mutation(self):
        migration = self.dryer_migration.lower()
        for field in (
            "table_photo_count",
            "loading_photo_count",
            "unloading_photo_count",
        ):
            self.assertIn(field, migration)
        for pattern in (
            r"insert\s+into\s+public\.seaweed_drying_submissions",
            r"insert\s+into\s+public\.seaweed_drying_bay_records",
            r"update\s+public\.seaweed_drying_submissions",
            r"update\s+public\.seaweed_drying_bay_records",
            r"delete\s+from\s+public\.seaweed_drying_submissions",
            r"delete\s+from\s+public\.seaweed_drying_bay_records",
            r"alter\s+table\s+public\.seaweed_drying_submissions",
            r"alter\s+table\s+public\.seaweed_drying_bay_records",
        ):
            self.assertNotRegex(migration, pattern)

    def test_edge_function_validates_foreign_owner_token_before_signing(self):
        source = self.edge_function
        self.assertIn("verify_jwt=false", (
            ROOT / "01_Ag_Planning_Documents/2026-09-01_COSME_PHOTO_RECORDS.md"
        ).read_text(encoding="utf-8"))
        self.assertIn("ag_my_profile", source)
        self.assertIn('profile.account_status === "active"', source)
        self.assertIn("profile.is_protected_owner === true", source)
        self.assertIn('active_aggregator_code || "").toUpperCase() === "COSME"', source)
        self.assertIn("organisation_capabilities?.form_dryer_table === true", source)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", source)
        self.assertIn("createSignedUrl(row.storage_path", source)
        self.assertIn("SIGNED_URL_SECONDS = 600", source)
        self.assertIn("seaweed_drying_photo_catalog", source)
        self.assertNotRegex(source, r"createSignedUrl\(body\.")
        self.assertNotRegex(source, r"createSignedUrl\(.*storage_path.*body")

    def test_cosme_photos_page_has_two_source_tabs_and_simple_filters(self):
        for label in ("Dryer Table", "Reef Nursery"):
            self.assertIn(label, self.photos_page)
        self.assertIn('id="photoSourceTabs"', self.photos_page)
        self.assertIn('id="photoCommunityLabel">Community', self.photos_page)
        self.assertIn('id="photoTableWrap"', self.photos_page)
        self.assertIn('src="./assets/js/photos_page.js?v=3"', self.photos_page)
        self.assertIn('photoCommunityLabel.textContent = "Location"', self.photos_script)
        self.assertIn('photoSeaweedHeading.textContent = "Photo context"', self.photos_script)
        self.assertIn("photoSourceField.hidden = true", self.photos_script)
        self.assertIn("photoGradeField.hidden = true", self.photos_script)
        self.assertIn("state.galleryVisible = true", self.photos_script)
        self.assertIn('state.galleryVisible ? "Show list" : "Show thumbnails"', self.photos_script)

    def test_cosme_photo_sources_use_correct_backends(self):
        self.assertIn("fetchDryerPhotoLibrary", self.photos_script)
        self.assertIn('authClient.rpc("ag_cosme_reef_photo_library"', self.photos_script)
        self.assertIn("p_location", self.photos_script)
        self.assertIn("p_recorder", self.photos_script)
        self.assertIn("signedPhotoUrl", self.photos_script)
        self.assertIn("row.signed_url", self.photos_script)

    def test_non_cosme_generic_photo_library_is_preserved(self):
        self.assertIn('authClient.rpc("ag_photo_library"', self.photos_script)
        for argument in (
            "p_source_type",
            "p_community_id",
            "p_grade",
            "p_recorder",
        ):
            self.assertIn(argument, self.photos_script)
        self.assertIn("async function loadCommunities", self.photos_script)
        self.assertIn("function genericRowMarkup", self.photos_script)

    def test_reef_photo_rpc_is_cosme_authenticated_and_location_filtered(self):
        migration = self.reef_migration.lower()
        self.assertIn("create or replace function public.ag_cosme_reef_photo_library", migration)
        self.assertIn("ag_require_permission('can_view_data')", migration)
        self.assertIn("ag_require_active_aggregator", migration)
        self.assertIn("upper(aggregator.aggregator_code) = 'cosme'", migration)
        self.assertIn("photo.location = v_location", migration)
        self.assertIn("grant execute on function public.ag_cosme_reef_photo_library", migration)
        self.assertIn("to authenticated", migration)
        self.assertIn("from public, anon", migration)

    def test_public_dryer_form_and_offline_paths_are_not_touched(self):
        dryer_page = (ROOT / "dryer_table.html").read_text(encoding="utf-8")
        dryer_bootstrap = (ROOT / "assets/js/dryer_table_bootstrap.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("dryer_table_form.js", dryer_page)
        self.assertNotIn("dryer_photo_client.js", dryer_page)
        self.assertNotIn("dryer-record-photos", dryer_bootstrap)
        self.assertNotIn("requireAggregatorAccess", dryer_bootstrap)


if __name__ == "__main__":
    unittest.main()
