"""Synthetic browser probe of the actual dryer summary renderer; no backend calls."""
import json
import os
import pathlib
import re
import shutil
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
source = (ROOT / "assets/js/dryer_table_records.js").read_text(encoding="utf-8")
source = re.sub(r"^import .*;\n", "", source, flags=re.MULTILINE)
source = source.replace('document.addEventListener("DOMContentLoaded", init);', "")
rows = [dict(submission_id="synthetic-event", table_location="Bati (Table 4)",
             bay_number=number, loading_at="2026-08-29T17:29:00+03:00",
             unloading_at="2026-09-04T08:47:00+03:00", status="complete",
             loading_weight_kg=wet, unloading_weight_kg=dry,
             loading_photo_count=2, unloading_photo_count=0, table_photo_count=1)
        for number, wet, dry in [(1, 10, 4), (3, 10, 4), (4, 20, 8)]]
fixture = """<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<input id="dryerTableFilter"><input id="dryerFromDate"><input id="dryerToDate">
<input id="dryerStatusFilter"><select id="dryerGroupBy"><option value="event">Event</option></select>
<div id="dryerSummaryMetrics"></div><table><tbody id="dryerRecordRows"></tbody></table>
<p id="dryerRecordsStatus"></p>"""

with sync_playwright() as playwright:
    executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
    browser = playwright.chromium.launch(headless=True, executable_path=executable)
    for width in (1440, 390):
        page = browser.new_page(viewport={"width": width, "height": 900}, timezone_id="Pacific/Honolulu")
        page.route("**/*", lambda route: route.abort())
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.set_content(fixture)
        page.add_script_tag(content=source)
        page.evaluate("""rows => {
            cacheElements();
            state.bayRows = rows;
            els.dryerRecordRows.addEventListener('click', handleRecordTableClick);
            renderAllRecords();
            window.fetchDryerEventPhotos = async () => ({photos: [{signed_url: 'synthetic', photo_context: 'Loading'}]});
            window.openPhotoUrlPreview = (photos, title) => { window.previewTitle = title; };
        }""", rows)
        heading = page.locator('[data-dryer-group-header] strong')
        assert re.sub(r"\bSept\b", "Sep", heading.inner_text()) == "Bati (Table 4) — 29 Aug 2026 – 04 Sep 2026"
        assert "3 bays · 40 kg loaded · 16 kg unloaded · 0 drying · 3 complete" in page.locator('[data-dryer-group-header]').inner_text()
        assert page.locator('[data-dryer-group-row]:visible').count() == 0
        toggle = page.locator('[data-dryer-group-toggle]')
        toggle.click()
        assert toggle.get_attribute('aria-expanded') == 'true'
        assert page.locator('[data-dryer-group-row]:visible').count() == 3
        assert "17:29" in page.locator('[data-dryer-group-row]').first.inner_text()
        assert "08:47" in page.locator('[data-dryer-group-row]').first.inner_text()
        toggle.focus()
        page.keyboard.press('Enter')
        assert toggle.get_attribute('aria-expanded') == 'false'
        assert page.locator('[data-dryer-group-row]:visible').count() == 0
        page.locator('.dryer-event-photo-button').click()
        page.wait_for_function('window.previewTitle !== undefined')
        assert page.evaluate('window.previewTitle') == heading.inner_text()
        assert toggle.get_attribute('aria-expanded') == 'false'
        assert not errors, errors
        print(json.dumps({"viewport": width, "heading": heading.inner_text(),
                          "expand_collapse": "passed", "photo_title": "passed", "errors": errors}))
        page.close()
    browser.close()
