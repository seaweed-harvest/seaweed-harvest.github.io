# AI Suggestion Review and Automated Implementation Plan

Date: 2026-07-26

Status: planning document. Not implemented.

## Executive Summary

The objective is to create a controlled, event-driven software-development workflow in which a suggestion submitted through Seaweed Harvest, Green Space Log, or Seaweed Tide Planner can trigger an AI-assisted process that:

1. verifies who submitted the suggestion;
2. retrieves the authoritative suggestion record from Supabase;
3. assesses clarity, value, duplication, risk, scope, and feasibility;
4. prepares an implementation plan and acceptance checks;
5. decides whether the request may be implemented automatically, implemented but held for approval, or reviewed without coding;
6. uses a cloud coding agent to make the change in the correct source repository;
7. runs deterministic tests and policy checks;
8. opens a traceable pull request;
9. automatically merges and deploys only where the submitter permissions and actual code diff both permit it;
10. verifies the deployed application;
11. updates the suggestion status and notifies the owner of the outcome.

The primary goal is therefore broader than simply allowing AI to edit pages. The system should provide a secure, auditable and recoverable change-management lifecycle from suggestion submission through deployment and closure.

The intended initial permission model is:

- suggestions from ordinary users are reviewed and prioritised, but do not automatically change code;
- suggestions from the authenticated Bosun owner account receive broad permission for ordinary product and front-end changes;
- security, authentication, permissions, secrets, destructive data operations and other protected areas remain approval-gated regardless of who submitted the suggestion.

## Primary Objective

Build an event-driven pipeline where a valid suggestion can notify an AI coding workflow immediately, without requiring a 15-minute polling process and without requiring Bosun to manually inspect, edit, commit or push routine changes.

The desired end state is:

```text
Suggestion submitted
  -> authenticated identity recorded
  -> Supabase row inserted
  -> database webhook fires
  -> dispatch function validates and routes the request
  -> GitHub workflow starts
  -> AI assesses and plans
  -> policy gate selects the permitted lane
  -> AI implements where permitted
  -> deterministic tests run
  -> actual diff is checked against policy
  -> pull request is opened
  -> eligible owner changes auto-merge
  -> deployment completes
  -> post-deployment checks run
  -> suggestion is updated and owner is notified
```

## Success Definition

The system will be considered successful when:

- a new suggestion can start processing within seconds of submission;
- Supabase, not Slack, is the authoritative source of suggestion state;
- the displayed submitter name is never used as the security authority;
- owner permissions are tied to an authenticated Supabase user ID;
- the same suggestion cannot be processed twice;
- the AI cannot directly push unreviewed code to the production branch;
- every code change has a branch, commit, pull request, tests and audit record;
- low-risk owner suggestions can deploy without manual review;
- high-risk changes stop automatically for approval;
- failed, stuck or missed events are recoverable;
- deployed changes can be rolled back;
- the owner receives useful outcome notifications without receiving messages when nothing happened.

## Current Foundation

### Suggestion submission

The existing `site-feedback` Supabase Edge Function already provides a strong starting point:

- validates the feedback payload;
- supports aggregation and tide source applications;
- stores the source page, page URL, type and suggestion text;
- authenticates a supplied Supabase access token;
- stores `submitter_user_id`, `submitter_name` and `submitter_email`;
- writes the suggestion to `ag_site_feedback`;
- uses unique submission identifiers to avoid duplicate inserts;
- posts a formatted notification to Slack.

Relevant existing files:

- `supabase/functions/site-feedback/index.ts`
- `supabase/migrations/20260723180000_site_feedback.sql`
- `tests/site_feedback_static_test.py`

### Current data record

`ag_site_feedback` currently records:

- suggestion UUID;
- creation time;
- source application;
- source page and URL;
- suggestion type and text;
- authenticated submitter user ID and email when available;
- display name;
- status;
- Slack delivery state.

This means the workflow should read from Supabase directly rather than relying on parsing Slack messages.

### Slack role

Slack should remain:

