import contextlib
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
        driver = webdriver.Chrome(options=options)
        wait = WebDriverWait(driver, 30)

        driver.get(f"{base_url}/login.html")
        wait.until(lambda current: current.find_element(By.ID, "loginEmail").is_displayed())
        driver.find_element(By.ID, "loginEmail").send_keys(email)
        driver.find_element(By.ID, "loginPassword").send_keys(password)
        driver.find_element(By.CSS_SELECTOR, "#loginForm button[type='submit']").click()
        wait.until(lambda current: "home.html" in current.current_url)

        driver.get(f"{base_url}/records.html?records=summary")
        wait.until(lambda current: current.find_elements(
            By.CSS_SELECTOR, ".operational-summary-metric strong"
        ))
        desktop = typography_metrics(driver)
        assert_typography(desktop)
        assert desktop["pageWidth"] <= desktop["viewport"] + 1, desktop
        desktop_path = pathlib.Path(tempfile.gettempdir()) / "today-summary-typography-desktop.png"
        driver.save_screenshot(str(desktop_path))
        screenshots.append(str(desktop_path))

        driver.set_window_size(390, 844)
        mobile = typography_metrics(driver)
        assert_typography(mobile)
        assert mobile["pageWidth"] <= mobile["viewport"] + 1, mobile
        mobile_path = pathlib.Path(tempfile.gettempdir()) / "today-summary-typography-mobile.png"
        driver.save_screenshot(str(mobile_path))
        screenshots.append(str(mobile_path))

        print(json.dumps({
            "status": "ok",
            "desktop": desktop,
            "mobile": mobile,
            "screenshots": screenshots,
        }, indent=2))
    finally:
        if driver:
            driver.quit()
        server.shutdown()
        server.server_close()
        with contextlib.suppress(Exception):
            cleanup(keys, user_id)


def typography_metrics(driver):
    return driver.execute_script(
        """
        const label = document.querySelector('.operational-summary-metric span');
        const value = document.querySelector('.operational-summary-metric strong');
        const unit = document.querySelector('.operational-summary-metric small');
        return {
          viewport: document.documentElement.clientWidth,
          pageWidth: document.documentElement.scrollWidth,
          labelColor: getComputedStyle(label).color,
          labelWeight: getComputedStyle(label).fontWeight,
          valueWeight: getComputedStyle(value).fontWeight,
          unitWeight: getComputedStyle(unit).fontWeight
        };
        """
    )


def assert_typography(metrics):
    assert metrics["labelColor"] == "rgb(69, 124, 114)", metrics
    assert metrics["labelWeight"] == "700", metrics
    assert metrics["valueWeight"] == "400", metrics
    assert metrics["unitWeight"] == "400", metrics


if __name__ == "__main__":
    main()
