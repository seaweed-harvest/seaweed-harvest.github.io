import json
import pathlib
import tempfile

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from seaweedke_ui_probe import api_keys, cleanup, create_admin, start_server


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
        wait = WebDriverWait(driver, 30)

        driver.get(f"{base_url}/login.html")
        wait.until(lambda current: current.find_element(By.ID, "loginEmail").is_displayed())
        driver.find_element(By.ID, "loginEmail").send_keys(email)
        driver.find_element(By.ID, "loginPassword").send_keys(password)
        driver.find_element(By.CSS_SELECTOR, "#loginForm button[type='submit']").click()
        wait.until(lambda current: "home.html" in current.current_url)

        driver.get(f"{base_url}/records.html?category=process&view=monthly")
        wait.until(lambda current: len(current.find_elements(
            By.CSS_SELECTOR, "#formLedgerCalendar .collection-calendar-month"
        )) == 4)
        assert not driver.find_element(By.ID, "formLedgerCommunityTab").is_displayed()
        heading_layout = driver.execute_script(
            """
            const heading = document.querySelector(".form-ledger-heading").getBoundingClientRect();
            const tabs = document.getElementById("formLedgerCategories").getBoundingClientRect();
            return {
              headingTop: Math.round(heading.top),
              tabsTop: Math.round(tabs.top),
              tabsRight: Math.round(tabs.right),
              panelRight: Math.round(document.querySelector(".form-ledger-panel").getBoundingClientRect().right)
            };
            """
        )
        assert abs(heading_layout["tabsRight"] - heading_layout["panelRight"]) <= 24, heading_layout

        driver.find_element(By.CSS_SELECTOR, '[data-ledger-category="stock"]').click()
        wait.until(lambda current: "Stock records" in current.find_element(
            By.ID, "formLedgerMonthlyTitle"
        ).text)
        wait.until(lambda current: len(current.find_elements(
            By.CSS_SELECTOR, "#formLedgerMonthlyMetrics .form-ledger-metric"
        )) == 6)
        wait.until(lambda current: current.find_element(
            By.ID, "loadFormLedgerMonthly"
        ).is_enabled())
        assert driver.find_element(By.ID, "formLedgerStatus").text == ""

        driver.find_element(By.CSS_SELECTOR, '[data-ledger-category="site_sample"]').click()
        wait.until(lambda current: current.find_element(
            By.ID, "formLedgerCommunityTab"
        ).is_displayed())
        wait.until(lambda current: current.find_element(
            By.ID, "loadFormLedgerMonthly"
        ).is_enabled())
        driver.find_element(By.ID, "formLedgerCommunityTab").click()
        wait.until(lambda current: current.find_element(
            By.ID, "formLedgerCommunityPanel"
        ).is_displayed())
        wait.until(lambda current: len(current.find_elements(
            By.CSS_SELECTOR, "#formLedgerCommunityMetrics .form-ledger-metric"
        )) == 6)
        wait.until(lambda current: current.find_element(
            By.ID, "loadFormLedgerCommunity"
        ).is_enabled())
        assert driver.find_element(By.ID, "formLedgerStatus").text == ""

        desktop = pathlib.Path(tempfile.gettempdir()) / "form-record-reporting-desktop.png"
        driver.save_screenshot(str(desktop))
        screenshots.append(desktop)

        driver.set_window_size(390, 844)
        driver.get(f"{base_url}/records.html?category=site_sample&view=monthly")
        wait.until(lambda current: len(current.find_elements(
            By.CSS_SELECTOR, "#formLedgerCalendar .collection-calendar-month"
        )) == 4)
        mobile = driver.execute_script(
            """
            const tabs = document.getElementById("formLedgerCategories");
            return {
              viewport: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              tabClientWidth: tabs.clientWidth,
              tabScrollWidth: tabs.scrollWidth,
              months: document.querySelectorAll("#formLedgerCalendar .collection-calendar-month").length
            };
            """
        )
        assert mobile["scrollWidth"] <= mobile["viewport"] + 1, mobile
        assert mobile["tabScrollWidth"] >= mobile["tabClientWidth"], mobile
        assert mobile["months"] == 4, mobile

        mobile_shot = pathlib.Path(tempfile.gettempdir()) / "form-record-reporting-mobile.png"
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
            "heading": heading_layout,
            "mobile": mobile,
            "screenshots": [str(path) for path in screenshots],
        }, indent=2))
    finally:
        if driver:
            driver.quit()
        server.shutdown()
        server.server_close()
        cleanup(keys, user_id)


if __name__ == "__main__":
    main()
