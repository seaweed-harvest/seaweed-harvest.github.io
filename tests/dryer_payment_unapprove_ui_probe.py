"""Actual payment controller with synthetic RPC responses; no real account/data calls."""
import json
import pathlib
from playwright.sync_api import sync_playwright
from dryer_table_payment_ui_probe import test_page, bundled_payment_module

ROOT = pathlib.Path(__file__).resolve().parents[1]


def fixture_script():
    return r'''
const day = {decision_id:'11111111-1111-4111-8111-111111111111',assistant_key:'id:synthetic',assistant_name:'Test Assistant',activity_date:'2026-08-31',loading_count:21,unloading_count:0,total_activity_count:21,qualifies:true,contract_amount_kes:825,reference_amount_kes:525,approved_work_amount_kes:825,phone_data_allowance_kes:100,approved_at:'2026-09-01T07:00:00Z',approval_active:true,payment_status:'approved_unpaid',events:[]};
window.fixture = {day, calls:[], fail:false, refreshFail:false};
window.fetch = async (url, options={}) => {
  const name=String(url).split('/').pop(), payload=JSON.parse(options.body||'{}');
  fixture.calls.push({name,payload});
  let value;
  if(name==='list_authenticated_seaweed_drying_payment_workspace') {
    if(fixture.refreshFail) throw new Error('Synthetic refresh failure');
    value={activity_days:[fixture.day],payments:[],assistants:[{assistant_key:day.assistant_key,assistant_name:day.assistant_name,phone_data_credit_balance_kes:1000}]};
  } else if(name==='unapprove_authenticated_seaweed_drying_activity_day_decision') {
    if(fixture.fail) return new Response(JSON.stringify({message:'Synthetic unapprove rejection'}),{status:409});
    if(payload.p_decision_id!==fixture.day.decision_id || payload.p_expected_approved_at!==fixture.day.approved_at) throw new Error('Wrong decision version');
    fixture.day.approval_active=false; fixture.day.payment_status='needs_review';
    value={id:fixture.day.decision_id,approval_active:false};
  } else if(name==='save_authenticated_seaweed_drying_activity_day_decision') {
    if(payload.p_approved_work_amount_kes!==825 || payload.p_phone_data_allowance_kes!==100) throw new Error('Changed retained values');
    fixture.day.approval_active=true; fixture.day.payment_status='approved_unpaid';
    fixture.day.approved_at='2026-09-07T07:00:00Z'; value={id:fixture.day.decision_id};
  } else throw new Error('Unexpected RPC '+name);
  return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
};
'''


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        for width in (1440,390):
            page=browser.new_page(viewport={'width':width,'height':950})
            page.route('**/*',lambda r:r.abort())
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            html=test_page().replace('</body>', '<script>'+fixture_script()+'</script><script type="module">'+bundled_payment_module()+'</script></body>')
            page.set_content(html,wait_until='networkidle')
            row=page.locator('[data-payment-day-row]')
            button=row.locator('[data-unapprove-payment-day]')
            button.wait_for()
            row.locator('[data-payment-day-select]').check()
            assert 'Current amount due: KES 825' in page.locator('#dryerPaymentSummaryMetrics').inner_text()
            page.once('dialog',lambda d:d.dismiss());button.click()
            assert page.evaluate("fixture.calls.filter(x=>x.name.startsWith('unapprove_')).length")==0
            assert row.locator('[data-payment-day-select]').is_checked()
            page.evaluate('fixture.fail=true')
            page.once('dialog',lambda d:d.accept());button.click()
            page.wait_for_function("document.querySelector('#dryerPaymentActivityStatus').textContent.includes('Synthetic unapprove rejection')")
            assert row.locator('[data-payment-day-select]').is_checked()
            assert button.is_enabled()
            page.evaluate('fixture.fail=false')
            page.once('dialog',lambda d:d.accept());button.click()
            page.wait_for_function("document.querySelector('[data-unapprove-payment-day]')===null")
            assert row.locator('[data-payment-day-select]').count()==0
            assert row.locator('[data-save-payment-day]').inner_text()=='Approve'
            assert row.locator('[data-payment-work-input]').input_value()=='825'
            assert row.locator('[data-payment-phone-select]').input_value()=='100'
            assert page.locator('#dryerPaymentSelectionPanel').is_hidden()
            metrics=page.locator('#dryerPaymentSummaryMetrics').inner_text()
            assert 'Needs review: 1' in metrics and 'Approved unpaid: 0' in metrics and 'Current amount due: KES 0' in metrics
            assert 'Phone/data credit: KES 1,000' in metrics
            row.locator('[data-save-payment-day]').click()
            button.wait_for()
            assert row.locator('[data-payment-day-select]').count()==1
            assert 'Current amount due: KES 825' in page.locator('#dryerPaymentSummaryMetrics').inner_text()
            # A failed refresh after a successful withdrawal must not leave money selectable.
            row.locator('[data-payment-day-select]').check()
            page.evaluate('fixture.refreshFail=true')
            page.once('dialog',lambda d:d.accept());button.click()
            page.wait_for_function("document.querySelector('#dryerPaymentActivityStatus').textContent.includes('Synthetic refresh failure')")
            assert page.locator('[data-payment-day-select]').count()==0
            assert page.locator('#dryerPaymentSelectionPanel').is_hidden()
            assert 'Current amount due: KES 0' in page.locator('#dryerPaymentSummaryMetrics').inner_text()
            # Paid rows have neither Update nor Unapprove, even with an active flag.
            page.evaluate("fixture.refreshFail=false;fixture.day.approval_active=true;fixture.day.payment_status='paid';fixture.day.payment_id='22222222-2222-4222-8222-222222222222'")
            page.locator('#reloadDryerRecords').click()
            row.wait_for()
            assert row.locator('[data-unapprove-payment-day]').count()==0
            assert row.locator('[data-save-payment-day]').count()==0
            assert not errors,errors
            print(json.dumps({'viewport':width,'cancel_error_unapprove_reapprove_paid_refresh_failure':'passed','browser_errors':errors}))
            page.close()
        browser.close()


if __name__=='__main__':
    main()
