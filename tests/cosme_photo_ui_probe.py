import functools
import http.server
import json
import pathlib
import shutil
import tempfile
import threading

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


ROOT = pathlib.Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def minimal_page():
    return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    [hidden] { display: none !important; }
    .photo-library-gallery { display: grid; grid-template-columns: repeat(2, 180px); gap: 8px; }
    .photo-library-thumbnail img { width: 160px; height: 100px; object-fit: cover; }
    dialog[open] { display: block; }
  </style>
</head>
<body data-auth-pending>
  <aside id="photoSidebar"></aside>
  <p id="photoLibraryDescription"></p>
  <span id="photoLibraryCount"></span>
  <button id="togglePhotoGallery" type="button" aria-pressed="false">Show thumbnails</button>

  <nav id="photoSourceTabs" hidden>
    <button id="photoDryerTab" type="button" data-photo-source-tab="dryer_table" aria-selected="true">Dryer Table</button>
    <button id="photoReefTab" type="button" data-photo-source-tab="reef_nursery" aria-selected="false">Reef Nursery</button>
  </nav>

  <input id="photoFrom" type="date">
  <input id="photoTo" type="date">
  <label id="photoSourceField">Record type
    <select id="photoSource"><option value="">All records</option><option value="intake">Intake</option></select>
  </label>
  <label id="photoCommunityField"><span id="photoCommunityLabel">Community</span>
    <select id="photoCommunity"><option value="">All communities</option></select>
  </label>
  <label id="photoGradeField">Grade
    <select id="photoGrade"><option value="">All grades</option></select>
  </label>
  <input id="photoRecorder" type="search">
  <button id="applyPhotoFilters" type="button">Apply</button>
  <button id="photoPrevious" type="button">Previous</button>
  <span id="photoPageStatus"></span>
  <button id="photoNext" type="button">Next</button>

  <div id="photoTableWrap">
    <table class="photo-library-table">
      <thead><tr>
        <th>Photo</th>
        <th><button data-photo-sort="taken_at">Date and time</button></th>
        <th><button data-photo-sort="source_label">Record type</button></th>
        <th>Reference</th>
        <th id="photoCommunityHeading"><button data-photo-sort="community_name">Community</button></th>
        <th><button data-photo-sort="recorder_name">Recorded by</button></th>
        <th id="photoSeaweedHeading">Seaweed type</th>
        <th id="photoGradeHeading"><button data-photo-sort="grade_code">Grade</button></th>
      </tr></thead>
      <tbody id="photoLibraryRows"></tbody>
    </table>
  </div>
  <div id="photoGallery" class="photo-library-gallery" hidden></div>
  <p id="photoLibraryStatus"></p>
  <script type="module" src="./assets/js/photos_page.js?v=3"></script>
</body>
</html>"""


def auth_stub():
    reef_fixture = {
        "total_count": 1,
        "locations": ["Mkwiro Nursery"],
        "rows": [
            {
                "record_id": "44444444-4444-4444-8444-444444444444",
                "record_reference": "RN-00004",
                "source_type": "reef_nursery",
                "source_label": "Reef Nursery",
                "taken_at": "2026-08-24T06:30:00Z",
                "activity_date": "2026-08-24",
                "location": "Mkwiro Nursery",
                "recorder_name": "Trainer One",
                "bucket_id": "reef-nursery-photos",
                "storage_path": "reef/photo-one.jpg",
                "photo_order": 1,
                "photo_context": "Inspection",
            }
        ],
    }
    generic_fixture = {
        "total_count": 1,
        "rows": [
            {
                "record_id": "55555555-5555-4555-8555-555555555555",
                "record_reference": "INT-00001",
                "source_type": "intake",
                "source_label": "Intake Collection",
                "taken_at": "2026-08-24T05:00:00Z",
                "community_id": "CID1000",
                "community_name": "Example Community",
                "recorder_name": "Collector",
                "grade_code": "A",
                "seaweed_type": "Spinosum",
                "bucket_id": "collection-photos",
                "storage_path": "intake/photo-one.jpg",
            }
        ],
    }
    return f"""