- a human-readable notification mirror;
- an optional operational alert destination;
- a convenient place to link to the suggestion and pull request.

Slack should not become:

- the system of record;
- the permission authority;
- the instruction transport used directly by the coding agent;
- the only record that a suggestion exists.

### Repository and deployment shape

Aggregation and Green Space:

- source repository: `bosunjm-cloud/Seaweed_Ag_Hub`;
- deployment repository: `seaweed-harvest/seaweed-harvest.github.io`;
- live application: `https://seaweed-harvest.com`;
- Green Space Log is part of the Seaweed Harvest application and should follow the same repository and permission policy.

Tide:

- source repository: `bosunjm-cloud/Seaweed_Tide_App`;
- live application: `https://seaweed-tide-planner.github.io`;
- the final deployment-repository mapping must be confirmed during implementation.

The GitHub integration and cloud workflow must have explicit access to both source and deployment repositories before automated deployment is enabled.

## Core Architecture Decision

Use an event-driven workflow, not frequent polling.

### Primary trigger

A Supabase Database Webhook should fire when an eligible row is inserted into `ag_site_feedback`.

Recommended trigger:

```text
public.ag_site_feedback
  event: INSERT
```

The webhook should call a new secured Edge Function, tentatively:

```text
ai-suggestion-dispatch
```

This function should:

1. verify the webhook signature or shared secret;
2. validate the suggestion UUID;
3. retrieve the current suggestion row from Supabase;
4. confirm it has not already been dispatched;
5. resolve the submitter trust tier from authenticated identity;
6. resolve the target application and repository;
7. create an idempotent automation run record;
8. send a minimal signed `repository_dispatch` event to GitHub;
9. record the GitHub dispatch result;
10. return quickly without waiting for coding or tests.

The payload sent to GitHub should contain only identifiers and routing information, for example:

```json
{
  "suggestion_id": "uuid",
  "automation_run_id": "uuid",
  "source_app": "aggregation",
  "target_key": "seaweed-harvest"
}
```

The raw suggestion should be retrieved securely by the workflow after the dispatch. It should not be treated as an executable instruction merely because it was submitted through the application.

### AI invocation

The event should start a GitHub Actions workflow that invokes Codex or another approved OpenAI coding workflow in a cloud checkout of the appropriate repository.

This is the practical meaning of a suggestion notifying GPT. It does not awaken a persistent ChatGPT conversation. Instead:

```text
Supabase event
  -> Edge Function
  -> GitHub Actions
  -> Codex/OpenAI workflow
```

### Fallback reconciliation

A lightweight scheduled reconciliation should run once daily.

It should only look for:

- suggestions still marked new but never dispatched;
- automation runs stuck in dispatching, coding, testing, merging or deploying;
- failed webhooks eligible for retry;
- GitHub runs that ended without updating Supabase;
- deployed suggestions not closed correctly.

The daily job is a safety net, not the normal trigger.

## Source of Truth

The authoritative records should be:

1. Supabase for suggestion, identity, decision and automation state;
2. GitHub for branch, commit, pull request, test and deployment evidence;
3. Slack and ChatGPT notifications as derived human-facing messages.

No suggestion should be considered implemented solely because Slack contains a message or the AI reports that work is complete.

A suggestion is complete only when the recorded deployment and post-deployment checks have succeeded.

## Identity and Permission Model

### Do not trust the displayed name

`submitter_name = Bosun Michael` is not sufficient authority.

The trusted-owner lane must require:

- a non-null authenticated `submitter_user_id`;
- a matching active automation actor record;
- the expected application role or system-admin status;
- optional confirmation that the stored account email remains on the allow-list.

Anonymous suggestions, expired sessions and name-only suggestions must never receive owner permissions.

### Proposed actor configuration

Create a controlled table such as:

```text
ag_ai_automation_actors
```

Suggested fields:

