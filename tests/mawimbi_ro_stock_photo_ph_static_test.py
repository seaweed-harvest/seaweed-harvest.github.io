"""Static contract checks for Mawimbi's separate RO monitoring and stock photo records."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_ro_water_form_keeps_the_five_paper_log_columns_and_is_mobile_ready():
    html = read("mawimbi_ro_monitoring.html")
    js = read("assets/js/mawimbi_ro_monitoring.js")
    assert 'name="viewport" content="width=device-width, initial-scale=1"' in html
    assert "standard-form-linear-layout" in html
    for element in ("roRecordedOn", "roPureFlow", "roWasteFlow", "roPressure", "roTds"):
        assert f'id="{element}"' in html
    assert "L/min" in html
    assert "PSI" in html
    assert "ppm" in html
    assert "ag_submit_mawimbi_ro_monitoring" in js
    assert "ag_list_mawimbi_ro_monitoring" in js
    assert 'requireAggregatorAccess("MAWIMBI"' in js


def test_ro_samples_are_isolated_by_organisation_and_not_coastal():
    sql = read("supabase/migrations/20261024150000_mawimbi_ro_monitoring.sql")
    assert "ag_mawimbi_ro_monitoring_records" in sql
    assert "enable row level security" in sql
    assert "revoke all on public.ag_mawimbi_ro_monitoring_records from public, anon, authenticated" in sql
    assert "ag_require_organisation_capability('form_site_water_samples')" in sql
    assert "aggregator_code = 'MAWIMBI'" in sql
    assert "ag_site_water_sample_records" not in sql
    assert "ag_audit_log" in sql


def test_stock_photos_are_private_and_scoped_to_individual_retests():
    stock = read("stabilization_packing.html")
    script = read("assets/js/stabilization_packing_form.js")
    photos = read("assets/js/stock_photo_upload.js")
    sql = read("supabase/migrations/20261024151000_stock_record_photo_attachments.sql")
    viewer = read("assets/js/stock_record_photos.js")
    assert 'name="packingRecordType" value="retest"' in stock
    assert 'id="packingPhotoFiles"' in stock
    assert "ag_submit_stabilization_stock_with_photos" in script
    assert "ag_get_stabilization_stock_photos" in viewer
    assert "ag_add_stabilization_stock_photos" in viewer
    assert "MAX_STOCK_PHOTOS = 2" in photos
    assert "700 * 1024" in photos
    assert "upsert: false" in photos
    assert "public=false" in sql
    assert "enable row level security" not in sql or "storage.objects" in sql
    assert "ag_stabilization_packing_records" in sql
    assert "recorded_by_user_id" in sql
    assert "public.ag_current_aggregator_id()" in sql


def test_coastal_ph_keeps_database_and_ledger_compatibility():
    site = read("site_water_sample.html")
    js = read("assets/js/site_water_sample_form.js")
    ledger = read("assets/js/records_page.js")
    rpc = read("supabase/migrations/20261024152000_stock_photo_site_ph_ledger.sql")
    edit_sql = read("supabase/migrations/20261024153000_site_water_ph_ledger_edit.sql")
    assert 'id="siteSamplePh"' in site
    assert 'data-print-columns="12"' in site
    assert "ph_value: numberOrNull(els.siteSamplePh.value)" in js
    assert "dissolved_oxygen_mg_l: numberOrNull(els.siteSampleDissolvedOxygen.value)" in js
    assert "ag_submit_site_water_sample_record_v5" in js
    assert '["ph_value", "pH"]' in ledger
    assert '["dissolved_oxygen_mg_l", "DO mg/L"]' in ledger
    assert "ag_form_record_ledger_v2" in ledger
    assert "'ph_value'" in edit_sql
    assert "'ph_value', s.ph_value" in rpc
    new_sql = read("supabase/migrations/20261024154000_coastal_dissolved_oxygen.sql")
    assert "ag_submit_site_water_sample_record_v5" in new_sql
    assert "'dissolved_oxygen_mg_l', s.dissolved_oxygen_mg_l" in new_sql


def test_navigation_is_mawimbi_scoped_and_pwa_cache_updates():
    nav = read("assets/js/app_navigation.js")
    worker = read("service-worker.js")
    assert 'href: "./mawimbi_ro_monitoring.html", requiredAggregator: "MAWIMBI"' in nav
    assert '"./mawimbi_ro_monitoring.html"' in worker
    assert '"./stock_record_photos.html"' in worker
    assert 'v148-mawimbi-water-stock-photos' in worker
