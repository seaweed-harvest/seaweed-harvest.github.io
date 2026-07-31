import json
import pathlib
import tempfile

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from seaweedke_ui_probe import (
    PROJECT_URL,
    api_keys,
    cleanup,
    create_admin,
    request_json,
    start_server,
)


def main():
    keys = api_keys()
    user_id, email, password = create_admin(keys)
    server = None
    driver = None
    screenshots = []
    try:
        mawimbi = request_json(
            "GET",
            (
                f"{PROJECT_URL}/rest/v1/ag_aggregators"
                "?select=id&aggregator_code=eq.MAWIMBI&limit=1"
            ),
            keys["service_role"],
            keys["service_role"],
        )[0]
        request_json(
            "PATCH",
            f"{PROJECT_URL}/rest/v1/ag_user_profiles?id=eq.{user_id}",
            keys["service_role"],
            keys["service_role"],
            {"active_aggregator_id": mawimbi["id"]},
            "return=minimal",
        )
        session = request_json(
            "POST",
            f"{PROJECT_URL}/auth/v1/token?grant_type=password",
            keys["anon"],
            keys["anon"],
            {"email": email, "password": password},
        )
        result = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_stock_container_lookup",
            keys["anon"],
            session["access_token"],
            {
                "p_containers": "1,0002",
                "p_start_date": None,
                "p_end_date": None,
                "p_result_limit": 2000,
            },
        )
        assert result["container_count"] == 2, result
        assert {row["container_key"] for row in result["rows"]} == {"1", "2"}, result
        assert all(row["carton_serial"] for row in result["rows"]), result
        exact_day = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_stock_container_lookup",
            keys["anon"],
            session["access_token"],
            {
                "p_containers": "0001",
                "p_start_date": "2026-07-29",
                "p_end_date": None,
                "p_result_limit": 2000,
            },
        )
        assert exact_day["record_count"] == 1, exact_day
        assert exact_day["rows"][0]["record_date"] == "2026-07-29", exact_day

        server, base_url = start_server()
        options = webdriver.ChromeOptions()
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--window-size=1440,950")
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        driver = webdriver.Chrome(options=options)
        wait = WebDriverWait(driver, 30)

        driver.get(f"{base_url}/login.html")
        wait.until(lambda current: current.find_element(By.ID, "loginEmail").is_displayed())
        driver.find_element(By.ID, "loginEmail").send_keys(email)
        driver.find_element(By.ID, "loginPassword").send_keys(password)
        driver.find_element(By.CSS_SELECTOR, "#loginForm button[type='submit']").click()
        wait.until(lambda current: "home.html" in current.current_url)

        driver.get(f"{base_url}/container_lookup.html?containers=1,0002")
        wait.until(
            lambda current: current.find_element(
                By.ID, "containerLookupContainerCount"
            ).text == "2 containers"
        )
        groups = driver.find_elements(By.CSS_SELECTOR, ".container-lookup-group-row")
        assert len(groups) == 2, [group.text for group in groups]
        assert groups[0].text.startswith("Container 0001"), groups[0].text
        assert groups[1].text.startswith("Container 0002"), groups[1].text
        assert driver.find_element(By.ID, "containerLookupRows").text.count("Retest") >= 2
        assert driver.find_element(By.LINK_TEXT, "Container Lookup").is_displayed()

        date_sort = driver.find_element(
            By.CSS_SELECTOR, '[data-container-sort="record_date"]'
        )
        date_sort.click()
        assert date_sort.find_element(By.XPATH, "..").get_attribute("aria-sort") == "ascending"
        date_sort.click()
        assert date_sort.find_element(By.XPATH, "..").get_attribute("aria-sort") == "descending"

        desktop = pathlib.Path(tempfile.gettempdir()) / "container-lookup-desktop.png"
        driver.save_screenshot(str(desktop))
        screenshots.append(desktop)

        driver.set_window_size(390, 844)
        driver.get(f"{base_url}/container_lookup.html?containers=1,0002")
        wait.until(
            lambda current: current.find_element(
                By.ID, "containerLookupContainerCount"
            ).text == "2 containers"
        )
        mobile = driver.execute_script(
            """
            const wrap = document.querySelector('.container-lookup-table-wrap');
            const table = document.querySelector('.container-lookup-table');
            return {
              viewport: document.documentElement.clientWidth,
              pageWidth: document.documentElement.scrollWidth,
              wrapWidth: Math.round(wrap.getBoundingClientRect().width),
              tableWidth: Math.round(table.getBoundingClientRect().width),
              rows: document.querySelectorAll('#containerLookupRows tr:not(.container-lookup-group-row)').length
            };
            """
        )
        assert mobile["pageWidth"] <= mobile["viewport"] + 1, mobile
        assert mobile["tableWidth"] > mobile["wrapWidth"], mobile
        assert mobile["rows"] == len(result["rows"]), mobile

        mobile_shot = pathlib.Path(tempfile.gettempdir()) / "container-lookup-mobile.png"
        driver.save_screenshot(str(mobile_shot))
        screenshots.append(mobile_shot)

        severe_logs = [
            entry for entry in driver.get_log("browser")
            if entry.get("level") == "SEVERE"
            and "favicon" not in entry.get("message", "").lower()
        ]
        assert not severe_logs, severe_logs
        print(json.dumps({
            "status": "ok",
            "api": {
                "containers": result["container_count"],
                "records": result["record_count"],
            },
            "mobile": mobile,
            "screenshots": [str(path) for path in screenshots],
        }, indent=2))
    finally:
        if driver:
            driver.quit()
        if server:
            server.shutdown()
            server.server_close()
        cleanup(keys, user_id)


if __name__ == "__main__":
    main()
