# Reef Nursery workspace tabs

## Request summary

Split the Reef Nursery form navigation into two top-level workspaces: **Nursery Training** and **Seaweed Data Collection**. Nursery Training retains the existing training tabs underneath; Seaweed Data Collection opens the existing Seaweed Record form directly.

## User problem

The current single tab row mixes training workflow sections with the separate seaweed data-entry workflow. This makes the Reef Nursery form harder to scan and makes Seaweed Record look like another training step rather than a separate activity.

## Target and authority

- Repository: `seaweed-harvest/seaweed-harvest.github.io`
- Base branch: `main`
- Exact base commit: `4e1e888a5da9d5e5b7dea23d6b2ea242cbca6e77`
- Implementation branch: `feature/reef-nursery-workspace-tabs-20260917`
- Coding authority: direct owner request in ChatGPT on 17 September 2026
- Merge/deployment authority: not granted; keep this work on the feature branch for preview and review

## Risk classification

**Lane A — low-risk presentation/navigation change.**

This change is limited to Reef Nursery client-side navigation. It does not alter authentication, permissions, RLS, Supabase schema/RPCs, photo storage, payment logic, stored record shapes or deployment configuration.

## Scope

1. Add a top-level two-option workspace switcher:
   - Nursery Training
   - Seaweed Data Collection
2. Nursery Training remains the default workspace.
3. Nursery Training shows the existing secondary tabs for Session Details, Participants, Training Delivered, Competency Assessment, Raft and Mooring Inspection, Photos and Previous Records.
4. Remove Seaweed Record from the visible secondary training tab row while retaining the existing hidden controller tab for compatibility with the current Reef tab controller.
5. Seaweed Data Collection hides the secondary row and opens the existing Seaweed Record panel.
6. Returning to Nursery Training restores the last training sub-tab used in the current page session, defaulting to Session Details.
7. Keep existing form data, submission logic and record loading unchanged.

## Predicted changed paths

- `assets/js/reef_nursery_boot.js`
- `assets/js/reef_nursery_workspace_tabs.js`
- `tests/reef_nursery_workspace_tabs_static_test.py`
- `01_Ag_Planning_Documents/2026-09-17_REEF_NURSERY_WORKSPACE_TABS.md`

## Acceptance checks

- Top-level tabs render above the existing Reef Nursery tabs.
- Nursery Training is selected by default.
- Seaweed Record is not visible in the Nursery Training secondary tab row.
- Clicking Seaweed Data Collection opens the existing Seaweed Record panel and hides the secondary row.
- Clicking Nursery Training restores the secondary row and a training panel.
- Existing Seaweed Record fields and submit/edit logic are untouched.
- Existing record deep-links that activate Seaweed Record synchronize the top-level selection.
- Keyboard focus/ARIA state on the new top-level controls is maintained.
- Review mode continues to hide Seaweed Data Collection when the existing Seaweed Record tab is unavailable.

## Test plan

- Run `node --check` on the changed/new JavaScript files.
- Run a deterministic static unittest validating the workspace-tab contract.
- Inspect the branch diff to confirm only the four predicted files changed and no protected paths are touched.
- Browser preview in Codespaces at desktop and mobile widths before merge approval.

## Implementation evidence

- `node --check assets/js/reef_nursery_boot.js`: passed.
- `node --check assets/js/reef_nursery_workspace_tabs.js`: passed.
- `python3 -m unittest tests/reef_nursery_workspace_tabs_static_test.py`: 7 tests passed.
- Branch diff against `main`: 4 changed files, 301 additions, 0 deletions at the implementation checkpoint.
- Actual changed paths match the predicted paths and none match Lane B/C protected paths.
- The existing `reef_nursery_training_public.js` tab controller remains unchanged; the new layer uses the existing Seaweed tab as a hidden controller source so existing `showTab()` behaviour is preserved.
- Browser/Codespaces visual verification is still pending owner preview.

## Rollback plan

Revert the feature-branch commits or remove the workspace-tabs module import. The underlying Reef Nursery form markup, stored data and submission APIs remain unchanged.

## Confidence

High. The existing Seaweed Record is already a separate panel and can be selected through the current tab mechanism, so this is primarily a navigation-layer reorganisation.