- `user_id`;
- `trust_tier`;
- `active`;
- `allowed_apps`;
- `can_auto_plan`;
- `can_auto_implement`;
- `can_auto_merge`;
- `maximum_risk_level`;
- `created_by`;
- `created_at`;
- `updated_at`;
- `notes`.

Suggested trust tiers:

#### Standard submitter

- suggestion may be assessed;
- valuable suggestions may notify Bosun;
- no automatic coding;
- Bosun or an authorised administrator must promote the item into an implementation lane.

#### Trusted product owner

Intended initial tier for Bosun's authenticated account.

- broad automatic assessment and planning;
- automatic implementation for ordinary application changes;
- automatic pull requests;
- automatic merging for allowed low- and moderate-risk changes after all gates pass;
- approval remains mandatory for protected changes.

#### System operator

- may manage automation configuration and retries;
- does not bypass protected-path or destructive-change restrictions merely because of operator status.

### Permission principle

User permissions define the maximum lane a request may enter.

The actual code diff is checked again after implementation. A trusted-owner request cannot auto-merge if the generated change unexpectedly touches protected files or exceeds permitted scope.

## Risk and Approval Matrix

The exact rules should be stored in a machine-readable repository policy file and mirrored in database configuration where required.

Suggested policy files:

- `AGENTS.md`;
- `.automation/development-policy.yml`;
- `.automation/app-map.yml`;
- `.automation/protected-paths.yml`.

### Lane A: automatic implementation and automatic merge

For the authenticated trusted product owner, the initial allow-list may include:

- spelling and grammar;
- labels, headings, button wording and explanatory text;
- HTML and CSS changes;
- phone and tablet responsiveness;
- spacing, sizing, scrolling, wrapping and alignment;
- accessibility labels and semantic markup;
- ordinary page navigation and tabs;
- filters, table display and calendar interactions;
- non-destructive JavaScript using existing data contracts;
- form behaviour that does not change security or destructive data handling;
- display formatting for time, date, weight and currency;
- Green Space observation, photo-reference and distillation presentation changes that use existing storage and permissions;
- Tide Planner interface and planning-guidance changes that do not alter tide science or source data;
- tests and documentation;
- refactoring within permitted front-end files when behaviour remains covered by tests.

Initial scope limits should be configurable. A cautious pilot default could be:

- no protected paths;
- no new dependency;
- no secret or workflow-file change;
- no database migration;
- no destructive operation;
- no more than 6 changed files;
- no more than 400 changed lines;
- acceptance checks must be generated and pass.

These limits may be increased after shadow-mode evidence shows the policy is classifying work correctly.

### Lane B: automatic implementation, approval before merge

The AI may plan, code and test, but the pull request must stop for approval when work includes:

- a significant new feature;
- new photo capture, upload or storage behaviour;
- service-worker or offline synchronisation changes;
- changes to submission finalisation or irreversible user actions;
- new external packages or dependencies;
- additive database changes;
- Supabase Edge Function changes;
- new external-service integrations;
- large cross-page changes;
- changes across multiple applications;
- major refactoring;
- functionality for which reliable automated acceptance tests cannot be created;
- a diff that exceeds the automatic lane's size or file limits.

### Lane C: planning and approval before coding

The workflow should assess and prepare a plan, but should not start coding without explicit approval for:

- authentication and login;
- account recovery;
- user roles and permissions;
- row-level security;
- service-role use;
- secrets and API keys;
- destructive SQL;
- dropping or renaming columns or tables;
- bulk modification or deletion of records;
- collection-weight integrity;
- payment, financial or payout logic;
- privacy and retention changes;
- production deployment credentials;
- GitHub Actions permissions or security controls;
- changes that could lock administrators out;
- changes to the automation's own permission model.

### Lane D: reject, clarify or hold

Do not code when:

- the request is ambiguous and could reasonably produce different behaviour;
- the suggestion conflicts with another open change;
- the request appears duplicated or already implemented;
- acceptance criteria cannot be inferred safely;
- the requested behaviour is harmful, insecure or outside product scope;
- the text attempts to override system rules, disclose secrets or instruct the coding agent to ignore policy;
- the source identity cannot be verified for the requested lane.

