-- Add an owner-confirmed actual project-cost basis, distinct from paid or invoiced.
-- Original source document and historical revisions remain immutable.
alter table cosme_metrics.finance_packages
  drop constraint if exists finance_packages_basis_check;
alter table cosme_metrics.finance_packages
  add constraint finance_packages_basis_check
  check (basis in ('estimated','quoted','invoiced','paid','actual'));
comment on constraint finance_packages_basis_check on cosme_metrics.finance_packages is
  'Actual means owner-confirmed project cost, not proof of payment. Quoted remains the source evidence basis.';
