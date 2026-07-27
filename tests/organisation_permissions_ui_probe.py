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
                "can_manage_users": True,
                "can_manage_settings": True,
                "can_manage_organisation_permissions": True,
                "can_submit_collection": True,
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
        wait.until(
            lambda current: current.find_element(By.ID, "loginPanel").is_displayed()
        )
        driver.find_element(By.ID, "loginEmail").send_keys(email)
        driver.find_element(By.ID, "loginPassword").send_keys(password)
        driver.find_element(By.CSS_SELECTOR, "#loginForm button[type='submit']").click()
        wait.until(lambda current: "home.html" in current.current_url)
        wait.until(
            lambda current: current.find_elements(
                By.CSS_SELECTOR, '[data-menu-group="forms"]'
            )
        )

        form_labels = driver.execute_script(
            """
            const group = document.querySelector('[data-menu-group="forms"]');
            return [...group.querySelectorAll('a')].map((link) => link.textContent.trim());
            """
        )
        assert form_labels == ["Reef Nursery", "Dryer Table"], form_labels
        assert not any(
            link.is_displayed()
            for link in driver.find_elements(
                By.CSS_SELECTOR, '[data-menu-group="forms"] a[href="./collection.html"]'
            )
        )

        driver.get(f"{base_url}/admin_users.html")
        wait.until(
            lambda current: current.find_element(
                By.ID, "organisationPermissionsSelect"
            ).get_attribute("value") == cosme_id
        )
        assert driver.find_element(
            By.ID, "organisationPermissionsWorkspace"
        ).is_displayed()
        assert not driver.find_element(By.ID, "userPermissionsWorkspace").is_displayed()

        capability_state = driver.execute_script(
            """
            return Object.fromEntries(
              [...document.querySelectorAll('[data-organisation-capability]')]
                .map((input) => [input.dataset.organisationCapability, input.checked])
            );
            """
        )
        for key in (
            "form_site_water_samples",
            "form_intake_collection",
            "form_stock_record",
            "form_process_record",
        ):
            assert capability_state[key] is False, (key, capability_state)
        assert capability_state["form_reef_nursery"] is True
        assert capability_state["form_dryer_table"] is True
        assert capability_state["form_green_space"] is False

        organisation_options = driver.execute_script(
            """
            return [...document.querySelectorAll('#organisationPermissionsSelect option')]
              .map((option) => ({ value: option.value, label: option.textContent.trim() }));
            """
        )
        assert len(organisation_options) > 1, organisation_options
        sandbox = next(
            option for option in organisation_options
            if option["label"].startswith("SANDBOX -")
        )
        Select(
            driver.find_element(By.ID, "organisationPermissionsSelect")
        ).select_by_value(sandbox["value"])
        wait.until(
            lambda current: current.execute_script(
                """
                return document.querySelector(
                  '[data-organisation-capability="form_green_space"]'
                )?.checked === true;
                """
            )
        )
        sandbox_state = driver.execute_script(
            """
            return Object.fromEntries(
              [...document.querySelectorAll('[data-organisation-capability]')]
                .map((input) => [input.dataset.organisationCapability, input.checked])
            );
            """
        )
        assert sandbox_state["form_green_space"] is True
        for key in (
            "form_site_water_samples",
            "form_intake_collection",
            "form_stock_record",
            "form_process_record",
            "form_reef_nursery",
            "form_dryer_table",
        ):
            assert sandbox_state[key] is False, (key, sandbox_state)

        organisation_layout = driver.execute_script(
            """
            const workspace = document.querySelector('#organisationPermissionsWorkspace');
            const panel = workspace.querySelector(':scope > .panel');
            const styles = getComputedStyle(panel);
            const title = panel.querySelector('h2');
            const option = panel.querySelector('.organisation-capability-copy strong');
            return {
              paddingLeft: parseFloat(styles.paddingLeft),
              paddingRight: parseFloat(styles.paddingRight),
              titleSize: parseFloat(getComputedStyle(title).fontSize),
              optionSize: parseFloat(getComputedStyle(option).fontSize),
              panelLeft: panel.getBoundingClientRect().left,
              contentLeft: title.getBoundingClientRect().left
            };
            """
        )
        assert organisation_layout["paddingLeft"] >= 14, organisation_layout
        assert organisation_layout["paddingRight"] >= 14, organisation_layout
        assert organisation_layout["contentLeft"] - organisation_layout["panelLeft"] >= 14, organisation_layout
        assert organisation_layout["optionSize"] <= organisation_layout["titleSize"], organisation_layout

        organisation_path = pathlib.Path(
            tempfile.gettempdir()
        ) / "organisation-permissions-desktop.png"
        driver.save_screenshot(str(organisation_path))
        screenshots.append(str(organisation_path))

        driver.find_element(By.ID, "userPermissionsTab").click()
        wait.until(
            lambda current: current.find_element(
                By.ID, "userPermissionsWorkspace"
            ).is_displayed()
        )
        assert driver.find_element(By.ID, "userDirectoryRows").is_displayed()
        users_layout = driver.execute_script(
            """
            const panel = document.querySelector('#userPermissionsWorkspace > .panel');
            const styles = getComputedStyle(panel);
            const heading = panel.querySelector('h2');
            return {
              paddingLeft: parseFloat(styles.paddingLeft),
              paddingRight: parseFloat(styles.paddingRight),
              panelLeft: panel.getBoundingClientRect().left,
              headingLeft: heading.getBoundingClientRect().left
            };
            """
        )
        assert users_layout["paddingLeft"] >= 14, users_layout
        assert users_layout["paddingRight"] >= 14, users_layout
        assert users_layout["headingLeft"] - users_layout["panelLeft"] >= 14, users_layout

        desktop_path = pathlib.Path(tempfile.gettempdir()) / "user-permissions-desktop.png"
        driver.save_screenshot(str(desktop_path))
        screenshots.append(str(desktop_path))

        driver.get(f"{base_url}/collection.html")
        wait.until(lambda current: "access_pending.html" in current.current_url)

        driver.set_window_size(390, 844)
        driver.get(f"{base_url}/admin_users.html")
        wait.until(
            lambda current: current.find_element(
                By.ID, "organisationPermissionsSelect"
            ).get_attribute("value") == cosme_id
        )
        metrics = driver.execute_script(
            """
            return {
              width: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              tabs: getComputedStyle(document.querySelector('.permission-page-tabs')).gridTemplateColumns
            };
            """
        )
        assert metrics["scrollWidth"] <= metrics["width"] + 1, metrics
        assert " " in metrics["tabs"].strip(), metrics
        mobile_path = pathlib.Path(tempfile.gettempdir()) / "organisation-permissions-mobile.png"
        driver.save_screenshot(str(mobile_path))
        screenshots.append(str(mobile_path))

        browser_errors = [
            entry for entry in driver.get_log("browser")
            if entry.get("level") == "SEVERE"
            and "favicon" not in entry.get("message", "").lower()
        ]
        assert not browser_errors, browser_errors
        print("PASS: COSME organisation forms, records and Permissions UI")
        for screenshot in screenshots:
            print(screenshot)
    finally:
        if driver:
            driver.quit()
        server.shutdown()
        cleanup(keys, user_id)


if __name__ == "__main__":
    main()