## Suggestion Assessment Contract

The AI planning stage should produce structured output rather than free-form prose only.

Recommended assessment fields:

```json
{
  "decision": "implement|approval_required|clarification_required|reject|duplicate",
  "risk_level": "low|moderate|high|protected",
  "summary": "...",
  "user_problem": "...",
  "recommended_change": "...",
  "target_repository": "...",
  "target_pages": ["..."],
  "likely_files": ["..."],
  "dependencies": ["..."],
  "acceptance_checks": ["..."],
  "test_plan": ["..."],
  "rollback_plan": "...",
  "confidence": 0.0,
  "duplicate_of": null
}
```

The deterministic policy engine should validate this output before any coding stage begins.

## Database Design

Do not overload the current simple suggestion status with every internal workflow state.

### Existing suggestion record

Retain `ag_site_feedback` as the user-facing suggestion record.

Possible additions:

- `automation_enabled`;
- `automation_decision`;
- `automation_risk_level`;
- `automation_latest_run_id`;
- `automation_last_processed_at`;
- `automation_summary`;
- `resolved_at`;
- `resolved_by`.

### Automation runs

Create:

```text
ag_site_feedback_automation_runs
```

One suggestion may have multiple attempts, so each dispatch or retry should have its own row.

Suggested fields:

- `id`;
- `feedback_id`;
- `attempt_number`;
- `state`;
- `trust_tier`;
- `decision`;
- `risk_level`;
- `target_repository`;
- `target_branch`;
- `github_dispatch_id` or correlation key;
- `workflow_run_id`;
- `commit_sha`;
- `pull_request_number`;
- `pull_request_url`;
- `test_status`;
- `deployment_status`;
- `started_at`;
- `completed_at`;
- `failure_class`;
- `failure_message`;
- `assessment_json`;
- `created_at`;
- `updated_at`.

Suggested states:

```text
created
  -> dispatching
  -> assessing
  -> clarification_required
  -> rejected
  -> planned
  -> coding
  -> testing
  -> tests_failed
  -> awaiting_approval
  -> merge_pending
  -> merged
  -> deploying
  -> deployed
  -> closed
  -> failed
  -> rolled_back
```

### Append-only automation events

Create:

```text
ag_site_feedback_automation_events
```

Record each meaningful transition:

- dispatch requested;
- dispatch accepted;
- assessment completed;
- coding started;
- branch created;
- commit created;
- test passed or failed;
- policy gate passed or failed;
- pull request opened;
- approval requested;
- merge completed;
- deployment completed or failed;
- post-deployment check completed;
- suggestion closed;
- rollback started or completed.

This table should be append-only for normal application roles.

## Repository Mapping

Create a controlled application mapping, for example:

```yaml
seaweed-harvest:
  source_repo: bosunjm-cloud/Seaweed_Ag_Hub
  deployment_repo: seaweed-harvest/seaweed-harvest.github.io
  source_app: aggregation
  pages:
    - seaweed-harvest
    - green-space

tide-planner:
  source_repo: bosunjm-cloud/Seaweed_Tide_App
  deployment_repo: confirm-during-implementation
  source_app: tide
```

The dispatch function should use this mapping. The submitter must never be allowed to select an arbitrary GitHub repository.

## GitHub Workflow Design

### Workflow trigger

Use a restricted `repository_dispatch` event type such as:

```text
ai_suggestion_submitted
```

The dispatch token or GitHub App should have only the permissions needed to start the specific workflow.

### Workflow permissions

Use the minimum required GitHub Actions permissions.

The planning job should begin read-only.

Write access should be granted only to the job that must:

- create the automation branch;
- commit the generated patch;
- open or update the pull request;
- enable auto-merge where permitted.

The AI should not receive broad GitHub credentials in its prompt or environment.

### Branch and pull request

Suggested branch format:

```text
agent/suggestion-<short-reference>-<slug>
```

