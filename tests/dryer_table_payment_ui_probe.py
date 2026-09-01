import json
import pathlib

from playwright.sync_api import sync_playwright


ROOT = pathlib.Path(__file__).resolve().parents[1]


class PaymentState:
    approved_below_minimum = False

    @classmethod
    def workspace(cls):
        below = {
            "decision_id": (
                "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
                if cls.approved_below_minimum
                else None
            ),
            "assistant_key": "id:408560572",
            "assistant_name": "Amina kitsao",
            "activity_date": "2026-08-30",
            "loading_count": 7,
            "unloading_count": 0,
            "total_activity_count": 7,
            "qualifies": False,
            "contract_amount_kes": None,
            "reference_amount_kes": 175,
            "activity_fingerprint": "b" * 64,
            "events": [
                {
                    "submission_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                    "receipt_number": "DRY-20260830-EVENT",
                    "table_location": "Bati (Table 4)",
                    "loading_count": 7,
                    "unloading_count": 0,
                    "total_activity_count": 7,
                }
            ],
            "approved_work_amount_kes": (
                175 if cls.approved_below_minimum else None
            ),
            "phone_data_allowance_kes": (
                100 if cls.approved_below_minimum else None
            ),
            "approval_note": (
                "Partial-day recognition" if cls.approved_below_minimum else None
            ),
            "approved_at": (
                "2026-09-01T08:00:00+03:00"
                if cls.approved_below_minimum
                else None
            ),
            "approved_by_name": (
                "Owner" if cls.approved_below_minimum else None
            ),
            "payment_status": (
                "approved_unpaid"
                if cls.approved_below_minimum
                else "needs_review"
            ),
            "source_changed_since_approval": False,
            "source_changed_since_payment": False,
        }
        qualifying = {
            "decision_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "assistant_key": "id:408560572",
            "assistant_name": "Amina kitsao",
            "activity_date": "2026-08-31",
            "loading_count": 21,
            "unloading_count": 0,
            "total_activity_count": 21,
            "qualifies": True,
            "contract_amount_kes": 825,
            "reference_amount_kes": 525,
            "activity_fingerprint": "a" * 64,
            "events": [
                {
                    "submission_id": "11111111-1111-4111-8111-111111111111",
                    "receipt_number": "DRY-20260831-T1",
                    "table_location": "Bati (Table 1)",
                    "loading_count": 8,
                    "unloading_count": 0,
                    "total_activity_count": 8,
                },
                {
                    "submission_id": "22222222-2222-4222-8222-222222222222",
                    "receipt_number": "DRY-20260831-T2",
                    "table_location": "Bati (Table 2)",
                    "loading_count": 5,
                    "unloading_count": 0,
                    "total_activity_count": 5,
                },
                {
                    "submission_id": "33333333-3333-4333-8333-333333333333",
                    "receipt_number": "DRY-20260831-T3",
                    "table_location": "Bati (Table 3)",
                    "loading_count": 8,
                    "unloading_count": 0,
                    "total_activity_count": 8,
                },
            ],
            "approved_work_amount_kes": 825,
            "phone_data_allowance_kes": 100,
            "approval_note": None,
            "approved_at": "2026-09-01T07:00:00+03:00",
            "approved_by_name": "Owner",
            "payment_status": "approved_unpaid",
            "source_changed_since_approval": False,
            "source_changed_since_payment": False,
        }
        return {
            "activity_days": [qualifying, below],
            "assistants": [
                {
                    "assistant_key": "id:408560572",
                    "assistant_name": "Amina kitsao",
                    "phone_data_credit_balance_kes": 1000,
                }
            ],
            "payments": [
                {
                    "id": "99999999-9999-4999-8999-999999999999",
                    "client_request_id": "99999999-9999-4999-8999-999999999998",
                    "assistant_key": "id:408560572",
                    "assistant_name": "Amina kitsao",
                    "payment_date": "2026-08-27",
                    "transaction_type": "phone_data_advance",
                    "amount_kes": 1000,
                    "work_amount_kes": 0,
                    "phone_data_amount_kes": 0,
                    "phone_data_credit_applied_kes": 0,
                    "reference": "DATA-ADVANCE",
                    "note": "Mobile data paid in advance",
                    "recorded_at": "2026-08-27T10:00:00+03:00",
                    "recorded_by_name": "Owner",
                    "activity_day_count": 0,
                    "activity_days": [],
                    "phone_data_credit_balance_after_kes": 1000,
                }
            ],
        }


