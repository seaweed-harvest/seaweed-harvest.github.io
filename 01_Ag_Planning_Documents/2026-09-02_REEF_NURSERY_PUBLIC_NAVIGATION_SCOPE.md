# Reef Nursery public navigation scope correction

## Request summary

Remove the Mawimbi **Today's Intake** record link from the signed-out Reef Nursery form. The public Reef Nursery workspace belongs to COSME and must not advertise Mawimbi Intake navigation.

## User problem

A signed-out visitor opening `reef_nursery.html` currently receives the generic anonymous fallback navigation. That fallback exposes **Intake** under Forms and **Today's Intake** under Records, even though the visitor is in the COSME Reef Nursery workspace.

## Target and authority

- Repository: `seaweed-harvest/seaweed-harvest.github.io`
- Base branch: `main`
- Exact base commit: `5a14afb4eac41169f23f7577d023b618157c8676`
- Implementation branch: `fix/reef-nursery-public-navigation-20260902`
- Coding authority: direct owner request in ChatGPT on 2 September 2026
- Merge/deployment authority: not yet granted; stop at draft pull request

## Risk classification

**Lane B — implement, validate, then obtain approval before merge.**

The change is small, but it touches `assets/js/app_navigation.js`, which is explicitly classified as the shared-application-shell protected path. There are no authentication, permission, database, destructive-data, finance or deployment changes.

## Scope

1. Make the shared Forms and Records link builders aware of the current page.
2. On `reef_nursery.html` only, when no profile is present:
   - suppress the anonymous Mawimbi Intake fallback;
   - suppress the anonymous Today's Intake fallback;
   - retain Reef Nursery as the sole Forms link;
   - hide the Records menu/group when it has no valid links.
3. Preserve navigation behaviour for signed-in users and every other public page.

## Predicted changed paths

- `assets/js/app_navigation.js`
- `tests/reef_nursery_public_navigation_static_test.py`
- `01_Ag_Planning_Documents/2026-09-02_REEF_NURSERY_PUBLIC_NAVIGATION_SCOPE.md`

## Acceptance checks

- A signed-out `reef_nursery.html` page does not show **Today's Intake** in the header menu or drawer.
- The same page does not show the Mawimbi **Intake** form link.
- The Forms menu still identifies **Reef Nursery**.
- An empty Records menu/group is not visibly rendered.
- Anonymous Collection/Intake pages retain their existing Intake and Today's Intake navigation.
- Signed-in capability- and organisation-filtered navigation remains unchanged.

## Test plan

- Run `node --check assets/js/app_navigation.js`.
- Run the focused deterministic static test for Reef Nursery public navigation scope.
- Run the relevant existing shared mobile-navigation contract assertions against the modified source.
- Run a lightweight behaviour probe covering anonymous Reef Nursery, anonymous Collection and signed-in COSME contexts.
- Inspect the actual pull-request diff and GitHub checks before requesting merge approval.

## Rollback plan

Revert the pull-request commit. The change is presentation-only and does not alter stored data, permissions, form submission, database functions or offline records.

## Confidence

High. The fault is the generic `!profile` fallback in the shared link builders, and the correction is bounded by both `profile === null` and the exact `reef_nursery.html` route.
