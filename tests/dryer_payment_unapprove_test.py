"""No-network regression checks for the unpaid-approval withdrawal control."""
import json
import pathlib
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'supabase/migrations/20260907073000_dryer_payment_unapprove.sql'


class UnapproveTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text()
        cls.js = (ROOT / 'assets/js/dryer_table_payments.js').read_text()
        cls.patches = re.findall(
            r"\('([^']+)'::regprocedure,\s*\$old\$(.*?)\$old\$,\s*\$new\$(.*?)\$new\$\)",
            cls.sql, re.S)

    def test_each_patch_matches_exactly_one_original_anchor_and_is_idempotent(self):
        self.assertEqual(len(self.patches), 4)
        originals = '\n'.join((ROOT / 'supabase/migrations' / name).read_text() for name in (
            '20260901134600_dryer_activity_payment_workspace.sql',
            '20260901134700_dryer_activity_payment_transactions.sql'))
        for target, old, new in self.patches:
            with self.subTest(target=target):
                self.assertEqual(originals.count(old), 1)
                self.assertNotIn(new, originals)
                patched = originals.replace(old, new)
                self.assertEqual(patched.count(new), 1)
                self.assertIn('if strpos(v_definition, v_new) > 0 then', self.sql)
        self.assertIn("<> 1 then", self.sql)
        self.assertIn("Unapprove migration stopped", self.sql)

    def test_existing_contract_and_credit_calculations_are_not_patched(self):
        for _, old, new in self.patches:
            for token in ('500 +', '25', 'credit_balance', 'phone_total', 'loading_count >= 8'):
                self.assertNotIn(token, old + new)
        self.assertNotRegex(self.sql.lower(), r'(?:update|delete\s+from|insert\s+into)\s+public\.seaweed_drying_(?:submissions|bay_records|payment_transactions|payment_activity_days)\b')
        self.assertNotIn('delete from', self.sql.lower())

    def test_unapprove_is_guarded_and_lock_order_matches_existing_writers(self):
        body = self.sql.split('as $$', 1)[1].split('$$;', 1)[0]
        fragments = ['seaweed_harvest_cosme_finance_owner_profile', "'dryer-payment:'",
                     "'dryer-decision:'", 'for update', 'already been paid',
                     'is distinct from p_expected_approved_at', 'if not v_decision.approval_active',
                     'insert into private.seaweed_drying_approval_withdrawals',
                     'set approval_active = false']
        positions = [body.index(fragment) for fragment in fragments]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('to_jsonb(v_decision)', body)
        self.assertIn('where id = p_decision_id', body)

    def test_audit_is_private_and_cross_project_auth_permissions_are_preserved(self):
        self.assertIn('approval_snapshot jsonb not null', self.sql)
        self.assertIn('enable row level security', self.sql)
        self.assertIn('from public, anon, authenticated;', self.sql)
        self.assertIn('to anon;', self.sql)
        self.assertNotRegex(self.sql, r'grant[^;]+to authenticated')
        self.assertNotIn('create policy', self.sql.lower())
        self.assertIn("set search_path = 'public', 'private', 'pg_temp'", self.sql)

    def test_workspace_reapproval_and_payment_all_handle_withdrawn_approval(self):
        self.assertIn('coalesce(decision.approval_active, false) as approval_active', self.sql)
        self.assertIn("not decision.approval_active then 'needs_review'", self.sql)
        self.assertIn('approval_active = true', self.sql)
        self.assertIn('if not v_decision.approval_active then', self.patches[-1][2])
        self.assertIn('Review and approve it before payment.', self.sql)

    def test_state_eligibility_including_stale_and_inconsistent_responses(self):
        source = re.sub(r'^(?:import .*;|export \{.*;)$', '', self.js, flags=re.M)
        source = source.replace('export function ', 'function ')
        cases = [
            ({'decision_id':'x','approved_at':'2026-09-01T00:00Z','payment_status':'approved_unpaid'}, True, True),
            ({'decision_id':'x','approved_at':'2026-09-01T00:00Z','payment_status':'needs_review','source_changed_since_approval':True}, True, False),
            ({'decision_id':'x','approved_at':'2026-09-01T00:00Z','payment_status':'paid'}, False, False),
            ({'decision_id':'x','approved_at':'2026-09-01T00:00Z','payment_status':'approved_unpaid','approval_active':False}, False, False),
            ({'decision_id':None,'payment_status':'needs_review'}, False, False),
        ]
        harness = "const vm=require('node:vm'), fs=require('node:fs'); const input=JSON.parse(fs.readFileSync(0,'utf8')); const c=vm.createContext({document:{addEventListener(){}},cases:input.cases}); vm.runInContext(input.source,c); console.log(JSON.stringify(vm.runInContext('cases.map(d=>[canUnapproveDay(d),isSelectableDay(d)])',c)));"
        result = subprocess.run(['node','-e',harness], input=json.dumps({'source':source,'cases':[c[0] for c in cases]}), text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout), [[c[1],c[2]] for c in cases])

    def test_script_cache_version_and_local_selection_invalidation(self):
        self.assertIn('dryer_table_payments.js?v=2', (ROOT / 'dryer_table_records.html').read_text())
        self.assertIn('p_expected_approved_at: day.approved_at', self.js)
        start = self.js.index('async unapproveActivityDay')
        end = self.js.index('  selectedDays()', start)
        method = self.js[start:end]
        self.assertLess(method.index('selectedDecisionIds.delete'), method.index('await this.loadWorkspace()'))
        self.assertIn('window.confirm(', method)
        self.assertIn('this.state.unapproving', method)


if __name__ == '__main__':
    unittest.main()