def test_page():
    return """<!doctype html>
<html>
<body>
  <button id="reloadDryerRecords" type="button">Refresh</button>
  <button id="dryerAllTab" type="button" aria-selected="false">All Records</button>
  <button id="dryerPaymentsTab" type="button" aria-selected="true">Payments</button>
  <section id="dryerPaymentsPanel">
    <div id="dryerPaymentSummaryMetrics"></div>
    <nav id="dryerPaymentTabs">
      <button id="dryerPaymentActivityTab" type="button"
        data-dryer-payment-tab="activity" aria-selected="true">Activity Days</button>
      <button id="dryerPaymentLedgerTab" type="button"
        data-dryer-payment-tab="ledger" aria-selected="false">Payment Ledger</button>
    </nav>
    <section id="dryerPaymentActivityPanel">
      <div id="dryerPaymentSelectionPanel" hidden>
        <span id="dryerPaymentSelectedCount"></span>
        <span id="dryerPaymentSelectedWork"></span>
        <span id="dryerPaymentSelectedPhone"></span>
        <span id="dryerPaymentSelectedCredit"></span>
        <span id="dryerPaymentSelectedTransfer"></span>
        <input id="dryerPaymentDate" type="date">
        <input id="dryerPaymentReference">
        <input id="dryerPaymentNote">
        <button id="dryerRecordSelectedPayment" type="button">Record payment</button>
        <button id="dryerClearPaymentSelection" type="button">Clear</button>
      </div>
      <table><tbody id="dryerActivityDayRows"></tbody></table>
      <p id="dryerPaymentActivityStatus"></p>
    </section>
    <section id="dryerPaymentLedgerPanel" hidden>
      <form id="dryerAdvanceForm">
        <select id="dryerAdvanceAssistant"></select>
        <input id="dryerAdvanceDate" type="date">
        <input id="dryerAdvanceAmount" type="number">
        <input id="dryerAdvanceReference">
        <input id="dryerAdvanceNote">
        <button type="submit">Record advance</button>
      </form>
      <p id="dryerAdvanceStatus"></p>
      <table><tbody id="dryerPaymentLedgerRows"></tbody></table>
      <p id="dryerPaymentLedgerStatus"></p>
    </section>
  </section>
</body>
</html>"""


def bundled_payment_module():
    payment_source = (ROOT / "assets/js/dryer_table_payments.js").read_text(
        encoding="utf-8"
    )
    payment_source = payment_source.replace(
        'import { currentAccessToken, currentProfile } from "./auth_client.js?v=25";',
        "",
    )
    payment_source = payment_source.replace(
        'import { DRYING_FORM_CONFIG } from "./dryer_table_config.js?v=2";',
        "",
    )
    payment_source = payment_source.replace(
        'import { calculateSelectedPayment } from "./dryer_payment_math.js?v=1";',
        "",
    )
    payment_source = payment_source.replace(
        'export { calculateSelectedPayment } from "./dryer_payment_math.js?v=1";',
        "",
    )
    stubs = """
async function currentAccessToken(){ return 'owner-token'; }
async function currentProfile(){ return {
  is_protected_owner:true,
  app_role:'system_admin',
  can_access_admin:true,
  can_view_data:true,
  can_view_finance:true
}; }
const DRYING_FORM_CONFIG = {
  supabaseUrl:'https://dryer.test',
  supabaseAnonKey:'dryer-anon'
};
function calculateSelectedPayment(days, availablePhoneCredit = 0) {
  const rows = Array.isArray(days) ? days : [];
  const workAmount = rows.reduce(
    (sum, day) => sum + Math.max(0, Math.round(Number(day?.approved_work_amount_kes) || 0)),
    0
  );
  const phoneDataAmount = rows.reduce(
    (sum, day) => sum + Math.max(0, Math.round(Number(day?.phone_data_allowance_kes) || 0)),
    0
  );
  const phoneDataCreditApplied = Math.min(
    phoneDataAmount,
    Math.max(0, Math.round(Number(availablePhoneCredit) || 0))
  );
  return {
    dayCount: rows.length,
    workAmount,
    phoneDataAmount,
    phoneDataCreditApplied,
    transferAmount: workAmount + phoneDataAmount - phoneDataCreditApplied
  };
}
"""
    return stubs + "\n" + payment_source


