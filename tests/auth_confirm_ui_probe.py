import os
import pathlib
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait


ROOT = pathlib.Path(__file__).resolve().parents[1]


def main():
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", 0), SimpleHTTPRequestHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base_url = f"http://127.0.0.1:{server.server_port}"

    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    cached_drivers = list(
        (pathlib.Path.home() / ".cache" / "selenium" / "chromedriver").glob(
            "win64/*/chromedriver.exe"
        )
    )
    if cached_drivers:
        driver_path = max(
            cached_drivers,
            key=lambda path: tuple(
                int(part) for part in path.parent.name.split(".")
            ),
        )
        driver = webdriver.Chrome(
            service=Service(str(driver_path)),
            options=options,
        )
    else:
        driver = webdriver.Chrome(options=options)
    screenshots = []
    try:
        wait = WebDriverWait(driver, 15)
        for width, height, label in ((1440, 900, "desktop"), (390, 844, "mobile")):
            driver.set_window_size(width, height)
            driver.get(
                f"{base_url}/auth_confirm.html?token_hash={'a' * 64}&type=invite"
            )
            wait.until(
                lambda current: current.find_element(
                    By.ID, "confirmationButton"
                ).is_enabled()
            )
            metrics = driver.execute_script(
                """
                const panel = document.querySelector('.auth-panel');
                const button = document.querySelector('#confirmationButton');
                return {
                  clientWidth: document.documentElement.clientWidth,
                  scrollWidth: document.documentElement.scrollWidth,
                  panelLeft: panel.getBoundingClientRect().left,
                  panelRight: panel.getBoundingClientRect().right,
                  buttonHeight: button.getBoundingClientRect().height,
                  title: document.querySelector('#confirmationTitle').textContent,
                  button: button.textContent
                };
                """
            )
            assert metrics["scrollWidth"] <= metrics["clientWidth"] + 1, metrics
            assert metrics["panelLeft"] >= 12, metrics
            assert metrics["panelRight"] <= metrics["clientWidth"] - 12, metrics
            assert metrics["buttonHeight"] >= 40, metrics
            assert metrics["title"] == "Set up your account", metrics
            assert metrics["button"] == "Continue account setup", metrics
            screenshot = (
                pathlib.Path(tempfile.gettempdir())
                / f"seaweed-auth-confirm-{label}.png"
            )
            driver.save_screenshot(str(screenshot))
            screenshots.append(screenshot)

        driver.get(f"{base_url}/auth_confirm.html")
        wait.until(
            lambda current: "invalid or incomplete"
            in current.find_element(By.ID, "confirmationStatus").text
        )
        assert not driver.find_element(By.ID, "confirmationButton").is_enabled()
        severe = [
            entry for entry in driver.get_log("browser")
            if entry["level"] == "SEVERE"
        ]
        assert not severe, severe
    finally:
        driver.quit()
        server.shutdown()

    print("Auth confirmation UI probe passed.")
    for screenshot in screenshots:
        print(screenshot)


if __name__ == "__main__":
    main()
