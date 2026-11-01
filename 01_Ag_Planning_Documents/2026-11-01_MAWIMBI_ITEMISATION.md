# Mawimbi component cost references

Request: replace lump-sum equipment drilldowns with a short receipt-backed component breakdown: three QC meters and tax/delivery; frame repairs and two hydraulic units; main RO system costs.

Base: bbd87af31a80c12630faf96f0590618356054a6e. Branch: feature/mawimbi-cost-itemisation-20261101. Lane C; implementation requested in chat. Publish/merge requires separate review of this concrete revision.

Use existing report metadata for component descriptions and references; retain every payment line, date, funding allocation and total. No new database schema, API, permission or operational record changes. Three immutable private package revisions will carry the source breakdown; private amounts never enter this public repository.

Acceptance: only show a component breakdown when all monetary values are valid and its sum matches the package's payment total to the cent. Keep payments separately expandable; do not add components to payment totals. Show item quantities and source links. Preserve old views for packages without itemisation. No invented delivery costs or inferred new costs.

Sources: matched Google Drive Quotes_Actuals folder, Sciencelab quotation and fiscal receipt, Revive quote and two paid invoices, G2W quotation plus current asset master. Instruments' receipt has no separate delivery charge. G2W October site-visit receipt is separate expense scope and is not added again to equipment.

Tests: valid and mismatched breakdowns, totals/funding unchanged, payment rows retained, refresh state. Verify three private drafts using rollback/idempotency and existing access checks before publication.

Rollback: frontend revert and new restoration revisions from preserved prior snapshots. No destructive changes.

Validation: 32 focused Finance tests and syntax/diff checks passed. Full private staging executed twice in a rollback transaction, three component sums matched preserved payment sums, Mawimbi total remained unchanged, 18 published scopes were retained, owner read passed and ungranted access was rejected. Three immutable private drafts staged; prior published records remain live. No browser visual test completed; source table markup is reused and DOM probes cover the new interaction. Release approval pending for three package publications and this frontend merge; no function or permission update is needed.
