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
  assert.match(app,/if\s*\(name === "finances" && access && !financesLoaded\)/);
  assert.match(app,/financesPanel\.clear\(\)/);
});
test("Source-backed read-only panel exposes no financial mutations",()=>{
  assert.match(panel,/authClient\.rpc\("cosme_finance_read"\)/);
  assert.doesNotMatch(panel,/\.insert\(|\.update\(|\.delete\(|authClient\.rpc\("cosme_finance_write"/);
  assert.match(panel,/line\.entry_date/);
  assert.match(panel,/reportMetadata/);
  assert.match(panel,/included_in_total/);
  assert.doesNotMatch(panel,/source items excluded from totals/);
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
  assert.match(migration,/v_role is null or v_role not in/);
  assert.match(migration,/revoke all on function public\.cosme_finance_read\(\) from public,anon;/);
  assert.match(migration,/grant execute on function public\.cosme_finance_read\(\) to authenticated;/);
  assert.doesNotMatch(migration,/grant (select|all) on .*finance_.* to anon/i);
});
test("No source financial data is hard-coded in publicly fetched frontend assets",()=>{
  assert.doesNotMatch(panel,/2471500|199708|1966 MOI|G2W-2026/);
  assert.doesNotMatch(app,/2471500|199708|1966 MOI|G2W-2026/);
  assert.match(panel,/No matching cost records/);
});
test("Mobile drilldowns are usable without navigation or horizontal page overflow",()=>{
  assert.match(panel,/createElement\(tag\)/);
  assert.match(panel,/add\(box,"details","finance-category"/);
  assert.match(panel,/add\(detail,"details","finance-subcategory"/);
  assert.match(css,/max-width:580px/);
  assert.match(css,/overflow-x:auto/);
  assert.match(css,/:focus-visible/);
});

test("Finance line SQL keeps valid monetary and currency fields",()=>{
  assert.match(migration,/rate_currency text check \(rate_currency is null or rate_currency ~ '\^\[A-Z\]\{3\}\$'\),/);
  assert.match(migration,/\n  amount numeric\(18,2\),/);
  assert.match(migration,/\n  entry_date date,/);
  assert.doesNotMatch(migration,/rate_currency ~ '\^\[A-Z\]\{3\}\s*\n/);
});

test("Private COSME Finance migration has exactly one copy of every DDL object",()=>{
  for(const name of ["finance_sources","finance_packages","finance_lines","finance_allocations"]){
    const def=new RegExp("create table cosme_metrics\\."+name+" \\(","g");
    assert.equal([...migration.matchAll(def)].length,1,name+" DDL must be unique");
  }
  for(const fn of ["cosme_metrics.finance_reject_published_mutation","public.cosme_finance_read"]){
    const escaped=fn.replace(/\\./g,"\\\\.");
    const def=new RegExp("create function "+escaped+"\\(","g");
    assert.equal([...migration.matchAll(def)].length,1,fn+" DDL must be unique");
  }
  assert.equal([...migration.matchAll(/notify pgrst,'reload schema';/g)].length,1);
});

test("Authorised finance RPC adds source package keys for owner-approved project classifications",()=>{
  const patch=read("../supabase/migrations/20261101160000_cosme_finance_read_package_keys.sql");
  assert.match(patch,/'package_key',p.package_key/);
  assert.match(patch,/v_role is null or v_role not in/);
  assert.match(patch,/revoke all on function public.cosme_finance_read\(\) from public,anon/);
});