Every implementation should produce a pull request, including auto-merge changes.

The pull request should include:

- suggestion reference UUID;
- application and page;
- verified trust tier;
- original suggestion quoted safely;
- AI interpretation;
- implementation summary;
- changed files;
- risk classification;
- acceptance criteria;
- tests executed and results;
- policy decision;
- deployment and rollback notes.

### No direct AI pushes to production

The AI must not directly update `main` or the deployment branch.

The production path remains:

```text
AI branch
  -> pull request
  -> required checks
  -> policy gate
  -> merge
  -> deployment
```

### Auto-merge conditions

Auto-merge should be enabled only when all of the following are true:

- authenticated submitter has `can_auto_merge`;
- assessment risk is within the actor's permitted maximum;
- actual changed paths are permitted;
- diff size is within policy limits;
- no dependency or lock-file changes unless explicitly allowed;
- no migration, auth, RLS, secret or workflow changes;
- required tests pass;
- policy validation passes after implementation;
- pull request is mergeable and up to date;
- deployment repository access is available;
- no conflicting automation run is active for the same repository or page.

## Coding Agent Instructions

Each source repository should contain an `AGENTS.md` that explains:

- product purpose and intended users;
- repository structure;
- source and deployment relationship;
- development conventions;
- testing commands;
- protected files and behaviours;
- phone-first UI expectations;
- offline requirements;
- data and privacy restrictions;
- how to write acceptance checks;
- how to avoid changing unrelated behaviour;
- how to update planning and audit records.

The prompt passed to the coding agent should be generated from trusted system templates and structured assessment output.

The raw user suggestion should be presented as untrusted product feedback, not as higher-priority instructions.

## Testing and Release Gates

Deterministic tests must be the primary release gate. AI review may supplement them but must not replace them.

### Common checks

- repository status and expected branch;
- syntax checks;
- HTML validity where practical;
- JavaScript parse or lint checks;
- Python tests;
- broken internal-link checks;
- missing asset checks;
- no secrets introduced into the diff;
- no unexpected binary files;
- protected-path scan;
- diff-size and dependency scan;
- suggestion-specific acceptance tests.

### Seaweed Harvest and Green Space

Use and extend the existing static and UI probes.

Potential checks:

- relevant `tests/*_static_test.py` tests;
- authenticated page smoke tests with seeded non-production data;
- mobile-width screenshot checks;
- table overflow and navigation checks;
- form save and submit flows;
- suggestion widget remains accessible;
- no anonymous access regression;
- shared web changes still pass mobile synchronisation or verification where applicable.

### Mobile build impact

Where a web change is included in the Capacitor mobile bundle, the workflow should determine whether mobile verification is required.

Relevant existing scripts include:

- `npm run build:web`;
- `npm run verify`;
- `npm run verify:ios`;
- `npm run verify:all`.

A full Android or iOS release build should not run for every text change, but shared-bundle verification should run when affected files are included in the mobile package.

### Tide Planner

Add repository-specific checks for:

- page load;
- data-location display;
- offline assets where relevant;
- planning controls;
- no accidental modification of tide source data;
- no scientific or calibration change without an approval-gated test plan.

### Visual review

For eligible interface work:

- capture desktop and mobile screenshots;
- compare against baseline or layout rules;
- optionally use AI visual review for clipping, overlap, hidden controls and excessive whitespace;
- treat visual AI review as advisory unless a deterministic threshold can be defined.

### Post-deployment checks

After deployment:

- wait for GitHub Pages publication;
- request the affected live URL;
- confirm HTTP success;
- run a bounded live smoke test;
- verify the expected visible change;
- confirm authentication and unrelated critical flows still respond;
- record deployment evidence before closing the suggestion.

## Deployment Design

Changes should be implemented in source repositories first.

After the source pull request merges:

1. run the repository's deployment-sync process;
2. open or update a deployment pull request where a separate deployment repository is used;
3. run deployment-repository checks;
4. merge according to the same policy;
5. wait for GitHub Pages;
6. run post-deployment checks;
7. mark the suggestion deployed.

