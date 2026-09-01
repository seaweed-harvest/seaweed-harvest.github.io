import functools
import http.server
import pathlib
import threading

from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait


ROOT = pathlib.Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def main():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
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
        driver.get(f"{base_url}/dryer_table_records.html")
        WebDriverWait(driver, 20).until(
            lambda current: "login.html" in current.current_url
        )
        assert "return=dryer_table_records.html" in driver.current_url, driver.current_url
        assert "dryer_table_records.html" not in driver.current_url.split("?")[0], driver.current_url
        print("dryer_table_records signed-out guard: ok")
    finally:
        driver.quit()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    main()
