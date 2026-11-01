import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read = path => readFileSync(new URL(path,import.meta.url),"utf8");
const page=read("../cosme_metrics.html");
const app=read("../assets/js/cosme_metrics_page.js");
const panel=read("../assets/js/cosme_finances_panel.mjs");
const css=read("../assets/css/cosme_finances.css");
const migration=read("../supabase/migrations/20261101120000_cosme_finances_private.sql");

test("Finances tab sits inside authenticated COSME Metrics, not a new public page",()=>{
  assert.match(page,/data-tab="finances"/);
  assert.match(page,/<section id="finances" hidden/);
  assert.match(page,/id="cosmeFinances"/);
  assert.match(app,/const grant = await requireMetrics\(\)/);
  assert.match(app,/if\(name === "finances" && access && !financesLoaded\)/);
  assert.match(app,/financesPanel\.clear\(\)/);
});
test("Source-backed read-only panel exposes no financial mutations",()=>{
  assert.match(panel,/authClient\.rpc\("cosme_finance_read"\)/);
  assert.doesNotMatch(panel,/\.insert\(|\.update\(|\.delete\(|authClient\.rpc\("cosme_finance_write"/);
  assert.match(panel,/line\.entry_date/);
  assert.match(panel,/line\.reconciliation_status/);
  assert.match(panel,/line\.included_in_total/);
  assert.match(panel,/excluded from subtotal|Excluded from subtotal/);
});
test("Sensitive finance tables remain private with explicit metrics-grant RPC",()=>{
  for(const table of ["finance_sources","finance_packages","finance_lines","finance_allocations"]){
    assert.match(migration,new RegExp("alter table cosme_metrics\\."+table+" enable row level security;"));
  }
  assert.match(migration,/revoke all on cosme_metrics\.finance_sources/);
  assert.match(migration,/from public,anon,authenticated;/);
  assert.match(migration,/cosme_metrics\.caller_role\(\)/);
  assert.match(migration,/\(select auth\.uid\(\)\) is null/);
  assert.match(migration,/v_role not in \('owner','editor','reader'\)/);
  assert.match(migration,/revoke all on function public\.cosme_finance_read\(\) from public,anon;/);
  assert.match(migration,/grant execute on function public\.cosme_finance_read\(\) to authenticated;/);
  assert.doesNotMatch(migration,/grant (select|all) on .*finance_.* to anon/i);
});
test("No source financial data is hard-coded in publicly fetched frontend assets",()=>{
  assert.doesNotMatch(panel,/2471500|199708|1966 MOI|G2W-2026/);
  assert.doesNotMatch(app,/2471500|199708|1966 MOI|G2W-2026/);
  assert.match(panel,/No reviewed cost packages are published yet/);
});
test("Mobile drilldowns are usable without navigation or horizontal page overflow",()=>{
  assert.match(panel,/createElement\(tag\)/);
  assert.match(panel,/node\("details","finance-category"/);
  assert.match(panel,/node\("details","finance-subcategory"/);
  assert.match(css,/max-width:650px/);
  assert.match(css,/overflow-x:auto/);
  assert.match(css,/:focus-visible/);
});
