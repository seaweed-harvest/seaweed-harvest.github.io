import pathlib
import tempfile

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait

from seaweedke_ui_probe import (
    PROJECT_URL,
    add_cosme_membership,
    api_keys,
    cleanup,
    create_admin,
    request_json,
    start_server,
)


def main():
    keys = api_keys()
    user_id, email, password = create_admin(keys)
    server, base_url = start_server()
    driver = None
    screenshots = []
    try:
        cosme_id = add_cosme_membership(keys, user_id)
        request_json(
            "PATCH",
            f"{PROJECT_URL}/rest/v1/ag_user_profiles?id=eq.{user_id}",
            keys["service_role"],
            keys["service_role"],
            {
                "active_aggregator_id": cosme_id,
                "can_manage_settings": True,
            },
            "return=minimal",
        )

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

        driver.get(f"{base_url}/admin_forms.html")
        wait.until(
            lambda current: current.find_element(
                By.TAG_NAME, "body"
            ).get_attribute("data-auth-pending") is None
        )
        wait.until(
            lambda current: len(current.find_elements(
                By.CSS_SELECTOR, ".form-manager-row"
            )) >= 2
        )

        rows = driver.find_elements(By.CSS_SELECTOR, ".form-manager-row")
        names = [
            row.find_element(By.CSS_SELECTOR, "h3").text.strip()
            for row in rows
        ]
        assert names == ["Reef Nursery", "Dryer Table"], names

        reef_row = next(
            row for row in rows
            if row.find_element(By.CSS_SELECTOR, "h3").text.strip() == "Reef Nursery"
        )
        reef_access = Select(reef_row.find_element(By.CSS_SELECTOR, "[data-form-access]"))
        assert [option.text for option in reef_access.options] == [
            "Private", "Review link", "Paused"
        ]
        assert reef_row.find_element(
            By.CSS_SELECTOR, ".form-manager-records strong"
        ).text == "Private"
        reef_access.select_by_value("review")
        assert "is-dirty" in reef_row.get_attribute("class")
        assert reef_row.find_element(
            By.CSS_SELECTOR, '[data-form-action="save"]'
        ).is_enabled()

        desktop_metrics = driver.execute_script(
            """
            const panel = document.querySelector('.form-manager-panel');
            const title = panel.querySelector('h2');
            return {
              width: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              leftPadding: parseFloat(getComputedStyle(panel).paddingLeft),
              rightPadding: parseFloat(getComputedStyle(panel).paddingRight),
              titleSize: parseFloat(getComputedStyle(title).fontSize)
            };
            """
        )
        assert desktop_metrics["scrollWidth"] <= desktop_metrics["width"] + 1, desktop_metrics
        assert desktop_metrics["leftPadding"] >= 14, desktop_metrics
        assert desktop_metrics["rightPadding"] >= 14, desktop_metrics
        desktop = pathlib.Path(tempfile.gettempdir()) / "form-manager-desktop.png"
        driver.save_screenshot(str(desktop))
        screenshots.append(desktop)

        driver.set_window_size(390, 844)
        driver.get(f"{base_url}/admin_forms.html")
        wait.until(
            lambda current: len(current.find_elements(
                By.CSS_SELECTOR, ".form-manager-row"
            )) >= 2
        )
        mobile_metrics = driver.execute_script(
            """
            return {
              width: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              columns: getComputedStyle(
                document.querySelector('.form-manager-row')
              ).gridTemplateColumns
            };
            """
        )
        assert mobile_metrics["scrollWidth"] <= mobile_metrics["width"] + 1, mobile_metrics
        assert " " not in mobile_metrics["columns"].strip(), mobile_metrics
        mobile = pathlib.Path(tempfile.gettempdir()) / "form-manager-mobile.png"
        driver.save_screenshot(str(mobile))
        screenshots.append(mobile)

        browser_errors = [
            entry for entry in driver.get_log("browser")
            if entry.get("level") == "SEVERE"
            and "favicon" not in entry.get("message", "").lower()
        ]
        assert not browser_errors, browser_errors
        print("PASS: Form Manager desktop and mobile layouts")
        for screenshot in screenshots:
            print(screenshot)
    finally:
        if driver:
            driver.quit()
        server.shutdown()
        server.server_close()
        cleanup(keys, user_id)


if __name__ == "__main__":
    main()
