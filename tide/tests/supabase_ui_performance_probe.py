import argparse
import functools
import http.server
import json
import pathlib
import threading
import time

from selenium import webdriver


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        return


class QuietThreadingHTTPServer(http.server.ThreadingHTTPServer):
    def handle_error(self, _request, _client_address):
        return


def start_server(root):
    handler = functools.partial(QuietHandler, directory=str(root))
    server = QuietThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}"


def page_state(driver):
    return driver.execute_script(
        """
        const navigation = performance.getEntriesByType('navigation')[0];
        const resources = performance.getEntriesByType('resource');
        const supabase = resources.filter((entry) => entry.name.includes('.supabase.co/'));
        const selected = document.getElementById('selectedLocationName')?.textContent?.trim() || '';
        const current = document.getElementById('currentTideState')?.textContent?.trim() || '';
        const dataset = document.getElementById('datasetBadge')?.textContent?.trim() || '';
        const pendingPattern = /loading|inapakia/i;
        const initialUiReady = Boolean(
          document.getElementById('locationSelect')?.options?.length
          && selected
          && current
          && !pendingPattern.test(`${selected} ${current}`)
        );
        return {
          nowMs: Math.round(performance.now()),
          domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
          selected,
          current,
          dataset,
          initialUiReady,
          dataSettled: Boolean(
            initialUiReady
            && dataset
            && !pendingPattern.test(dataset)
            && !/^(data|dataset)$/i.test(dataset)
          ),
          supabaseRequests: supabase.length,
          slowestSupabaseMs: supabase.length ? Math.round(Math.max(...supabase.map((entry) => entry.duration))) : 0
        };
        """
    )


def wait_for(driver, predicate, timeout=35):
    started = time.perf_counter()
    state = None
    while time.perf_counter() - started < timeout:
        state = page_state(driver)
        if predicate(state):
            return state
        time.sleep(0.05)
    return state


def measure(driver, url, reload=False):
    if reload:
        driver.refresh()
    else:
        driver.get(url)
    initial = wait_for(driver, lambda state: state and state["initialUiReady"])
    settled = wait_for(driver, lambda state: state and state["dataSettled"])
    return {
        "initialUiMs": initial["nowMs"] if initial else None,
        "dataSettledMs": settled["nowMs"] if settled else None,
        "final": settled,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    server, base_url = start_server(args.root.resolve())
    driver = None
    try:
        options = webdriver.ChromeOptions()
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
        driver = webdriver.Chrome(options=options)
        cold = measure(driver, f"{base_url}/index.html")
        warm = measure(driver, f"{base_url}/index.html", reload=True)
        errors = [row for row in driver.get_log("browser") if row.get("level") == "SEVERE"]
        print(json.dumps({"root": str(args.root.resolve()), "cold": cold, "warm": warm, "browserErrors": errors}, indent=2))
    finally:
        if driver:
            driver.quit()
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
