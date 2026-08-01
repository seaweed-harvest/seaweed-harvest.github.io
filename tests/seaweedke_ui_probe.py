import contextlib
import functools
import http.server
import json
import pathlib
import re
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJECT_REF = "wwzmajhdusfyfskppupg"
PROJECT_URL = f"https://{PROJECT_REF}.supabase.co"


def api_keys():
    result = subprocess.run(
        ["supabase", "projects", "api-keys", "--project-ref", PROJECT_REF, "--output", "json"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    rows = json.loads(result.stdout)
    return {
        row["name"]: row["api_key"]
        for row in rows
        if row.get("type") == "legacy" and row.get("name") in {"anon", "service_role"}
    }


def request_json(method, url, api_key, token, body=None, prefer=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"apikey": api_key, "Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
    if prefer:
        headers["Prefer"] = prefer
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload) if payload else None


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        return


class QuietThreadingHTTPServer(http.server.ThreadingHTTPServer):
    def handle_error(self, _request, _client_address):
        # Chrome may close speculative connections before the local server replies.
        return


def start_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = QuietThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_port}"


def create_admin(keys, aggregator_code="BATI"):
    suffix = str(int(time.time() * 1000))
    email = f"codex.seaweedke.ui.{suffix}@example.com"
    password = f"SeaweedUi!{suffix}Aa9"
    user = request_json(
        "POST",
        f"{PROJECT_URL}/auth/v1/admin/users",
        keys["service_role"],
        keys["service_role"],
        {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": "SEAWEEDKE UI Probe"},
        },
    )
    aggregator = request_json(
        "GET",
        f"{PROJECT_URL}/rest/v1/ag_aggregators"
        f"?select=id&aggregator_code=eq.{aggregator_code}&limit=1",
        keys["service_role"],
        keys["service_role"],
    )[0]
    request_json(
        "PATCH",
        f"{PROJECT_URL}/rest/v1/ag_user_profiles?id=eq.{user['id']}",
        keys["service_role"],
        keys["service_role"],
        {
            "email": email,
            "display_name": "SEAWEEDKE UI Probe",
            "app_role": "system_admin",
            "account_status": "active",
            "active_aggregator_id": aggregator["id"],
            "can_access_admin": True,
            "can_view_dashboard": True,
            "can_view_data": True,
            "can_manage_settings": True,
            "can_view_notifications": True,
            "can_manage_notifications": True,
            "can_manage_sms_settings": True,
        },
        "return=minimal",
    )
    return user["id"], email, password


def add_cosme_membership(keys, user_id):
    cosme = request_json(
        "GET",
        f"{PROJECT_URL}/rest/v1/ag_aggregators?select=id&aggregator_code=eq.COSME&limit=1",
        keys["service_role"],
        keys["service_role"],
    )[0]
    request_json(
        "POST",
        f"{PROJECT_URL}/rest/v1/ag_aggregator_memberships",
        keys["service_role"],
        keys["service_role"],
        {
            "aggregator_id": cosme["id"],
            "user_id": user_id,
            "membership_role": "aggregator_admin",
            "is_active": True,
        },
        "return=minimal",
    )
    return cosme["id"]


def cleanup(keys, user_id):
    with contextlib.suppress(Exception):
        requests = request_json(
            "GET",
            f"{PROJECT_URL}/rest/v1/seaweedke_notification_requests?select=id&created_by=eq.{user_id}",
            keys["service_role"],
            keys["service_role"],
        ) or []
        for row in requests:
            request_id = row["id"]
            for table in ("seaweedke_status_events", "seaweedke_delivery_attempts"):
                with contextlib.suppress(Exception):
                    request_json(
                        "DELETE",
                        f"{PROJECT_URL}/rest/v1/{table}?notification_request_id=eq.{request_id}",
                        keys["service_role"],
                        keys["service_role"],
                    )
            with contextlib.suppress(Exception):
                request_json(
                    "DELETE",
                    f"{PROJECT_URL}/rest/v1/seaweedke_notification_requests?id=eq.{request_id}",
                    keys["service_role"],
                    keys["service_role"],
                )
    with contextlib.suppress(Exception):
        request_json(
            "DELETE",
            f"{PROJECT_URL}/auth/v1/admin/users/{user_id}",
            keys["service_role"],
            keys["service_role"],
        )


def wait_text(driver, element_id, pattern, timeout=20):
    WebDriverWait(driver, timeout).until(
        lambda current: pattern in current.find_element(By.ID, element_id).text
    )
    return driver.find_element(By.ID, element_id).text


def page_metrics(driver):
    return driver.execute_script(
        """
        const sidebar = document.querySelector('.admin-sidebar');
        const content = document.querySelector('.admin-content');
        const rows = [...document.querySelectorAll('.notification-table tbody tr')];
        const visible = (el) => el && !el.hidden && getComputedStyle(el).display !== 'none';
        const sr = visible(sidebar) ? sidebar.getBoundingClientRect() : null;
        const cr = visible(content) ? content.getBoundingClientRect() : null;
        return {
          viewport: [document.documentElement.clientWidth, document.documentElement.clientHeight],
          globalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          sidebarContentOverlap: Boolean(sr && cr && sr.right > cr.left + 1 && sr.left < cr.right && sr.bottom > cr.top + 1 && sr.top < cr.bottom),
          maxRowHeight: rows.length ? Math.max(...rows.map((row) => row.getBoundingClientRect().height)) : 0,
          tableScrollsInside: (() => {
            const wrap = document.querySelector('.notification-table-wrap');
            return !wrap || wrap.scrollWidth >= wrap.clientWidth;
          })()
        };
        """
    )


def main():
    keys = api_keys()
    user_id, email, password = create_admin(keys)
    server, base_url = start_server()
    driver = None
    screenshots = []
    try:
        options = webdriver.ChromeOptions()
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--window-size=1440,1000")
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        driver = webdriver.Chrome(options=options)
        wait = WebDriverWait(driver, 25)

        driver.get(f"{base_url}/login.html")
        driver.find_element(By.ID, "loginEmail").send_keys(email)
        driver.find_element(By.ID, "loginPassword").send_keys(password)
        driver.find_element(By.CSS_SELECTOR, "#loginForm button[type='submit']").click()
        wait.until(lambda current: "home.html" in current.current_url)

        driver.get(f"{base_url}/admin_notifications.html")
        wait.until(lambda current: "rows loaded" in current.find_element(By.ID, "notificationStatusText").text)
        desktop_metrics = page_metrics(driver)
        if desktop_metrics["globalOverflow"] > 2:
            raise AssertionError(f"Notifications page has global desktop overflow: {desktop_metrics}")
        if desktop_metrics["sidebarContentOverlap"]:
            raise AssertionError(f"Sidebar overlaps notification content: {desktop_metrics}")
        if desktop_metrics["maxRowHeight"] > 55:
            raise AssertionError(f"Notification table rows wrap vertically: {desktop_metrics}")
        desktop_path = pathlib.Path(tempfile.gettempdir()) / "seaweedke-notifications-desktop.png"
        driver.save_screenshot(str(desktop_path))
        screenshots.append(str(desktop_path))

        driver.get(f"{base_url}/admin_seaweedke.html")
        try:
            wait.until(lambda current: current.find_element(By.ID, "smsMode").text not in {"", "--"})
        except TimeoutException as error:
            diagnostic = {
                "url": driver.current_url,
                "mode": driver.find_element(By.ID, "smsMode").text if driver.find_elements(By.ID, "smsMode") else None,
                "readiness": driver.find_element(By.ID, "smsReadinessStatus").text if driver.find_elements(By.ID, "smsReadinessStatus") else None,
                "console": driver.get_log("browser"),
            }
            raise AssertionError(f"SEAWEEDKE settings did not load: {diagnostic}") from error
        if driver.find_element(By.ID, "smsEnabled").text != "Disabled":
            raise AssertionError("SEAWEEDKE UI did not report disabled sending")
        driver.find_element(By.ID, "smsTestPhone").send_keys("0712 345 678")
        driver.find_element(By.CSS_SELECTOR, "#smsTestForm button[type='submit']").click()
        test_status = wait_text(driver, "smsTestStatus", "Request")
        if not re.search(r"[0-9a-f]{8}-[0-9a-f-]{27,}", test_status, re.I):
            raise AssertionError(f"Fake test did not return a request ID: {test_status}")
        tools_path = pathlib.Path(tempfile.gettempdir()) / "seaweedke-tools-desktop.png"
        driver.save_screenshot(str(tools_path))
        screenshots.append(str(tools_path))

        driver.get(f"{base_url}/admin_users.html")
        wait.until(lambda current: len(current.find_elements(By.CSS_SELECTOR, "#invitePermissions .permission-option")) >= 18)
        permission_labels = {
            element.text.strip()
            for element in driver.find_elements(By.CSS_SELECTOR, "#invitePermissions .permission-option")
        }
        for expected in {"Manage pricing", "Configure SMS settings", "View recent activity"}:
            if expected not in permission_labels:
                raise AssertionError(f"Users page is missing permission: {expected}")
        activity_rows = driver.find_elements(By.CSS_SELECTOR, "#userActivityRows tr")
        if len(activity_rows) > 20:
            raise AssertionError(f"Recent Activity rendered {len(activity_rows)} rows")
        users_metrics = page_metrics(driver)
        if users_metrics["globalOverflow"] > 2 or users_metrics["sidebarContentOverlap"]:
            raise AssertionError(f"Users permissions layout is not contained: {users_metrics}")
        users_path = pathlib.Path(tempfile.gettempdir()) / "permissions-users-desktop.png"
        driver.save_screenshot(str(users_path))
        screenshots.append(str(users_path))

        driver.set_window_size(390, 844)
        driver.get(f"{base_url}/admin_notifications.html")
        wait.until(lambda current: "rows loaded" in current.find_element(By.ID, "notificationStatusText").text)
        toggle = driver.find_element(By.CSS_SELECTOR, ".admin-sidebar-toggle")
        if toggle.text == "Unpin":
            toggle.click()
            wait.until(lambda current: "admin-sidebar-unpinned" in current.find_element(By.CSS_SELECTOR, ".admin-layout").get_attribute("class"))
        mobile_metrics = page_metrics(driver)
        if mobile_metrics["globalOverflow"] > 2:
            raise AssertionError(f"Notifications page has global mobile overflow: {mobile_metrics}")
        mobile_path = pathlib.Path(tempfile.gettempdir()) / "seaweedke-notifications-mobile.png"
        driver.save_screenshot(str(mobile_path))
        screenshots.append(str(mobile_path))

        severe_logs = [
            entry for entry in driver.get_log("browser")
            if entry.get("level") == "SEVERE" and "favicon" not in entry.get("message", "").lower()
        ]
        if severe_logs:
            raise AssertionError(f"Browser console errors: {severe_logs}")

        print("PASS: SEAWEEDKE authenticated desktop/mobile UI probe")
        print(json.dumps({"desktop": desktop_metrics, "users": users_metrics, "mobile": mobile_metrics, "screenshots": screenshots}, indent=2))
    finally:
        if driver:
            driver.quit()
        server.shutdown()
        server.server_close()
        cleanup(keys, user_id)


if __name__ == "__main__":
    main()
