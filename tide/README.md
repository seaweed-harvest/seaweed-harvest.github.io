# Tide frontend

This directory is the canonical deployable Tide Planner at
`https://seaweed-harvest.com/tide/`.

It contains the lean static application, PWA assets and focused frontend tests.
Historical source documents, bulk Tide references and the retired V0 Supabase
implementation remain in the legacy Tide repository during the rollback window;
they are deliberately not published here.

The shared production schema, migrations and Edge Functions live in the parent
repository's `supabase/` directory.

To refresh this directory from an approved Tide integration branch:

```powershell
.\scripts\sync_tide_frontend.ps1 -Source <path-to-tide-worktree>
```