def fetch_stub():
    PaymentState.approved_below_minimum = False
    initial = PaymentState.workspace()
    PaymentState.approved_below_minimum = True
    approved = PaymentState.workspace()
    PaymentState.approved_below_minimum = False
    return f"""
const initialWorkspace = {json.dumps(initial)};
const approvedWorkspace = {json.dumps(approved)};
let belowMinimumApproved = false;
window.fetch = async (url, options = {{}}) => {{
  const rpcName = String(url).split('/').pop();
  const payload = JSON.parse(options.body || '{{}}');
  if (rpcName === 'list_authenticated_seaweed_drying_payment_workspace') {{
    const data = belowMinimumApproved ? approvedWorkspace : initialWorkspace;
    return new Response(JSON.stringify(data), {{
      status: 200,
      headers: {{'Content-Type':'application/json'}}
    }});
  }}
  if (rpcName === 'save_authenticated_seaweed_drying_activity_day_decision') {{
    if (payload.p_activity_date !== '2026-08-30'
        || payload.p_approved_work_amount_kes !== 175
        || payload.p_phone_data_allowance_kes !== 100) {{
      return new Response(JSON.stringify({{message:'Unexpected approval payload'}}), {{
        status: 400,
        headers: {{'Content-Type':'application/json'}}
      }});
    }}
    belowMinimumApproved = true;
    return new Response(JSON.stringify({{
      id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    }}), {{
      status: 200,
      headers: {{'Content-Type':'application/json'}}
    }});
  }}
  return new Response(JSON.stringify({{message:'Unexpected RPC ' + rpcName}}), {{
    status: 400,
    headers: {{'Content-Type':'application/json'}}
  }});
}};
"""


def main():
    PaymentState.approved_below_minimum = False
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path="/usr/bin/chromium",
            args=["--no-sandbox"],
        )
        page = browser.new_page(viewport={"width": 1440, "height": 950})
        try:
            html = test_page().replace(
                "</body>",
                "<script>"
                + fetch_stub().replace("</script>", "<\\/script>")
                + "</script><script type=\"module\">"
                + bundled_payment_module().replace("</script>", "<\\/script>")
                + "</script></body>",
            )
            page.set_content(html, wait_until="networkidle")
            page.wait_for_function(
                """() => document.getElementById('dryerPaymentActivityStatus')
                  ?.textContent.includes('2 activity days')"""
            )

            day_rows = page.locator("[data-payment-day-row]")
            assert day_rows.count() == 2, day_rows.count()
            metrics = page.locator("#dryerPaymentSummaryMetrics").inner_text()
            assert "Needs review: 1" in metrics, metrics
            assert "Approved unpaid: 1" in metrics, metrics
            assert "Phone/data credit: KES 1,000" in metrics, metrics
            assert "Current amount due: KES 825" in metrics, metrics

            below_row = page.locator(
                '[data-payment-day-row][data-activity-date="2026-08-30"]'
            )
            assert "Reference KES 175" in below_row.inner_text()
            below_row.locator("[data-payment-work-input]").fill("175")
            below_row.locator("[data-payment-phone-select]").select_option("100")
            below_row.locator("[data-save-payment-day]").click()

            page.wait_for_function(
                """() => document.querySelector(
                  '[data-payment-day-row][data-activity-date="2026-08-30"]'
                )?.dataset.decisionId ===
                'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'"""
            )

            checkboxes = page.locator("[data-payment-day-select]")
            assert checkboxes.count() == 2, checkboxes.count()
            for index in range(checkboxes.count()):
                checkbox = checkboxes.nth(index)
                if not checkbox.is_checked():
                    checkbox.check()

            page.wait_for_function(
                """() => !document.getElementById(
                  'dryerPaymentSelectionPanel'
                )?.hasAttribute('hidden')"""
            )
            assert (
                page.locator("#dryerPaymentSelectedWork").inner_text()
                == "KES 1,000"
            )
            assert (
                page.locator("#dryerPaymentSelectedPhone").inner_text()
                == "KES 200"
            )
            assert (
                page.locator("#dryerPaymentSelectedCredit").inner_text()
                == "− KES 200"
            )
            assert (
                page.locator("#dryerPaymentSelectedTransfer").inner_text()
                == "KES 1,000"
            )

            page.locator("#dryerPaymentLedgerTab").click()
            page.wait_for_function(
                """() => !document.getElementById(
                  'dryerPaymentLedgerPanel'
                )?.hasAttribute('hidden')"""
            )
            ledger_text = page.locator("#dryerPaymentLedgerRows").inner_text()
            assert "Phone/data advance" in ledger_text, ledger_text
            assert "KES 1,000" in ledger_text, ledger_text
            assert "DATA-ADVANCE" in ledger_text, ledger_text
            print("dryer payment UI probe: ok")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
