"""Browser regression: default phone allowance and approve-selected workflow."""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def fixture_html():
    ids = [
        "dryerPaymentSummaryMetrics", "dryerPaymentSelectionPanel",
        "dryerPaymentSelectedCount", "dryerPaymentSelectedWork", "dryerPaymentSelectedPhone",
        "dryerPaymentSelectedCredit", "dryerPaymentSelectedTransfer",
        "dryerPaymentActivityStatus", "dryerPaymentLedgerStatus", "dryerAdvanceStatus",
        "dryerApprovalToolbar", "dryerApprovalSelectedCount",
    ]
    extras = "".join(f'<div id="{name}"></div>' for name in ids)
    return (
        '<html><body><button id="dryerAllTab"></button>'
        '<button id="dryerPaymentsTab" aria-selected="true"></button>'
        '<section id="dryerPaymentsPanel">'
        + extras
        + '<nav id="dryerPaymentTabs">'
        '<button id="dryerPaymentActivityTab" data-dryer-payment-tab="activity"></button>'
        '<button id="dryerPaymentLedgerTab" data-dryer-payment-tab="ledger"></button>'
        '</nav>'
        '<section id="dryerPaymentActivityPanel">'
        '<button id="dryerSelectAllApprovals"></button>'
        '<button id="dryerClearApprovalSelection"></button>'
        '<button id="dryerApproveSelected"></button>'
        '<button id="dryerClearPaymentSelection"></button>'
        '<button id="dryerRecordSelectedPayment"></button>'
        '<input id="dryerPaymentDate" type="date">'
        '<input id="dryerPaymentReference">'
        '<input id="dryerPaymentNote">'
        '<table><tbody id="dryerActivityDayRows"></tbody></table></section>'
        '<section id="dryerPaymentLedgerPanel">'
        '<form id="dryerAdvanceForm"><select id="dryerAdvanceAssistant"></select>'
        '<input id="dryerAdvanceDate" type="date"><input id="dryerAdvanceAmount">'
        '<input id="dryerAdvanceReference"><input id="dryerAdvanceNote"></form>'
        '<table><tbody id="dryerPaymentLedgerRows"></tbody></table></section>'
        '</section></body></html>'
    )


def fixture_js():
    day_template = {
        "assistant_key": "id:test-ra",
        "assistant_name": "Test Research Assistant",
        "loading_count": 0,
        "unloading_count": 0,
        "total_activity_count": 0,
        "qualifies": False,
        "contract_amount_kes": None,
        "reference_amount_kes": 0,
        "events": [],
        "source_changed_since_approval": False,
        "source_changed_since_payment": False,
    }
    days = []
    for date, loads, status, work, allowance in [
        ("2026-10-25", 8, "needs_review", None, None),
        ("2026-10-26", 1, "needs_review", None, None),
        ("2026-10-24", 1, "approved_unpaid", 25, 0),
        ("2026-10-23", 1, "paid", 25, 0),
    ]:
        value = dict(day_template)
        value.update({
            "activity_date": date,
            "loading_count": loads,
            "total_activity_count": loads,
            "qualifies": loads >= 8,
            "contract_amount_kes": 500 if loads >= 8 else None,
            "reference_amount_kes": loads * 25,
            "payment_status": status,
            "decision_id": "decision-" + date if status != "needs_review" else None,
            "approved_work_amount_kes": work,
            "phone_data_allowance_kes": allowance,
        })
        days.append(value)

    mock_data = json.dumps(days)
    return """
    window.__days = """ + mock_data + """;
    window.__approvals = [];
    window.__paymentWrites = 0;
    window.confirm = () => true;
    async function currentAccessToken() { return "test-account-token"; }
    async function currentProfile() {
      return {is_protected_owner:true,app_role:"system_admin",can_access_admin:true,
      can_view_data:true,can_view_finance:true};
    }
    const DRYING_FORM_CONFIG = {supabaseUrl:"https://dry.example",supabaseAnonKey:"anon"};
    function calculateSelectedPayment(days, availablePhoneCredit=0) {
      const work=days.reduce((s,x)=>s+Number(x.approved_work_amount_kes||0),0);
      const phone=days.reduce((s,x)=>s+Number(x.phone_data_allowance_kes||0),0);
      const credit=Math.min(phone,availablePhoneCredit);
      return {dayCount:days.length,workAmount:work,phoneDataAmount:phone,
        phoneDataCreditApplied:credit,transferAmount:work+phone-credit};
    }
    window.fetch = async (url, options={}) => {
      const rpc=String(url).split("/").at(-1);
      if (rpc==="list_authenticated_seaweed_drying_payment_workspace") {
        return new Response(JSON.stringify({
          activity_days:window.__days,
          payments:[],
          assistants:[{assistant_key:"id:test-ra",assistant_name:"Test Research Assistant",
            phone_data_credit_balance_kes:0}]
        }),{status:200,headers:{"Content-Type":"application/json"}});
      }
      if (rpc==="save_authenticated_seaweed_drying_activity_day_decision") {
        const payload=JSON.parse(options.body);
        window.__approvals.push(payload);
        const day=window.__days.find(x=>x.activity_date===payload.p_activity_date);
        if (!day) return new Response(JSON.stringify({message:"Missing date"}),{status:400});
        day.decision_id="decision-"+day.activity_date;
        day.payment_status="approved_unpaid";
        day.approved_work_amount_kes=payload.p_approved_work_amount_kes;
        day.phone_data_allowance_kes=payload.p_phone_data_allowance_kes;
        return new Response(JSON.stringify({id:day.decision_id}),{status:200});
      }
      window.__paymentWrites++;
      return new Response(JSON.stringify({message:"Unexpected write"}),{status:400});
    };
    """


