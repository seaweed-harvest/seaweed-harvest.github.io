import pathlib
import shutil

from playwright.sync_api import sync_playwright


ROOT = pathlib.Path(__file__).resolve().parents[1]


def extract_exported_function(source, name):
    marker = f"export function {name}("
    start = source.index(marker)
    brace_start = source.index("{", start)
    depth = 0
    for index in range(brace_start, len(source)):
        character = source[index]
        if character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return source[start:index + 1].replace("export function", "function", 1)
    raise AssertionError(f"Could not extract {name}")


def main():
    bootstrap = (ROOT / "assets/js/dryer_table_bootstrap.js").read_text(encoding="utf-8")
    helper = extract_exported_function(bootstrap, "setupDryerShedConfiguration")

    html = """<!doctype html>
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

    chromium_path = (
        shutil.which("chromium")
        or shutil.which("google-chrome")
        or shutil.which("chromium-browser")
    )

    with sync_playwright() as playwright:
        launch_options = {"headless": True, "args": ["--no-sandbox"]}
        if chromium_path:
            launch_options["executable_path"] = chromium_path
        browser = playwright.chromium.launch(**launch_options)
        page = browser.new_page()
        try:
            page.set_content(html)
            page.add_script_tag(content=f"{helper}\nsetupDryerShedConfiguration();")

            page.select_option("#dryerLocation", "bati-dryer-shed")
            assert page.eval_on_selector("#dryingConfiguration", "el => el.disabled")
            assert page.input_value("#dryingConfiguration") == "no_configuration"
            assert page.eval_on_selector(
                '#dryingConfiguration option[value="no_configuration"]',
                "el => !el.hidden && el.textContent === 'No configuration'",
            )

            page.select_option("#dryerLocation", "bati-table-1")
            assert not page.eval_on_selector("#dryingConfiguration", "el => el.disabled")
            assert page.input_value("#dryingConfiguration") == ""
            assert page.eval_on_selector(
                '#dryingConfiguration option[value="no_configuration"]',
                "el => el.hidden",
            )

            page.evaluate("document.getElementById('dryerLocation').value = 'bati-dryer-shed'")
            page.wait_for_function(
                "document.getElementById('dryingConfiguration').value === 'no_configuration'"
            )
            assert page.eval_on_selector("#dryingConfiguration", "el => el.disabled")

            page.evaluate("document.getElementById('dryingForm').reset()")
            page.wait_for_function(
                "!document.getElementById('dryingConfiguration').disabled"
                " && document.getElementById('dryingConfiguration').value === ''"
            )

            page.evaluate(
                """
                document.body.dataset.language = 'sw';
                document.getElementById('dryerLocation').value = 'bati-dryer-shed';
                document.dispatchEvent(new CustomEvent('seaweed-drying-language-change'));
                """
            )
            page.wait_for_function(
                "document.querySelector('#dryingConfiguration option[value=\"no_configuration\"]')"
                ".textContent === 'Hakuna mpangilio'"
            )

            print("dryer_table Dryer Shed configuration interaction: ok")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
