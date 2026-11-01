# COSME Metrics Timeline — compact layout & verified chronology revision

**Request:** 1 November 2026 review of the live Timeline tab. Retain it *within* the COSME Metrics page. Replace verbose cards with date/activity/milestone rows, open detail in a right-hand drawer, simplify event types, distinguish each activity visually, offer 1/3/12-month calendar modes, and add key historical travel, prototype, start and programme milestones.

**Base:** production `main` commit `d984b6dd60a9b2a97c659694f6da3c397eb5d4a3`, PR #144.  
**Branch:** `work/cosme-metrics-timeline-compact-20261101`.

## Design
- Main timeline: one concise clickable row per milestone, ordered date / activity / label. Year dividers do not add event clutter.
- Right-side accessible dialog: full date(s), activity, consolidated type, explanation, source citation, and links to metrics in the selected release. Escape/close/backdrop dismissal.
- Visual identifiers: ☀️ Solar Drying Tables, 🌊 Offshore Nursery, 🏭 Aggregation Hub, 🧪 Mawimbi; ✈️ Programme/travel separately labelled rather than misclassifying as a field activity.
- Exactly six event types: Planning & decisions; Design & fabrication; Installation & deployment; Trials & monitoring; Reports & training; Travel & fieldwork. Existing source type tags are grouped *for presentation*; no historical event type is rewritten.
- Calendar defaults to 3 months, optionally 1 or 12 months. Month ranges remain inclusive; single-day events do not recur. Long travel windows use a subtle band; activity emojis mark departure and arrival/return endpoints and other events.

## Data and evidence
- Existing read-only `public.cosme_metrics_timeline()` remains the single source; no new tables, standalone module, altered historical metric values or tenant grant changes.
- SQL replacement proposal adds 16 source-qualified date entries to the existing 22. The **38-event** read-only SELECT was evaluated against the active COSME release, resulting in 13 Solar Drying, 7 Offshore Nursery, 5 Aggregation, 4 Mawimbi, 9 Programme. Dated technical entries link to existing metric IDs. Contract/travel/early prototyping rows deliberately have no fabricated metric linkage.
- Reviewed 2025 Cascadia Work Log: 19 May project familiarisation, 21 May team/requirements work, 6 & 13 August concept/prototype work, 15 September trestle, 18 September departure Victoria, 21 September Mkwiro field log, 18 October return.
- Reviewed contractor agreement correspondence dated 3 May 2025. Agreement date is **distinct** from first logged work date.
- Reviewed Notion Cascadia Time Log 2026: 19 June departure Perth via Dubai, 29 July arrival in Perth; 20 October Perth–Singapore transit, 21 October arrival in Mombasa and workshop visit, 22 October conference/presentation/closeout. Travel endpoints must not be described as every day physically in Kenya.
- Earlier metric-backed installation, trial, inspection, procurement and reporting milestones are preserved.
- No claim of a formal COSME programme inception meeting was added: the May 21 source supports an initial working/requirements meeting, not a formally titled inception.

## Verification and production controls
- All **seven focused V8 checks** passed (five static contracts and two DOM interaction scenarios). Source syntax parsed for the Timeline module, page and tests.
- Proposed SQL aggregation was run read-only against the connected COSME Supabase release and returned 38 events with complete dates, titles, activities and no broken metric relationships; migration **not applied**.
- Full Node runner, authenticated desktop/mobile browser validation and post-merge production smoke test remain required.
- This SQL change is in the repository's protected Supabase path; owner review/approval is required before application/merge. **Do not deploy automatically from this draft.**
- Rollback: revert front-end changes, restore prior checked function definition (the 22-event implementation); immutable release records remain unchanged.