def test():
    source = (ROOT / "assets/js/dryer_table_payments.js").read_text(encoding="utf-8")
    source = source.replace(
        'import { currentAccessToken, currentProfile } from "./auth_client.js?v=25";', ""
    )
    source = source.replace(
        'import { DRYING_FORM_CONFIG } from "./dryer_table_config.js?v=5";', ""
    )
    source = source.replace(
        'import { calculateSelectedPayment } from "./dryer_payment_math.js?v=1";', ""
    )
    source = source.replace(
        'export { calculateSelectedPayment } from "./dryer_payment_math.js?v=1";', ""
    )
    source = source.replace("export function", "function")
    source = source.replace("export const", "const")
    assert not any(line.startswith(("import ", "export ")) for line in source.splitlines())
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        try:
            page.set_content(fixture_html())
            page.add_script_tag(content=fixture_js() + "\n" + source)
            page.evaluate("""async () => {
              const controller=initialiseDryerPayments({is_protected_owner:true,
                app_role:"system_admin",can_access_admin:true,
                can_view_data:true,can_view_finance:true});
              await controller.activate();
              window.__controller=controller;
            }""")
            rows = page.locator("[data-payment-day-row]")
            assert rows.count() == 4, rows.count()
            assert page.locator("[data-payment-day-approve-select]").count() == 2
            assert page.locator("[data-payment-day-select]").count() == 1
            assert page.locator('[data-payment-day-row][data-activity-date="2026-10-25"] [data-payment-phone-select]').input_value() == "100"
            assert page.locator('[data-payment-day-row][data-activity-date="2026-10-26"] [data-payment-phone-select]').input_value() == "100"
            assert page.locator('[data-payment-day-row][data-activity-date="2026-10-24"] [data-payment-phone-select]').input_value() == "0"
            assert page.locator('[data-payment-day-row][data-activity-date="2026-10-23"] [data-payment-phone-select]').input_value() == "0"
            assert page.locator("#dryerApproveSelected").is_disabled()
            page.locator("#dryerSelectAllApprovals").click()
            assert "2 of 2 selected" in page.locator("#dryerApprovalSelectedCount").inner_text()
            assert not page.locator("#dryerApproveSelected").is_disabled()
            page.locator("#dryerApproveSelected").click()
            page.wait_for_function("() => window.__approvals.length === 2")
            page.wait_for_function(
                "() => document.getElementById('dryerPaymentActivityStatus').textContent.includes('2 activity days approved')"
            )
            payloads = page.evaluate("window.__approvals")
            assert {x["p_activity_date"] for x in payloads} == {"2026-10-25", "2026-10-26"}
            assert {x["p_approved_work_amount_kes"] for x in payloads} == {500, 25}
            assert all(x["p_phone_data_allowance_kes"] == 100 for x in payloads)
            assert page.evaluate("window.__paymentWrites") == 0
            assert page.locator("[data-payment-day-approve-select]").count() == 0
            assert page.locator("[data-payment-day-select]").count() == 3
            print("PASS: default phone allowance and selected bulk approvals; no transfer recorded")
        finally:
            browser.close()


if __name__ == "__main__":
    test()
