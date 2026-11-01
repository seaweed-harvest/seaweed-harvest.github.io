# COSME Metrics Timeline – January raft, RA trials and personal markers

Date: 1 November 2026. Owner has explicitly approved implementation and deployment in chat.

## Scope and implementation
- Keep changes inside the existing COSME Metrics → Timeline tab, using the existing grant-checked `public.cosme_metrics_timeline()` read-only RPC.
- Preserve COSME Metrics releases, published values, finance tab, other site features and account access grants.
- Rebrand Mawimbi icon from laboratory glass to 🌿 plant/seaweed.
- Add two **single-day** personal reference markers: Bosun arrived in Canada 23 July 2025 (Japan Airlines itinerary) and departed Canada 26 November 2025 (Air Canada boarding passes). Do not shade an interval between these dates or publish private booking references.
- Add user-confirmed January 2026 raft inspection (19 January) and installation/seeding (20 January) from colleague Matt's visit; leave raft identity/site and quantities explicitly unverified. Do not attach unrelated metrics.
- Add source-backed solar dryer research-assistant cover/ventilation manual temperature trials at Funzi (7–16 Feb 2026) and Shangani (10–18 Feb 2026). Source: COSME October 2026 Solar Dryer Table Verification Report page 4. Distinguish these from loaded seaweed drying trials.
- Attribute personal contractor/start, travel and field mission entries to Bosun, keeping other project-wide work separate.
- Clarify that July 15 V1.1 raft was recovered for repair, but leave undated redeployment unasserted.
- Replacement RPC is still stable, security-definer, `search_path = ''`, with `auth.uid()` and existing `cosme_metrics.caller_role()` check before data retrieval; PUBLIC and anon cannot execute. No new table, record writes, release edits, finance/roles changes.
- Cache bust module and page to surface icon update.

## Tests and rollout
- Run 7 existing JS syntax, static and simulated UI regression checks, updated for new dated events and no Canada range.
- Execute the SELECT projection against production read-only, verify 44 events and date/attribution/source consistency.
- Apply SQL as a migration, test allowed COSME role, denied ungranted authenticated role, anon exclusion and unchanged 327 metrics.
- Merge only approved, reviewable PR on current main; verify changed files/finance tab preservation, GitHub Pages configuration, branch and database afterward.
- If full authenticated browser verification is unavailable, report this clearly rather than declaring it tested.

## Rollback
Revert the frontend merge; restore the immediately prior 38-event function from `supabase/migrations/20261101123000_cosme_metrics_timeline_extended.sql`. No historical COSME metric or finance data is modified in either direction.
