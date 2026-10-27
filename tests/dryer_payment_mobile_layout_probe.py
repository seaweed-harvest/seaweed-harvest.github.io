"""Responsive COSME payment panel browser/layout regression, independent of live data."""
from pathlib import Path
import re

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def fixture():
    ag = (ROOT / "assets/css/ag.css").read_text(encoding="utf8")
    html = (ROOT / "dryer_table_records.html").read_text(encoding="utf8")
    inline = re.search(r"<style>(.*?)</style>", html, re.S)
    assert inline is not None
    responsive = (ROOT / "assets/css/dryer_payments_mobile.css").read_text(encoding="utf8")
    head = f"<meta name='viewport' content='width=device-width, initial-scale=1'><style>{ag}\n{inline.group(1)}\n{responsive}</style>"
    summary = (
        '<div id="dryerPaymentSummaryMetrics" class="button-row compact-actions">'
        '<span class="status-pill">Needs review: 19</span>'
        '<span class="status-pill">Approved unpaid: 2</span>'
        '<span class="status-pill">Phone/data credit: KES 0</span>'
        '<span class="status-pill">Current amount due: KES 1,250</span></div>'
    )
    toolbar = (
        '<div id="dryerApprovalToolbar" class="button-row compact-actions">'
        '<button id="dryerSelectAllApprovals">Select all for approval</button>'
        '<span id="dryerApprovalSelectedCount" class="status-pill">0 of 19 selected for approval</span>'
        '<button id="dryerClearApprovalSelection">Clear approval selection</button>'
        '<button id="dryerApproveSelected">Approve selected (2)</button></div>'
    )
    day_row = (
        '<tr data-payment-day-row>'
        '<td class="selection-cell"><input type="checkbox" data-payment-day-approve-select></td>'
        '<td><button class="dryer-payment-disclosure">▸</button><strong>26 Oct 2026</strong></td>'
        '<td>Amina Kitsao</td>'
        '<td data-mobile-label="Activity">26 L / 0 U</td>'
        '<td data-mobile-label="Status"><span class="status-pill">Minimum met</span></td>'
        '<td data-mobile-label="Activity pay"><span class="field-hint dryer-payment-reference">Contract KES 950</span>'
        '<div class="dryer-payment-amount-shell is-pending"><input class="dryer-payment-amount-input" type="number" value="950"></div></td>'
        '<td data-mobile-label="Phone/data"><select><option>KES 100</option></select></td>'
        '<td data-mobile-label="Approved total"><strong>KES 1,050</strong></td>'
        '<td data-mobile-label="Payment"><span class="status-pill">Needs review</span>'
        '<button type="button" data-save-payment-day>Approve</button></td></tr>'
    )
    detail_row = (
        '<tr class="dryer-payment-detail-row" data-payment-day-detail>'
        '<td colspan="9"><div class="dryer-payment-detail-grid">'
        '<div><strong>Recorded activity</strong><ul><li>Bati Table 4 — 26 loadings</li></ul></div>'
        '<label>Approval note <textarea rows="2">Test</textarea></label>'
        '<div><span>Unpaid</span></div></div></td></tr>'
    )
    ledger_row = (
        '<tr data-payment-ledger-row>'
        '<td><button class="dryer-payment-disclosure">▸</button><strong>02 Oct 2026</strong></td>'
        '<td data-mobile-label="Research Assistant">Amina Kitsao</td>'
        '<td data-mobile-label="Type">Activity payment</td>'
        '<td data-mobile-label="Transferred"><strong>KES 7,125</strong></td>'
        '<td data-mobile-label="Applied to">13 activity days</td>'
        '<td data-mobile-label="Phone credit">KES 1,000</td>'
        '<td data-mobile-label="Reference">MPESA</td>'
        '<td data-mobile-label="Recorded by">Owner</td></tr>'
    )
    return (
        f"<!doctype html><html><head>{head}</head>"
        '<body class="admin-console-page form-record-ledgers-page dryer-table-records-page">'
        '<main class="admin-content" style="width:100%;max-width:100%;min-width:0;box-sizing:border-box">'
        '<section class="admin-card-body standalone dryer-record-panel" id="dryerPaymentsPanel">'
        f"{summary}"
        '<details class="dryer-payment-terms"><summary>Payment terms reference</summary>'
        '<p>KES 500 per day and KES 100 phone allowance</p></details>'
        '<nav id="dryerPaymentTabs" class="ledger-view-tabs record-period-tabs">'
        '<button>Activity Days</button><button>Payment Ledger</button></nav>'
        '<section id="dryerPaymentActivityPanel">'
        '<div id="dryerPaymentSelectionPanel" class="dryer-payment-selection-panel">'
        '<div class="section-head compact"><h3>Selected payment</h3>'
        '<div class="button-row compact-actions"><button>Clear</button><button>Record payment</button></div></div>'
        '<div class="dryer-payment-selection-grid"><label>Payment date<input type="date"></label>'
        '<label>Reference<input type="text"></label></div></div>'
        f"{toolbar}"
        '<div class="responsive-table-wrap"><table class="management-table admin-data-table dryer-payment-table">'
        '<thead><tr><th>Select</th><th>Date</th><th>Research Assistant</th><th>Activity</th><th>Status</th>'
        '<th>Activity pay</th><th>Phone/data</th><th>Approved total</th><th>Payment</th></tr></thead>'
        f"<tbody>{day_row}{detail_row}</tbody></table></div></section>"
        '<section id="dryerPaymentLedgerPanel"><div class="dryer-advance-grid">'
        '<label>Phone allowance advance<input type="date"></label>'
        '<label>Reference<input></label></div>'
        '<div class="responsive-table-wrap"><table class="management-table dryer-payment-ledger-table">'
        '<thead><tr><th>Date</th><th>Assistant</th><th>Type</th><th>Amount</th></tr></thead>'
        f"<tbody>{ledger_row}</tbody></table></div></section>"
        "</section></main></body></html>"
    )


