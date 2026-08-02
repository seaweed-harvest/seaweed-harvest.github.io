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


def add_membership(keys, user_id):
    organisation = request_json(
        "GET",
        f"{PROJECT_URL}/rest/v1/ag_aggregators"
        "?select=id,aggregator_code&aggregator_code=eq.MAWIMBI&limit=1",
        keys["service_role"],
        keys["service_role"],
    )[0]
    request_json(
        "POST",
        f"{PROJECT_URL}/rest/v1/ag_aggregator_memberships",
        keys["service_role"],
        keys["service_role"],
        {
            "aggregator_id": organisation["id"],
            "user_id": user_id,
            "membership_role": "aggregator_admin",
            "is_active": True,
        },
        "return=minimal",
    )
    return organisation["id"]


def password_session(keys, email, password):
    return request_json(
        "POST",
        f"{PROJECT_URL}/auth/v1/token?grant_type=password",
        keys["anon"],
        keys["anon"],
        {"email": email, "password": password},
    )["access_token"]


def save_payload(organisation_id, daily=False, weekly=False, monthly=False):
    return {
        "p_subscriptions": [
            {
                "aggregator_id": organisation_id,
                "daily": daily,
                "weekly": weekly,
                "monthly": monthly,
            }
        ]
    }


def main():
    keys = api_keys()
    user_id, email, password = create_admin(keys, aggregator_code="MAWIMBI")
    server, base_url = start_server()
    driver = None
    screenshots = []
    try:
        organisation_id = add_membership(keys, user_id)
        token = password_session(keys, email, password)

        initial = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_my_report_subscriptions",
            keys["anon"],
            token,
            {},
        )
        assert initial["email"] == email, initial
        assert len(initial["subscriptions"]) == 1, initial
        assert not any(
            initial["subscriptions"][0][key]
            for key in ("daily", "weekly", "monthly")
        ), initial

        saved = request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_save_my_report_subscriptions",
            keys["anon"],
            token,
            save_payload(organisation_id, True, True, True),
        )
        assert all(
            saved["subscriptions"][0][key]
            for key in ("daily", "weekly", "monthly")
        ), saved

        request_json(
            "POST",
            f"{PROJECT_URL}/rest/v1/rpc/ag_save_my_report_subscriptions",
            keys["anon"],
            token,
            save_payload(organisation_id),
        )

        options = webdriver.ChromeOptions()
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--window-size=1440,1000")
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        driver = webdriver.Chrome(options=options)
        wait = WebDriverWait(driver, 30)

        driver.get(f"{base_url}/login.html?return=report_subscriptions.html")
        wait.until(lambda current: current.find_element(By.ID, "loginPanel").is_displayed())
        driver.find_element(By.ID, "loginEmail").send_keys(email)
        driver.find_element(By.ID, "loginPassword").send_keys(password)
        driver.find_element(By.CSS_SELECTOR, "#loginForm button[type='submit']").click()
        wait.until(lambda current: "report_subscriptions.html" in current.current_url)
        wait.until(
            lambda current: len(current.find_elements(By.CSS_SELECTOR, "[data-report-type]")) == 3
        )

        controls = driver.find_elements(By.CSS_SELECTOR, "[data-report-type]")
        assert not any(control.is_selected() for control in controls)
        driver.find_element(By.CSS_SELECTOR, '[data-report-type="daily"]').click()
        driver.find_element(By.CSS_SELECTOR, '[data-report-type="weekly"]').click()
        driver.find_element(By.ID, "saveReportSubscriptions").click()
        wait.until(
            lambda current: "Subscriptions saved" in current.find_element(
                By.ID, "reportSubscriptionsStatus"
            ).text
        )
        assert driver.find_element(By.ID, "reportSubscriptionsCount").text == "2 enabled"

        metrics = driver.execute_script(
            """
            const panel = document.querySelector('.report-subscriptions-panel');
            const options = [...document.querySelectorAll('.report-subscription-option')];
            return {
              viewport: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              panelPadding: parseFloat(getComputedStyle(panel).paddingLeft),
              optionHeights: options.map((option) => option.getBoundingClientRect().height),
              columns: getComputedStyle(document.querySelector('.report-subscription-options')).gridTemplateColumns
            };
            """
        )
        assert metrics["scrollWidth"] <= metrics["viewport"] + 1, metrics
        assert metrics["panelPadding"] >= 16, metrics
        assert max(metrics["optionHeights"]) <= 70, metrics
        assert len(metrics["columns"].split()) == 3, metrics
        desktop_path = pathlib.Path(tempfile.gettempdir()) / "report-subscriptions-desktop.png"
        driver.save_screenshot(str(desktop_path))
        screenshots.append(str(desktop_path))

        driver.set_window_size(390, 844)
        driver.get(f"{base_url}/report_subscriptions.html")
        wait.until(
            lambda current: current.find_element(By.ID, "reportSubscriptionsCount").text == "2 enabled"
        )
        mobile_metrics = driver.execute_script(
            """
            return {
              viewport: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              columns: getComputedStyle(document.querySelector('.report-subscription-options')).gridTemplateColumns,
              actionWidth: document.querySelector('.report-subscription-actions').getBoundingClientRect().width
            };
            """
        )
        assert mobile_metrics["scrollWidth"] <= mobile_metrics["viewport"] + 1, mobile_metrics
        assert len(mobile_metrics["columns"].split()) == 1, mobile_metrics
        mobile_path = pathlib.Path(tempfile.gettempdir()) / "report-subscriptions-mobile.png"
        driver.save_screenshot(str(mobile_path))
        screenshots.append(str(mobile_path))

        driver.find_element(By.ID, "stopAllReportSubscriptions").click()
        driver.switch_to.alert.accept()
        wait.until(
            lambda current: "All report emails stopped" in current.find_element(
                By.ID, "reportSubscriptionsStatus"
            ).text
        )
        assert driver.find_element(By.ID, "reportSubscriptionsCount").text == "0 enabled"

        severe = [
            entry for entry in driver.get_log("browser")
            if entry.get("level") == "SEVERE"
            and "favicon" not in entry.get("message", "").lower()
        ]
        assert not severe, severe
        print("PASS: report subscriptions live API and responsive UI probe")
        print(json.dumps({"desktop": metrics, "mobile": mobile_metrics, "screenshots": screenshots}, indent=2))
    finally:
        if driver:
            driver.quit()
        server.shutdown()
        server.server_close()
        cleanup(keys, user_id)


if __name__ == "__main__":
    main()
