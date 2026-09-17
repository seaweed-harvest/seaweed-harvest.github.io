import pathlib

from playwright.sync_api import sync_playwright


ROOT = pathlib.Path(__file__).resolve().parents[1]


def fixture_html():
    return """<!doctype html>
<html><head><meta charset=\"utf-8\"></head><body>
<section id=\"dryerPaymentsPanel\">
  <div id=\"dryerPaymentSummaryMetrics\"></div>
  <table class=\"dryer-payment-table\"><tbody id=\"dryerActivityDayRows\">
    <tr data-payment-day-row data-decision-id=\"\">
      <td>—</td><td>16 Sept 2026</td><td>Amina</td><td>0 L / 5 U</td><td>Below minimum</td>
      <td><span class=\"field-hint dryer-payment-reference\">Reference KES 125</span><input class=\"dryer-payment-amount-input\" data-payment-work-input type=\"number\" value=\"\"></td>
      <td></td><td></td><td><button data-save-payment-day>Approve</button></td>
    </tr>
    <tr class=\"dryer-payment-detail-row\" data-payment-day-detail hidden><td colspan=\"9\"><div class=\"dryer-payment-detail-grid\"><div><strong>Recorded activity</strong><ul><li>Bati — 0 loadings / 5 unloadings</li></ul></div><label>Approval note</label><div></div></div></td></tr>
    <tr data-payment-day-row data-decision-id=\"\">
      <td>—</td><td>13 Sept 2026</td><td>Amina</td><td>1 L / 8 U</td><td>Minimum met</td>
      <td><span class=\"field-hint dryer-payment-reference\">Contract KES 525</span><input class=\"dryer-payment-amount-input\" data-payment-work-input type=\"number\" value=\"525\" readonly></td>
      <td></td><td></td><td><button data-save-payment-day>Approve</button></td>
    </tr>
    <tr class=\"dryer-payment-detail-row\" data-payment-day-detail hidden><td colspan=\"9\"><div class=\"dryer-payment-detail-grid\"><div><strong>Recorded activity</strong><ul><li>Bati — 1 loading / 8 unloadings</li></ul></div><label>Approval note</label><div></div></div></td></tr>
    <tr data-payment-day-row data-decision-id=\"abc-123\">
      <td></td><td>12 Sept 2026</td><td>Amina</td><td>6 L / 13 U</td><td>Minimum met</td>
      <td><span class=\"field-hint dryer-payment-reference\">Contract KES 775</span><input class=\"dryer-payment-amount-input\" data-payment-work-input type=\"number\" value=\"775\" readonly></td>
      <td></td><td></td><td><button data-save-payment-day>Update</button></td>
    </tr>
    <tr class=\"dryer-payment-detail-row\" data-payment-day-detail hidden><td colspan=\"9\"><div class=\"dryer-payment-detail-grid\"><div><strong>Recorded activity</strong><ul><li>Bati — 6 loadings / 13 unloadings</li></ul></div><label>Approval note</label><div></div></div></td></tr>
  </tbody></table>
</section>
</body></html>"""


def bundled_refinement_module():
    source = (ROOT / "assets/js/dryer_payment_ui_refinement.js").read_text(
        encoding="utf-8"
    )
    source = source.replace(
        'import { calculateContractWorkAmount } from "./dryer_payment_math.js?v=1";',
        """function calculateContractWorkAmount(loadings, unloadings) {
  const loadingCount = Math.max(0, Math.round(Number(loadings) || 0));
  const unloadingCount = Math.max(0, Math.round(Number(unloadings) || 0));
  const totalActivityCount = loadingCount + unloadingCount;
  const qualifies = loadingCount >= 8 || unloadingCount >= 8;
  return {
    loadingCount,
    unloadingCount,
    totalActivityCount,
    qualifies,
    contractAmountKes: qualifies
      ? 500 + Math.max(totalActivityCount - 8, 0) * 25
      : null,
    referenceAmountKes: totalActivityCount * 25
  };
}""",
    )
    source = source.rsplit("\nexport {", 1)[0]
    return source


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path="/usr/bin/chromium",
            args=["--no-sandbox"],
        )
        page = browser.new_page(viewport={"width": 1800, "height": 900})
        try:
            page.set_content(fixture_html())
            page.add_script_tag(content=bundled_refinement_module())
            page.wait_for_selector("#dryerPaymentTermsReference")

            terms = page.locator("#dryerPaymentTermsReference")
            assert terms.get_attribute("open") is None
            term_text = terms.text_content()
            assert all(value in term_text for value in ("KES 500", "KES 25", "KES 100"))

            rows = page.locator("[data-payment-day-row]")
            reference_row = rows.nth(0)
            reference_input = reference_row.locator("[data-payment-work-input]")
            assert reference_input.input_value() == "125"
            assert reference_row.locator(".dryer-payment-amount-overlay").inner_text() == "Reference KES 125"
            assert "Reference total: KES 125" in page.locator("[data-payment-day-detail]").nth(0).inner_text()

            contract_row = rows.nth(1)
            assert contract_row.locator("[data-payment-work-input]").input_value() == "525"
            assert contract_row.locator(".dryer-payment-amount-overlay").inner_text() == "Contract KES 525"
            contract_detail = page.locator("[data-payment-day-detail]").nth(1).inner_text()
            assert "Base amount (day rate): KES 500" in contract_detail
            assert "Bay bonus: 1 × KES 25 = KES 25" in contract_detail
            assert "Contract total: KES 525" in contract_detail

            approved_row = rows.nth(2)
            assert approved_row.locator("[data-payment-work-input]").input_value() == "775"
            assert approved_row.locator(".dryer-payment-amount-overlay").count() == 0

            reference_input.focus()
            reference_input.fill("500")
            reference_input.blur()
            assert "is-edited" in reference_row.locator(".dryer-payment-amount-shell").get_attribute("class")
            assert reference_input.input_value() == "500"
            assert reference_row.locator(".dryer-payment-amount-overlay").evaluate(
                "(el) => getComputedStyle(el).display"
            ) == "none"
            assert reference_row.locator("[data-save-payment-day]").evaluate(
                "(el) => getComputedStyle(el).marginTop"
            ) == "0px"
        finally:
            browser.close()

    print("PASS: Dryer payment UI refinement browser probe")


if __name__ == "__main__":
    main()