def measure(page, selector):
    return page.locator(selector).first.evaluate(
        """e => {
          const r = e.getBoundingClientRect();
          return {left:r.left, right:r.right, width:r.width,
                  scrollWidth:e.scrollWidth, clientWidth:e.clientWidth};
        }"""
    )


def test():
    html = fixture()
    with sync_playwright() as browser_api:
        browser = browser_api.chromium.launch(headless=True)
        try:
            for viewport in (320, 375, 390, 430, 760, 1024):
                page = browser.new_page(viewport={"width": viewport, "height": 860}, device_scale_factor=1)
                page.set_content(html)
                page.wait_for_load_state("domcontentloaded")
                body_overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
                assert body_overflow <= 2, f"{viewport}px entire page overflow: {body_overflow}px"
                summary = measure(page, "#dryerPaymentSummaryMetrics")
                approval = measure(page, "#dryerApprovalToolbar")
                table = measure(page, ".dryer-payment-table")
                ledger = measure(page, ".dryer-payment-ledger-table")
                for name, rect in (("summary", summary), ("approval", approval)):
                    assert rect["left"] >= -1 and rect["right"] <= viewport + 1, (
                        f"{viewport}px {name}: {rect}"
                    )
                if viewport <= 760:
                    assert table["right"] <= viewport + 1, f"{viewport}px table overflow {table}"
                    assert ledger["right"] <= viewport + 1, f"{viewport}px ledger overflow {ledger}"
                    for selector in (
                        "[data-payment-day-row] [data-save-payment-day]",
                        "#dryerApproveSelected",
                        "[data-payment-day-row] [data-payment-phone-select]",
                        "[data-payment-day-row] td:nth-child(7) select",
                    ):
                        if not page.locator(selector).count():
                            continue
                        box = measure(page, selector)
                        assert box["left"] >= -1 and box["right"] <= viewport + 1, (
                            f"{viewport}px {selector} not reachable: {box}"
                        )
                    assert page.locator(".dryer-payment-table thead").evaluate(
                        "e=>getComputedStyle(e).display") == "none"
                    assert page.locator("[data-payment-day-row]").evaluate(
                        "e=>getComputedStyle(e).display") == "grid"
                else:
                    assert page.locator(".dryer-payment-table thead").evaluate(
                        "e=>getComputedStyle(e).display") != "none"
                    assert page.locator("[data-payment-day-row]").evaluate(
                        "e=>getComputedStyle(e).display") == "table-row"
                print(f"PASS {viewport}px: no page overflow, payment controls visible")
                page.close()
        finally:
            browser.close()


if __name__ == "__main__":
    test()
