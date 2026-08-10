import contextlib
import http.server
import json
import socket
import socketserver
import threading
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class QuietServer(socketserver.TCPServer):
    def handle_error(self, _request, _client_address):
        pass


def available_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def main():
    port = available_port()
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=ROOT, **kwargs)
    server = QuietServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--window-size=390,844")
    driver = webdriver.Chrome(options=options)
    try:
        wait = WebDriverWait(driver, 20)
        driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {
                "source": """
                    const nativeFetch = window.fetch.bind(window);
                    window.fetch = (input, init) => {
                      if (!String(input).includes("/site-feedback")) return nativeFetch(input, init);
                      window.__lastFeedbackPayload = JSON.parse(init.body);
                      return Promise.resolve(new Response(JSON.stringify({
                        ok: true,
                        automation_eligible: true,
                        automation_status: "queued",
                        automation_dispatched: true
                      }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" }
                      }));
                    };
                """
            },
        )
        page = f"http://127.0.0.1:{port}/green-space/index.html"
        session = {
            "access_token": "authenticated-test-token",
            "user": {
                "email": "authenticated@example.test",
                "user_metadata": {"display_name": "Authenticated User"},
            },
        }
        driver.get(page)
        driver.execute_script(
            "localStorage.setItem('seaweed-ag-auth', arguments[0])",
            json.dumps(session),
        )
        driver.get(page)
        wait.until(
            lambda current: current.find_element(By.CSS_SELECTOR, ".site-feedback-launcher")
        ).click()

        assert not driver.find_elements(By.CSS_SELECTOR, ".site-feedback-ai-assist")
        assert not driver.find_elements(By.CSS_SELECTOR, 'input[name="aiAssist"]')
        driver.find_element(By.CSS_SELECTOR, ".site-feedback-form textarea").send_keys(
            "Make this low-risk label clearer."
        )
        driver.find_element(By.CSS_SELECTOR, ".site-feedback-submit").click()
        wait.until(
            lambda current: "Thank you" in current.find_element(
                By.CSS_SELECTOR, ".site-feedback-status"
            ).text
        )
        payload = driver.execute_script("return window.__lastFeedbackPayload")
        assert "ai_assist_requested" not in payload
        assert payload["message"] == "Make this low-risk label clearer."
        print("site feedback automatic workflow UI probe passed")
    finally:
        with contextlib.suppress(Exception):
            driver.quit()
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
