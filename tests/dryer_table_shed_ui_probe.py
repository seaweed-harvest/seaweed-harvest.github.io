import functools
import http.server
import pathlib
import tempfile
import threading

from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait


ROOT = pathlib.Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def main():
    fixture_path = None
    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".html",
        prefix="dryer-shed-probe-",
        dir=ROOT,
        delete=False,
        encoding="utf-8",
    ) as fixture:
        fixture.write(
            """<!doctype html>
<html>
<body data-language="en">
  <form id="dryingForm">
    <select id="dryerLocation">
      <option value="">Select dryer table</option>
      <option value="bati-table-1">Bati (Table 1)</option>
      <option value="bati-dryer-shed">Dryer Shed</option>
    </select>
    <label class="required-field">
      <select id="dryingConfiguration" required>
        <option value="">Select</option>
        <option value="cover_open_back_open">Cover Up / Back Open</option>
        <option value="cover_down_back_closed">Cover Down / Back Closed</option>
        <option value="cover_down_back_open">Cover Down / Back Open</option>
      </select>
    </label>
  </form>
</body>
</html>"""
        )
        fixture_path = pathlib.Path(fixture.name)

    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--window-size=1200,800")
    driver = webdriver.Chrome(options=options)
    wait = WebDriverWait(driver, 10)

    try:
        base_url = f"http://127.0.0.1:{server.server_port}"
        driver.get(f"{base_url}/{fixture_path.name}")
        import_error = driver.execute_async_script(
            """
            const done = arguments[0];
            import('/assets/js/dryer_table_bootstrap.js?dryer-shed-probe=1')
              .then((module) => {
                module.setupDryerShedConfiguration();
                done('');
              })
              .catch((error) => done(String(error && (error.stack || error.message) || error)));
            """
        )
        assert not import_error, import_error

        driver.execute_script(
            """
            const location = document.getElementById('dryerLocation');
            location.value = 'bati-dryer-shed';
            location.dispatchEvent(new Event('change', { bubbles: true }));
            """
        )
        wait.until(
            lambda current: current.execute_script(
                "return document.getElementById('dryingConfiguration').disabled"
            )
        )
        assert driver.execute_script(
            "return document.getElementById('dryingConfiguration').value"
        ) == "no_configuration"
        assert driver.execute_script(
            "return document.querySelector('#dryingConfiguration option[value=\"no_configuration\"]').textContent"
        ) == "No configuration"
        assert not driver.execute_script(
            "return document.querySelector('#dryingConfiguration option[value=\"no_configuration\"]').hidden"
        )

        driver.execute_script(
            """
            const location = document.getElementById('dryerLocation');
            location.value = 'bati-table-1';
            location.dispatchEvent(new Event('change', { bubbles: true }));
            """
        )
        wait.until(
            lambda current: not current.execute_script(
                "return document.getElementById('dryingConfiguration').disabled"
            )
        )
        assert driver.execute_script(
            "return document.getElementById('dryingConfiguration').value"
        ) == ""
        assert driver.execute_script(
            "return document.querySelector('#dryingConfiguration option[value=\"no_configuration\"]').hidden"
        )

        driver.execute_script(
            "document.getElementById('dryerLocation').value = 'bati-dryer-shed';"
        )
        wait.until(
            lambda current: current.execute_script(
                "return document.getElementById('dryingConfiguration').value === 'no_configuration'"
            )
        )
        assert driver.execute_script(
            "return document.getElementById('dryingConfiguration').disabled"
        )

        driver.execute_script("document.getElementById('dryingForm').reset();")
        wait.until(
            lambda current: current.execute_script(
                "return !document.getElementById('dryingConfiguration').disabled"
                " && document.getElementById('dryingConfiguration').value === ''"
            )
        )

        driver.execute_script(
            """
            document.body.dataset.language = 'sw';
            document.getElementById('dryerLocation').value = 'bati-dryer-shed';
            document.dispatchEvent(new CustomEvent('seaweed-drying-language-change'));
            """
        )
        wait.until(
            lambda current: current.execute_script(
                "return document.querySelector('#dryingConfiguration option[value=\"no_configuration\"]').textContent"
            ) == "Hakuna mpangilio"
        )

        print("dryer_table Dryer Shed configuration interaction: ok")
    finally:
        driver.quit()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        if fixture_path:
            fixture_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
