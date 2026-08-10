# Authenticated Suggestion Automation

Date: 28 July 2026
Repository: `bosunjm-cloud/Seaweed_Ag_Hub`
Branch: `agent/owner-suggestion-automation`
Exact base commit: `fccba0e316ad7336acf13f026ddfd64b1c940eee`

## Objective

Remove the optional AI Assist choice and make suggestion handling depend on the
authoritative authenticated Supabase identity.

- An authenticated suggestion is assessed automatically.
- A suggestion whose `submitter_user_id` matches the active trusted product-owner
  actor may enter automatic implementation only when the assessment is low risk,
  Lane A and does not touch protected paths.
- Other authenticated suggestions receive an assessment and implementation plan,
  then stop for trusted-owner approval.
- Anonymous suggestions remain available for manual review.
- Successful implementation creates a controlled branch and draft pull request.
- No automation may merge or deploy.

The trusted owner is bootstrapped from the Bosun account email during the reviewed
database migration. Runtime authority is then based on the immutable Supabase user
UUID stored in `ag_ai_automation_actors` and the suggestion's
`submitter_user_id`. Display names, displayed emails, request text and Slack
messages do not grant authority.

## Workflow

1. The site-feedback function validates the signed-in Supabase session.
2. A database trigger derives `automation_enabled` from the authoritative
   `submitter_user_id`; the browser cannot request or grant automation.
3. The dispatch function calls the idempotent run RPC and atomically claims the
   pending assessment dispatch before contacting GitHub.
4. Existing run, task, Slack-thread, branch or pull-request state stops duplicate
   processing for the suggestion UUID.
5. GitHub Actions retrieves sanitised context from Supabase and performs a
   read-only assessment.
6. Trusted-owner low-risk Lane A work proceeds to the implementation workflow.
7. Non-owner low-risk Lane A work remains `approval_required` until Bosun approves
   it in the Suggestions workspace.
8. The implementation workflow uses a deterministic
   `agent/suggestion-<suggestion-id>` branch, runs policy and project checks, and
   opens a draft pull request.
9. Protected or higher-risk work remains held for a separately reviewed plan.

## Protected Gates

The automatic implementation lane excludes:

- authentication, account recovery, roles, permissions and RLS;
- secrets, service-role handling and automation trust controls;
- financial, payment and payout logic;
- destructive or bulk database changes;
- deployment and release changes;
- workflow permission changes;
- protected Tide datasets, calculations and scientific thresholds;
- changes beyond six files or 400 changed lines;
- work without a deterministic test and run-specific planning note.

Those areas require explicit approval before coding. Merge and deployment always
remain manual.

## Minimum Credentials

Credentials remain outside the repository.

- Supabase Edge Functions retain the project service role for authoritative record
  access and internal function-to-function dispatch.
- `AI_SUGGESTION_WORKFLOW_SECRET` lets GitHub retrieve sanitised context and return
  results.
- `AI_SUGGESTION_GITHUB_TOKEN` is restricted to repository dispatch for the mapped
  source repository.
- The GitHub workflow's ephemeral token may push only the controlled branch and
  create the draft pull request.
- `OPENAI_API_KEY` is exposed only to the Codex Action step.

No deployment credential, database password, payment credential or mobile signing
key is part of this workflow.

## Backlog Review

Authoritative snapshot taken from Supabase on 28 July 2026:

- 33 suggestion records;
- 15 closed/completed;
- 18 open;
- 10 marked queued under the previous toggle model;
- 0 automation-run records.

The absence of run records means the old Slack queue did not create authoritative
automation tasks. GitHub draft PR references were therefore cross-checked
separately.

### Completed: 15

The 15 records whose authoritative suggestion status is `closed` are classified as
completed. This includes the completed Green Space improvements and earlier
Harvest form/navigation changes.

### In progress: 5

| Suggestion | Current draft work |
| --- | --- |
| `0bbc4f72-df79-4eb3-85c4-c2311a28a01f` | PR #13, Dryer Table favourite fix |
| `06b6cd39-ab4e-4a70-8428-1756f4a70311` | PR #11, Dryer Table print action |
| `eadb4929-b096-4870-adfe-d7eb872c1368` | PR #11, remember enumerator name |
| `c0f94d23-b62f-40d7-a926-786acc2025d2` | PR #11, Cover Up wording |
| `61adc1b3-b02e-42a4-ab97-0e341218c68b` | PR #11, bay warning placement |

