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
        wait.until(lambda current: (
            "records.html" in current.current_url
            and "view=container" in current.current_url
        ))
        wait.until(lambda current: current.find_element(
            By.ID, "containerLookupWorkspace"
        ).is_displayed())
        assert not driver.find_elements(
            By.XPATH,
            '//*[@id="recordsSidebar"]//a[normalize-space()="Container Lookup"]',
        )
        wait.until(
            lambda current: current.find_element(
                By.ID, "containerLookupContainerCount"
            ).text == "2 containers"
        )
        groups = driver.find_elements(By.CSS_SELECTOR, ".container-lookup-group-row")
        assert len(groups) == 2, [group.text for group in groups]
        assert groups[0].text.startswith("Container 0001"), groups[0].text
        assert groups[1].text.startswith("Container 0002"), groups[1].text
        for expected in (
            "Spinosum",
            "22 L",
            "22g Sodium benzoate; 8g Citric acid",
            "33.3 - 33.4 ppt",
            "4.08 - 4.12",
            "53.9 - 54.1",
        ):
            assert expected in groups[0].text, (expected, groups[0].text)
        detail_rows = driver.find_elements(By.CSS_SELECTOR, ".container-lookup-detail-row")
        assert detail_rows and not any(row.is_displayed() for row in detail_rows)
        first_toggle = groups[0].find_element(
            By.CSS_SELECTOR, "[data-container-group-toggle]"
        )
        assert first_toggle.get_attribute("aria-expanded") == "false"
        collapsed_marker = driver.execute_script(
            "return getComputedStyle(arguments[0], '::before').content;",
            first_toggle,
        )
        assert ">" in collapsed_marker, collapsed_marker
        group_value = groups[0].find_elements(By.TAG_NAME, "td")[2]
        group_style = driver.execute_script(
            """
            const style = getComputedStyle(arguments[0]);
            return { color: style.color, weight: Number(style.fontWeight) };
            """,
            group_value,
        )
        assert group_style["weight"] >= 600, group_style
        first_toggle.click()
        wait.until(
            lambda current: current.find_element(
                By.CSS_SELECTOR, '[data-container-group-toggle="1"]'
            ).get_attribute("aria-expanded") == "true"
        )
        visible_details = [
            row for row in driver.find_elements(
                By.CSS_SELECTOR, '[data-container-detail="1"]'
            )
            if row.is_displayed()
        ]
        assert len(visible_details) == 2, [row.text for row in visible_details]
        assert any("Retest" in row.text for row in visible_details)
        detail_style = driver.execute_script(
            """
            const style = getComputedStyle(arguments[0]);
            return { color: style.color, weight: Number(style.fontWeight) };
            """,
            visible_details[0].find_elements(By.TAG_NAME, "td")[3],
        )
        assert detail_style["weight"] < group_style["weight"], (group_style, detail_style)
        assert detail_style["color"] == group_style["color"], (group_style, detail_style)
        assert driver.find_element(By.ID, "formLedgerCategories").is_displayed()
        assert driver.find_element(
            By.CSS_SELECTOR, '[data-ledger-category="stock"]'
        ).get_attribute("aria-selected") == "true"
        active_lookup_tab = driver.find_element(By.ID, "recordContainerLookupTab")
        assert active_lookup_tab.is_displayed()
        assert active_lookup_tab.get_attribute("aria-selected") == "true"
        assert not driver.find_element(By.ID, "recordCommunityTab").is_displayed()

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

        layout = driver.execute_script(
            """
            const wrap = document.querySelector('.container-lookup-table-wrap');
            const table = document.querySelector('.container-lookup-table');
            return {
              viewport: document.documentElement.clientWidth,
              pageWidth: document.documentElement.scrollWidth,
              wrapWidth: Math.round(wrap.getBoundingClientRect().width),
              tableWidth: Math.round(table.getBoundingClientRect().width),
              groups: document.querySelectorAll('.container-lookup-group-row').length,
              visibleDetails: [...document.querySelectorAll('.container-lookup-detail-row')]
                .filter((row) => !row.hidden).length
            };
            """
        )
        assert layout["pageWidth"] <= layout["viewport"] + 1, layout
        assert layout["tableWidth"] > layout["wrapWidth"], layout
        assert layout["groups"] == 2, layout

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
            "layout": layout,
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