const params = new URLSearchParams(window.location.search);
const mawimbi = params.get('org') === 'mawimbi';
const cosmeProfile = {{
  id:'00000000-0000-4000-8000-000000000001',
  active_aggregator_code:'COSME',
  account_status:'active',
  app_role:'system_admin',
  is_protected_owner:true,
  can_access_admin:true,
  can_view_data:true,
  organisation_capabilities:{{form_dryer_table:true,form_reef_nursery:true}}
}};
const mawimbiProfile = {{
  id:'00000000-0000-4000-8000-000000000002',
  active_aggregator_code:'MAWIMBI',
  account_status:'active',
  app_role:'system_admin',
  is_protected_owner:true,
  can_access_admin:true,
  can_view_data:true,
  organisation_capabilities:{{form_intake_collection:true,form_process_record:true}}
}};
const reefFixture = {json.dumps(reef_fixture)};
const genericFixture = {json.dumps(generic_fixture)};
export const authClient = {{
  rpc: async (name) => {{
    if (name === 'ag_cosme_reef_photo_library') return {{data:reefFixture,error:null}};
    if (name === 'ag_photo_library') return {{data:genericFixture,error:null}};
    return {{data:null,error:{{message:'Unexpected RPC ' + name}}}};
  }},
  from: () => ({{
    select() {{ return this; }},
    order() {{
      return Promise.resolve({{data:[{{community_id:'CID1000',community_name:'Example Community'}}],error:null}});
    }}
  }}),
  storage: {{
    from: () => ({{
      createSignedUrl: async (path) => ({{
        data:{{signedUrl:'https://images.example.test/' + encodeURIComponent(path)}},
        error:null
      }})
    }})
  }}
}};
export async function requireAdminAccess() {{
  return {{profile:mawimbi ? mawimbiProfile : cosmeProfile}};
}}
export function setupAccountControls() {{}}
export async function currentAccessToken() {{ return 'owner-account-token'; }}
"""


def app_navigation_stub():
    return """
export function populateAppSidebar(sidebar) { return sidebar; }
export function setupAppNavigation() { return null; }
"""


def dryer_client_stub():
    dryer_fixture = {
        "total_count": 2,
        "locations": ["Bati (Table 1)"],
        "rows": [
            {
                "signed_url": "https://images.example.test/dryer-one.jpg",
                "taken_at": "2026-08-31T13:30:00Z",
                "activity_date": "2026-08-31",
                "phase": "table",
                "bay_number": None,
                "photo_order": 1,
                "photo_context": "Table overview",
                "source_type": "dryer_table",
                "source_label": "Dryer Table",
                "record_reference": "DRY-20260831-3B120575",
                "location": "Bati (Table 1)",
                "recorder_name": "Amina Kitsao",
                "submission_id": "3b120575-a81f-44c1-a9d6-6f99bc67c223",
            },
            {
                "signed_url": "https://images.example.test/dryer-two.jpg",
                "taken_at": "2026-08-31T13:30:00Z",
                "activity_date": "2026-08-31",
                "phase": "loading",
                "bay_number": 1,
                "photo_order": 1,
                "photo_context": "Bay 1 — Loading",
                "source_type": "dryer_table",
                "source_label": "Dryer Table",
                "record_reference": "DRY-20260831-3B120575",
                "location": "Bati (Table 1)",
                "recorder_name": "Amina Kitsao",
                "submission_id": "3b120575-a81f-44c1-a9d6-6f99bc67c223",
            },
        ],
    }
    return f"""