These remain in progress because the pull requests are draft and unmerged.

### Duplicated or superseded: 2

| Suggestion | Classification |
| --- | --- |
| `a825aad9-ac88-49f4-903a-c3c9635e103b` | Its Dryer Table work is already covered by PR #11; PR #12 only preserves the AI Assist toggle and is superseded by this policy. |
| `abe73aa7-61e3-44b5-beed-c3b268a9ee45` | Near-duplicate of `b4d9e8eb-e25e-4181-ac8b-572cb852efdf` about including Tide locations by default. |

### Blocked: 0 suggestion-specific

No open suggestion has an authoritative run-level error because no automation run
had been created when this snapshot was taken. Automatic implementation remains
operationally blocked until the two execution credentials listed in the release
status below are configured.

### Still unprocessed: 11

| Suggestion | Product/page | Short description |
| --- | --- | --- |
| `941fcb36-d119-460a-aa81-0962eff38585` | Reef Nursery | Training-activity selection message |
| `1d41d529-8307-468d-b363-8cc8e29566f7` | Suggestions | Page margins; toggle request superseded |
| `334a1be6-3296-4d86-97cc-29871e87c7fd` | My Profile | Remove offline verification wording |
| `ef3e9e22-af92-4802-8ac8-b2941998a7e8` | My Profile | Rename organisation selector and size it consistently |
| `26554893-8a91-4b74-91eb-41ecb86b9de9` | Today's records | Time and farmer column wording |
| `b5ea5084-a330-4fef-aa07-de814c3d15ae` | Suggestion widget | Simplify suggestion type wording |
| `ec9b2c42-c563-45cc-8173-a126de6065ac` | Today's Intake | Date-selected mobile record view |
| `b4d9e8eb-e25e-4181-ac8b-572cb852efdf` | Tide Planner | Include Tide locations by default |
| `b7a2a4ec-c0e4-48c7-b143-d1acd91880cf` | Tide Planner | Phone/admin/header guidance cleanup |
| `c167ed1d-87ce-4e1a-933e-3ac235cb4f08` | Tide Planner | Update daytime Tide view |
| `eeb58afd-1573-4c3c-a700-ca1046ef46ff` | Collection | Unclear non-owner farmer/seaweed report; clarification required |

## Release Status: 29 July 2026

Completed:

- source policy and implementation merged in PR #15;
- live historical-ledger baseline reconciled in PR #16;
- stale temporary presentation lock file removed in PR #18;
- migration `20260728120000_authenticated_suggestion_automation.sql` applied to
  Supabase project `wwzmajhdusfyfskppupg`;
- `site-feedback`, assessment dispatch/result and implementation
  dispatch/context Edge Functions deployed with JWT gateway verification
  disabled and their own server-side authentication checks retained;
- `AI_SUGGESTION_WORKFLOW_SECRET` rotated and configured consistently in GitHub
  and Supabase;
- website deployment commit `3383217` built successfully on GitHub Pages;
- live website verified with no AI Assist toggle, PWA cache `v108` and the
  historical ledger route retained;
- superseded PRs #4 and #12 closed.

Safe current mode:

- Supabase assessment and coding modes are `shadow`;
- GitHub assessment and coding-pilot variables remain `false`;
- suggestions continue to be stored and Slack-notified;
- automatic merge and deployment remain prohibited.

Required before automatic assessment and draft-PR implementation can be enabled:

- add GitHub Actions secret `OPENAI_API_KEY`;
- add Supabase secret `AI_SUGGESTION_GITHUB_TOKEN` using a fine-grained token
  restricted to `bosunjm-cloud/Seaweed_Ag_Hub` with only the repository access
  needed for dispatch;
- set Supabase assessment and coding modes to `dispatch`;
- set GitHub variables `AI_SUGGESTION_ASSESSMENT_ENABLED` and
  `AI_SUGGESTION_CODING_PILOT_ENABLED` to `true`;
- submit one authenticated protected-owner test suggestion and verify the
  assessment, controlled branch and draft pull request end to end.

The locally available GitHub CLI token was deliberately not copied into Supabase
because it has broad `repo` and `workflow` scopes rather than the required
single-repository restriction.