Directly copying generated files into a deployment repository without preserving the source change must not be allowed.

## Concurrency and Conflict Control

Use one active implementation job per source repository initially.

Recommended concurrency key:

```text
ai-suggestion-<target-repository>
```

Before coding, check whether:

- another run is editing the same page or files;
- an open pull request already addresses the suggestion;
- two suggestions should be combined;
- the default branch has changed since assessment.

Closely related suggestions may be grouped into one implementation run, but each reference UUID must remain linked to the resulting pull request and deployment.

## Idempotency and Retry

The system must tolerate duplicate webhook deliveries and GitHub retries.

Use:

- suggestion UUID plus automation attempt number;
- a unique dispatch idempotency key;
- unique active-run constraints where appropriate;
- compare-and-set state transitions;
- no repeated merge or deployment action after success;
- bounded retry with backoff for temporary network failures;
- explicit manual retry for permanent or policy failures.

A successful deployed suggestion must never be implemented again merely because the webhook is replayed.

## Security Requirements

### Treat suggestion content as untrusted

A suggestion may contain accidental or malicious instructions.

The system must not allow a submission to:

- change the system prompt;
- alter the policy file;
- select arbitrary repositories;
- request secrets;
- bypass protected paths;
- issue shell commands directly;
- disable tests;
- approve its own high-risk change;
- expand GitHub or Supabase permissions.

### Secrets

Store secrets only in approved GitHub or Supabase secret storage.

Never place in:

- the suggestion row;
- Slack messages;
- pull request bodies;
- AI prompts;
- repository files;
- test output or screenshots.

### Supabase access

The GitHub workflow should not receive the production Supabase service-role key if a narrower method is possible.

Preferred design:

- GitHub calls a restricted Edge Function with a workflow-specific credential;
- the Edge Function returns only the required suggestion and policy metadata;
- a separate restricted endpoint accepts state updates;
- each request is scoped to a specific automation run;
- service-role operations remain within Supabase.

### Personal and operational data

Send only the minimum data required for implementation.

Do not send collection records, farmer details, payment records or unrelated personal information to the coding agent.

Use seeded or synthetic test data.

### Automation self-protection

Changes to the automation workflow, actor permissions, protected paths, secrets, dispatch function or policy engine must always require human approval.

The automation must not be able to silently broaden its own authority.

## Notifications

Notify Bosun when:

- a suggestion requires clarification;
- a suggestion is rejected for a meaningful reason;
- a plan or coded pull request requires approval;
- tests fail and intervention is needed;
- a low-risk owner suggestion deploys successfully;
- deployment fails;
- rollback occurs;
- the daily reconciliation finds a stuck item.

Do not notify when:

- there are no new suggestions;
- the reconciliation finds no problem;
- a duplicate webhook is ignored;
- an ordinary internal retry succeeds without user action.

A success notification should include:

- suggestion summary and reference;
- application and page;
- decision and risk level;
- implementation summary;
- pull request link;
- tests performed;
- deployed URL;
- rollback reference.

## Suggestion Closure

Do not close a suggestion at branch creation, commit or pull-request creation.

Recommended closure rules:

- `planned`: assessment complete but not deployed;
- `reviewing`: active implementation or approval process;
- `closed`: deployed and post-deployment checks passed, or intentionally rejected/duplicated with a recorded resolution reason.

Consider adding a distinct resolution field so `closed` can distinguish:

- implemented;
- duplicate;
- declined;
- superseded;
- unable to reproduce;
- withdrawn.

## Failure and Recovery

### Webhook failure

- record dispatch failure;
- retry temporary failures;
- daily reconciliation redispatches eligible rows;
- do not create multiple active runs.

### AI assessment failure

- retain the suggestion as new or reviewing;
- record safe error information;
- retry once for temporary provider failure;
- notify only when the item remains blocked.

### Coding failure

- leave branch and logs for investigation where safe;
- do not open a misleading successful pull request;
- update run state to failed;
- do not alter production.