const fixture = {json.dumps(dryer_fixture)};
export async function fetchDryerPhotoLibrary() {{ return fixture; }}
export async function fetchDryerEventPhotos() {{ return {{photos:fixture.rows}}; }}
"""


def prepare_site(root):
    assets = root / "assets" / "js"
    assets.mkdir(parents=True)
    (root / "photos.html").write_text(minimal_page(), encoding="utf-8")
    shutil.copy2(ROOT / "assets/js/photos_page.js", assets / "photos_page.js")
    shutil.copy2(ROOT / "assets/js/photo_viewer.js", assets / "photo_viewer.js")
    (assets / "auth_client.js").write_text(auth_stub(), encoding="utf-8")
    (assets / "app_navigation.js").write_text(app_navigation_stub(), encoding="utf-8")
    (assets / "dryer_photo_client.js").write_text(dryer_client_stub(), encoding="utf-8")


def wait_for_text(driver, selector, text):
    WebDriverWait(driver, 20).until(
        lambda current: text in current.find_element(By.CSS_SELECTOR, selector).text
    )


def run_cosme_probe(driver, base_url):
    driver.get(f"{base_url}/photos.html")
    wait_for_text(driver, "#photoLibraryCount", "2 photos")

    assert not driver.find_element(By.ID, "photoSourceTabs").get_attribute("hidden")
    assert driver.find_element(By.ID, "photoDryerTab").get_attribute("aria-selected") == "true"
    assert driver.find_element(By.ID, "photoSourceField").get_attribute("hidden") is not None
    assert driver.find_element(By.ID, "photoGradeField").get_attribute("hidden") is not None
    assert driver.find_element(By.ID, "photoCommunityLabel").text == "Location"
    assert driver.find_element(By.ID, "photoTableWrap").get_attribute("hidden") is not None
    assert driver.find_element(By.ID, "photoGallery").get_attribute("hidden") is None
    assert driver.find_element(By.ID, "togglePhotoGallery").text == "Show list"
    assert len(driver.find_elements(By.CSS_SELECTOR, "#photoGallery .photo-library-thumbnail")) == 2

    starting_url = driver.current_url
    driver.find_elements(By.CSS_SELECTOR, "#photoGallery .photo-library-thumbnail")[0].click()
    WebDriverWait(driver, 20).until(
        lambda current: current.execute_script(
            "return Boolean(document.querySelector('dialog.record-photo-dialog')?.open)"
        )
    )
    assert driver.current_url == starting_url
    assert "Table overview" in driver.find_element(By.CSS_SELECTOR, "dialog.record-photo-dialog").text
    driver.find_element(By.CSS_SELECTOR, "[data-photo-viewer-close]").click()

    driver.find_element(By.ID, "togglePhotoGallery").click()
    WebDriverWait(driver, 20).until(
        lambda current: current.find_element(By.ID, "photoTableWrap").get_attribute("hidden") is None
    )
    assert driver.find_element(By.ID, "togglePhotoGallery").text == "Show thumbnails"
    assert "Bay 1 — Loading" in driver.find_element(By.ID, "photoLibraryRows").text

    driver.find_element(By.ID, "photoReefTab").click()
    wait_for_text(driver, "#photoLibraryCount", "1 photo")
    assert driver.find_element(By.ID, "photoReefTab").get_attribute("aria-selected") == "true"
    assert "Reef Nursery" in driver.find_element(By.ID, "photoLibraryRows").text
    assert "Mkwiro Nursery" in driver.find_element(By.ID, "photoLibraryRows").text


def run_generic_probe(driver, base_url):
    driver.get(f"{base_url}/photos.html?org=mawimbi")
    wait_for_text(driver, "#photoLibraryCount", "1 photo")
    assert driver.find_element(By.ID, "photoSourceTabs").get_attribute("hidden") is not None
    assert driver.find_element(By.ID, "photoSourceField").get_attribute("hidden") is None
    assert driver.find_element(By.ID, "photoGradeField").get_attribute("hidden") is None
    assert driver.find_element(By.ID, "photoCommunityLabel").text == "Community"
    assert driver.find_element(By.ID, "photoTableWrap").get_attribute("hidden") is None
    assert driver.find_element(By.ID, "photoGallery").get_attribute("hidden") is not None
    assert driver.find_element(By.ID, "togglePhotoGallery").text == "Show thumbnails"
    assert "Intake Collection" in driver.find_element(By.ID, "photoLibraryRows").text
    assert "Example Community" in driver.find_element(By.ID, "photoLibraryRows").text


def main():
    with tempfile.TemporaryDirectory() as directory:
        root = pathlib.Path(directory)
        prepare_site(root)
        handler = functools.partial(QuietHandler, directory=str(root))
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        options = webdriver.ChromeOptions()
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--window-size=1440,950")
        driver = webdriver.Chrome(options=options)
        try:
            base_url = f"http://127.0.0.1:{server.server_port}"
            run_cosme_probe(driver, base_url)
            run_generic_probe(driver, base_url)
            print("COSME and generic photo library UI probe: ok")
        finally:
            driver.quit()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    main()