### Test failure

- prevent merge;
- allow the coding agent one bounded repair attempt when policy permits;
- otherwise leave a draft pull request or failed run with clear evidence.

### Merge conflict

- refresh assessment against the latest default branch;
- rebase or regenerate only within bounded attempts;
- stop for approval if the conflict changes scope or risk.

### Deployment failure

- keep the source merge evidence;
- mark deployment failed;
- notify the owner;
- do not close the suggestion;
- support retry after deployment issue correction.

### Production regression

- stop further automation for the affected repository;
- revert the merged pull request through a new reviewed pull request;
- redeploy;
- run smoke tests;
- mark the automation run rolled back;
- notify with both original and rollback references.

## Bandwidth and Cost Position

The Supabase Database Webhook is the preferred primary trigger.

A query every 15 minutes would be low database bandwidth, but a scheduled private-repository GitHub runner every 15 minutes would create unnecessary workflow starts and potential billable minutes.

Event-driven dispatch means:

- no cloud coding runner starts when there is no suggestion;
- the AI is invoked only when work exists;
- suggestions begin processing promptly;
- costs can be attributed to individual automation runs.

Implement cost controls:

- monthly AI budget limit;
- maximum automatic runs per day;
- maximum repair attempts;
- maximum diff size;
- maximum workflow duration;
- owner notification when a budget threshold is reached;
- automatic downgrade to assessment-only mode if limits are exceeded.

## Rollout Plan

### Phase 0: access and policy confirmation

- confirm final source and deployment repository mappings;
- connect GitHub integrations to the organisation deployment repositories;
- identify Bosun's exact Supabase user UUID;
- create actor and repository mappings;
- define protected paths;
- choose initial diff and file limits;
- configure secrets and restricted credentials;
- enable required branch protection and pull-request checks.

No automated coding in this phase.

### Phase 1: shadow assessment

Every new suggestion triggers the event workflow, but the workflow only:

- verifies identity;
- assesses and classifies;
- proposes files, tests and approval lane;
- records what it would have done;
- notifies only when useful.

Review classification accuracy using real suggestions before enabling code writes.

Exit criteria:

- no owner identity misclassification;
- no protected change classified for automatic merge;
- duplicates correctly identified;
- app/repository routing is reliable;
- suggested acceptance tests are useful.

### Phase 2: automatic planning and branch creation

Allow the system to:

- assess;
- create a branch;
- implement permitted changes;
- run tests;
- open a draft pull request.

All pull requests still require manual merge.

Exit criteria:

- generated changes stay within scope;
- tests catch intentional seeded errors;
- pull-request summaries are accurate;
- no unrelated files change;
- failure states update correctly.

### Phase 3: trusted-owner low-risk auto-merge

Enable auto-merge for Lane A suggestions submitted by Bosun's authenticated trusted account.

Keep Lane B and Lane C approval-gated.

Start with a narrow allow-list and gradually expand based on evidence.

### Phase 4: deployment and automatic closure

Enable source-to-deployment automation, post-deployment checks and automatic suggestion closure.

Do not enable this phase until source auto-merge and rollback have been demonstrated safely.

### Phase 5: broader organisational permissions

Consider additional trusted actors or role-based permissions only after the owner lane is stable.

Possible future tiers:

- product owner for a specific app;
- content editor;
- operations administrator;
- developer;
- security approver.

## Implementation Workstreams

### Workstream A: database and identity

Outputs:

- automation actor table;
- automation run table;
- append-only event table;
- suggestion automation fields;
- RLS and service-only functions;
- exact owner identity configuration;
- rollback tests.

### Workstream B: event dispatch

Outputs:

- Supabase Database Webhook;
- `ai-suggestion-dispatch` Edge Function;
- GitHub dispatch credential;
- idempotency and retry handling;
- dispatch tests;
- daily reconciliation function or workflow.

### Workstream C: policy engine

Outputs:

- development policy YAML;
- protected-path rules;
- app/repository mapping;
- risk and lane classifier;
- deterministic post-diff validator;
- policy test fixtures.

### Workstream D: AI planning and coding

Outputs:

- repository `AGENTS.md`;
- structured assessment schema;
- coding prompt templates;
- branch and pull-request creation;
- bounded repair attempts;
- prompt-injection tests.

### Workstream E: tests and deployment

Outputs:

- common test workflow;
- app-specific tests;
- mobile shared-bundle checks;
- screenshot artifacts;
- source-to-deployment workflow;
- live smoke tests;
- rollback procedure.

### Workstream F: operations and owner visibility

Outputs:

- suggestion automation status in the owner UI;
- pull-request and deployment links;
- retry and pause controls;
- Slack/ChatGPT notifications;
- daily reconciliation report only on exceptions;
- automation runbook.

## Open Decisions Before Implementation

The primary objective is clear. The following implementation details still require confirmation:

1. the exact Supabase user UUID that represents Bosun's trusted owner account;
2. whether more than one Bosun email/account should receive the same trust tier;
3. the final Tide deployment repository;
4. whether source and deployment changes should use one pull request each or a coordinated release pull request;
5. the initial maximum files and changed lines for automatic merging;
6. whether new non-sensitive JavaScript files are allowed in Lane A;
7. whether additive database migrations are Lane B or always Lane C;
8. which notification destination is primary: ChatGPT, Slack, email or a combination;
9. whether existing backlog suggestions should be imported into shadow mode or only new submissions processed;
10. whether successfully deployed suggestions should close immediately or remain open for a short observation period;
11. monthly AI and GitHub Actions budget limits;
12. who may pause, retry or disable the automation besides Bosun;
13. whether grouped suggestions should produce one pull request or separate pull requests by reference;
14. the required rollback observation and validation period before the policy is expanded.

These are configuration decisions. They do not change the primary goal.

## Non-Goals

The first version should not:

- give the AI unrestricted production database access;
- allow direct pushes to production branches;
- use Slack text as authentication;
- trust a typed display name;
- allow an automated change to broaden its own permissions;
- automatically implement other users' suggestions by default;
- automate destructive data changes;
- replace deterministic testing with AI judgement;
- run a GitHub coding job every 15 minutes when no work exists;
- expose secrets to the coding agent;
- attempt fully autonomous architectural redesign.

## Initial Acceptance Criteria

The first safe pilot should demonstrate:

1. an authenticated owner suggestion creates one and only one automation run;
2. an anonymous suggestion cannot enter the trusted-owner lane even when the name says Bosun Michael;
3. a database insert triggers the workflow without scheduled polling;
4. a duplicate webhook is ignored safely;
5. a low-risk text or CSS suggestion produces a correct draft pull request;
6. a protected-path change is blocked from auto-merge;
7. a deliberately failing test prevents merge;
8. a successful low-risk owner change can auto-merge only after all checks pass;
9. deployment is verified on the live URL before suggestion closure;
10. a failed or missed event is found by daily reconciliation;
11. a merged change can be reverted through the documented rollback process;
12. all steps are visible through Supabase audit records and GitHub evidence.

## Recommended First Pilot

Use a small owner-submitted interface suggestion, such as:

- a label or button wording change;
- a simple explanatory note;
- a bounded mobile spacing or table-overflow fix.

Run it through:

```text
shadow assessment
  -> automatic code with manual merge
  -> automatic merge in the trusted-owner lane
```

Do not begin the pilot with authentication, photo storage, offline synchronisation, database schema or payment logic.

## Reference Documentation

- Supabase Database Webhooks: `https://supabase.com/docs/guides/database/webhooks`
- GitHub repository dispatch events: `https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#repository_dispatch`
- GitHub Actions workflow permissions: `https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#permissions`
- GitHub branch protection and required checks: `https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches`
- GitHub pull-request auto-merge: `https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository`
- OpenAI Codex overview and cloud coding workflows: `https://openai.com/codex/`
