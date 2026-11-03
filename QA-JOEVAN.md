# QA SLICE: JOEVAN (Backend)

## JOE-QA-02 integration acceptance (2026-11-02, Asia/Manila)

Full evidence, transition matrix, failure ledger and Developer B handoff: [JOE_QA_02_BACKEND_ACCEPTANCE_REPORT.md](docs/JOE_QA_02_BACKEND_ACCEPTANCE_REPORT.md).

- Original branch/HEAD preserved: `qa/joevan-backend-20261102`, `a6a0de5bf36c77a43d948b98f821940bac41df3d`. Integrated backend equals A commit `cc5e8f6`; DEV-A-01/R1 was not reimplemented. No frontend changes, migrations added, commits, pushes, merges or deployments.
- New clinical, booking/session, refund and notification regressions: **26 passed / 241 assertions**. Focused Treatment/Appointment/Payment/Auth/Notification run: **306 passed / 2,639 assertions**, including real PostgreSQL concurrency. Tests used only a newly created, independently verified tmpfs PostgreSQL scratch container; no clinic/shared database or live payment operation.
- AccountRecovery full-suite discrepancy reproduced with controlled memory pressure: default 128 MB worker stops after one job. Test-only correction supplies PHPUnit's 1024 MB worker budget and adds successful-exit/empty-queue assertions; original mail assertions retained. No authentication or mail application behavior changed.
- Original full suite: **963 tests, 40 failures, 1 error**. Independent untouched-baseline exact-name replay reproduced **39 of those 41 cases**. Final full suite: **989 tests / 10,741 assertions, 950 passed, 38 failures, 1 error**; every remaining failure/error is in that baseline set. Account recovery and owner summary pass in the final full run; the earlier intermittent summary failure remains documented. No green full-suite claim.
- Frontend verification: **1,025 passed / 5 existing skips / 0 failures**, render smoke and production build passed. Deployment preflight: **9 FAIL / 3 WARN** for absent hosted services/provider/mail/demo setup. These do not establish authenticated browser acceptance.
- **STF-14 current acceptance is blocked by an actual contradiction:** retained Waiting/Called/Ready states are required by the clinical contract despite the historical Done/removal wording below. STF-15 FIFO also conflicts with old priority tests/frozen wording. Preserve historical evidence; Yzhekiel must approve reconciliation before state/data changes. OWN-13 inherits this vocabulary dependency.
- **GEN-10 remains Partial:** account-bound retrieval/read/read-all and deduplication tested; archive/restore, historical branch/role revocation semantics and operational-shell persistence remain dependencies. Do not complete GEN-11 implicitly.
- Developer B dependencies: propagate dependent identity through every availability search, preserve explicit `pay_at_clinic:false`, and consume the booking quotation before online activation. No backend frontend-compatibility or deployment sign-off is implied by source identity or unit results.
- Previously unchecked STF-05/STF-23/OWN-01/OWN-02/03 support rows below are reconciled to existing endpoint evidence only. Their primary owners' UI/deployment acceptance and original seven-day-plan checkboxes remain unchanged. Staff schedule support is existing basic shifts, not new weekly/leave policy.

**Disposition:** evidence prepared for technical-lead review; overall integration acceptance remains blocked by the documented contract, historical-suite and cross-developer dependencies.

## Batch A1 — Gemini API authorization (2026-10-29, Asia/Manila)

### Acceptance follow-up (supersedes the initial database-test pending status below)

- Starting commit `4947b3d307c15a29f06bd03cab708dd98b867e09` on the same published feature branch; unrelated `.agents/teamwork/` preserved. No application authorization changes were needed.
- Original local testing configuration: PostgreSQL/loopback port 5433, no URL override, not the required scratch database; connection probe failed. No existing database was modified. Docker engine was initially stopped; started the installed Docker Desktop and created **only** container `joevan-gemini-a1-acceptance-20261029` from the already-installed `postgres:16-alpine` image. PostgreSQL data is in tmpfs, with no existing volume mounts; host binding is `127.0.0.1:5432`. Local trust authentication is confined to this disposable test instance. Existing stopped containers were not started or changed.
- Before test writes, independently checked the container mount/port/network configuration and queried through Laravel: actual database `dental_clinic_scratch`, PostgreSQL server port 5432, internal server address `172.17.0.2`, **zero public tables**. Only then ran migration-backed tests. No protected database or Developer B machine was accessed. Environment files and credentials were neither printed nor changed.
- Scratch guard: default checks remain unchanged; explicit process-only `TEST_SCRATCH_SERVER_ADDRESS` permits the independently verified Docker internal server address instead of assuming the server sees the client-side loopback address. Required local client host/port, exact scratch database, testing mode and absent URL remain enforced. Added tests proving default mismatch refusal, explicit address acceptance, protected database refusal before connection, and wrong-container refusal.
- Test-process overrides: `APP_ENV=testing`, `DB_CONNECTION=pgsql`, `DB_HOST=127.0.0.1`, `DB_PORT=5432`, `DB_DATABASE=dental_clinic_scratch`, `DB_USERNAME=postgres`, blank `DB_PASSWORD`/`DB_URL`, `TEST_SCRATCH_SERVER_ADDRESS=172.17.0.2`, `PAO_DISABLE=true`. Reinspect the new container identity before any future run; its address is not a permanent machine setting.
- `php vendor/phpunit/phpunit/phpunit tests/Feature/Assistant/GeminiChatTest.php tests/Feature/Assistant/GeminiAuthorizationTest.php`: **22 passed, 140 assertions**. Persisted tests use real `/api/login`, forget cached guards between requests, and consume actual mocked SSE bodies. Verified Patient JSON/SSE success, Staff/Dentist/Owner 403, Patient-role account without profile 403, suspension revocation and subsequent 401, stale-session rejection after restoration, and no upstream requests on denial. Existing Gemini fallback, medical/emergency and prompt tests passed too.
- `php vendor/phpunit/phpunit/phpunit tests/Feature/Auth/ProductionHardeningTest.php --filter 'test_suspension_revokes_an_existing_session|test_a_session_recreated_by_an_inflight_request|test_login_regenerates_session'`: **3 passed, 15 assertions**.
- `php vendor/phpunit/phpunit/phpunit tests/Unit/GeminiScratchGuardTest.php`: **4 passed, 13 assertions**, no database. Total focused acceptance: **29 passed, 168 assertions**. PHP syntax and diff whitespace checks passed. Full suites/frontend checks were not repeated: this follow-up changes only test support, tests and documentation; original A1 frontend/smoke/build evidence remains below.
- Separate governance record: `docs/ASSISTANT_PRIVACY.md`, Gemini section. Authenticated free text/history can leave for Google whenever the Gemini key is configured, independently of the main assistant's knowledge-mode switch. No live requests ran; provider/data-governance acceptance remains open. No new activation policy was implemented.
- **Classification:** focused backend authentication and persisted-identity acceptance **passed on isolated PostgreSQL**. Production provider/data-governance approval remains **pending**; this is not production AI approval. No module status promotion.
- After verification, stopped the exact newly created container by its inspected ID; `--rm` discarded its temporary synthetic data. Docker Desktop remains running; no existing containers or environment files were changed.

- Baseline: `integration/developer-a-b` at `73ed1ca40a36682fda71dc87e166c4d802048626`; branch `feature/joevan-gemini-api-hardening-20261029`. Existing untracked `.agents/teamwork/` preserved.
- Confirmed in source: POST `/api/gemini/chat` and `/api/gemini/stream` had only throttling, outside Sanctum/account middleware; ordinary requests could reach provider calls anonymously when configured. Existing Gemini tests also expected anonymous success. This conflicts with the Patient-only assistant authority in `docs/M7_PRODUCTION_HARDENING.md` sections 3/6, `docs/MODULE_IPO_BLUEPRINT.md`, and `AssistantController`. No approved public Gemini contract or frontend Gemini caller was found; current frontend uses `/api/assistant/*`.
- Both Gemini routes now use existing Sanctum, account revalidation, Patient role middleware and the existing per-account M7 throttle. Controller checks a linked Patient profile before processing. Staff/Dentist/Owner remain unauthorized. JSON and SSE response formats and medical/emergency refusals are preserved.
- Inputs are bounded message/history only; unexpected fields (including branch/patient selectors and extra history fields) return 422. These informational endpoints load public clinic context, not branch-restricted patient resources; cross-branch resource access is not applicable. Injected resource selectors are explicitly rejected before upstream work.
- Provider exceptions no longer log exception messages (which can contain credential-bearing URLs or content). HTTP errors still log status only and return safe fallback responses.
- Focused executable evidence: `PAO_DISABLE=true php vendor/phpunit/phpunit/phpunit tests/Feature/Assistant/GeminiAuthorizationTest.php` (PowerShell: `$env:PAO_DISABLE = 'true'` first): **10 passed, 67 assertions**. Tests boot real routes/middleware with in-memory identities, block every configured database connection, fake all HTTP, and mock public prompt/fallback context. Covers 401, role/profile/account 403, validation 422, throttle 429, JSON/SSE success, upstream error/exception privacy and no upstream calls on rejection. Account refresh uses an in-memory test double; persisted session revocation is not reverified here.
- PHP syntax checks passed for controller, routes and both Gemini test files; `git diff --check` passed. Existing database-backed `GeminiChatTest` now authenticates a Patient fixture; **not executed**. Scratch database remains unverified; no database-writing tests, migrations or live Gemini requests ran. Full backend suite and predefense environment checks remain unexecuted to avoid unverified database/service access.
- No Developer B frontend files or QA ownership records changed. Live Gemini acceptance and database-backed regression remain pending; module status is unchanged. This batch does not claim broader Gemini output-safety or live-provider approval.
- Frontend verification: `npm.cmd test` **954/954 passed**, `npm.cmd run test:smoke` passed, `npm.cmd run build` passed. Initial sandbox runs failed on esbuild parent-directory access; approved runs outside the sandbox passed. Existing React key and Vite chunk-size warnings remain. GitHub CLI is absent, so PR creation through `gh` is unavailable.
## Rapid A2 — RIC-2 messaging (2026-10-29)

Joevan implements STF-21/22/23/24 and DEN-14 under the authorized reassignment, independently from integration on `feature/joevan-ric2-messaging-rapid-20261029`. Evidence and limitations: `docs/RIC2_MESSAGING_ACCEPTANCE.md`; affected entries updated in `QA-RICHMON.md`. STF-22/23/24 and DEN-14 pass focused backend/browser acceptance; STF-21 stays partial pending a reviewed active-Dentist/history contract. No Gemini application changes, GEN-07/09 files, production data or shared-branch merges are included.

> Self-contained slice of FINALS-QA-REVISIONS.md. Give Claude THIS file only, plus the context pack and the code files for the batch you are working on.
> **This file is the source of truth for Joevan's status.** Update `status` fields and tick checkboxes here.
> Master reference: FINALS-QA-REVISIONS.md (assumptions, default decisions, full matrix, other members' work).

---

## Your 7-Day Plan

- [ ] **Day 1:** GEN-05 (kiosk removal), STF-14, STF-15 (queue model; merge EOD for Celin)
- [ ] **Day 2:** GEN-10 backend (notifications), STF-23 search endpoint, STF-05 summary endpoint
- [ ] **Day 3:** STF-20, STF-18, STF-19, OWN-13
- [ ] **Day 4:** OWN-01 endpoints, OWN-02/OWN-03 data, OWN-11 (all merged by end of Day 4)
- [ ] **Day 5:** Tests + hardening on all owned items; migrations dry-run on a copy of data
- [ ] **Day 6:** Bug fixes; performance check on chart queries (no new features)
- [ ] **Day 7:** Backend regression (queue, billing, HMO, kiosk search); final retest; sign-off

**Feature freeze at end of Day 5.** Days 6 and 7 are fixes and regression only.

<dependencies>
  <you_need_from_others>Team: final list of remaining queue statuses (STF-14) and confirmation of existing payment options (STF-18) before Day 1/3. Jaztin: GEN-11 for notification soft-delete (Day 1).</you_need_from_others>
  <others_need_from_you>Celin: queue model (Day 1), notification endpoints (Day 2). Yzhekiel: summary endpoint (Day 2). Richmon: search (Day 2), charts/branch data (Day 4).</others_need_from_you>
</dependencies>

---

## Project Context Pack

<context_pack status="FILL BEFORE DAY 1">
  <stack>frontend: [framework] | backend: [framework] | database: [db] | hosting: [where]</stack>
  <repo>url: [repo url] | default branch: [main] | package manager: [npm/yarn/pnpm]</repo>
  <key_paths>
    staff_dashboard: [path]
    dentist_dashboard: [path]
    owner_dashboard: [path]
    shared_components: [path]
    dental_chart_component: [path]
    calendar_component: [path]
    api_routes: [path]
    db_schema_and_migrations: [path]
    auth_and_rbac: [path]
    notifications: [path]
    live_queue: [path]
  </key_paths>
  <commands>run: [cmd] | test: [cmd] | lint: [cmd] | build: [cmd] | migrate: [cmd]</commands>
  <roles>Owner (Dr Dana), Dentist, Staff. Confirm exact role names used in code.</roles>
  <test_accounts>owner: [..] | dentist: [..] | staff: [..]</test_accounts>
  <design_reference>[Figma link or screenshots folder]</design_reference>
  <attach_rule>When prompting Claude, attach the actual files from key_paths that the batch touches. Claude must not invent file paths, endpoints, or field names; if one is missing, it asks.</attach_rule>
</context_pack>

### Before Day 1 checklist
- [ ] Context pack filled in
- [ ] Open questions Q1 to Q5 answered, or the default decisions accepted
- [ ] Exact reproduction steps for DEN-03 (otherwise it is a blocker)
- [ ] Final list of remaining live queue statuses (STF-14)
- [ ] Screenshots or screen recordings for UI anomalies: GEN-04, GEN-06, STF-03/DEN-04
- [ ] Branches and test accounts ready for every role

---

## Working Agreement

<working_agreement>
  <source_of_truth>Each member updates status ONLY in their own slice file (QA-<NAME>.md). This master file is the reference; the lead syncs the Progress Summary at the end of each day. This avoids merge conflicts in one shared file.</source_of_truth>
  <shared_component_owners>
    Design tokens, style guide, calendar: Richmon
    Dropdown, buttons, dental chart: Yzhekiel
    Search input, X-clear filter, notif button, refresh icon, notifications UI: Celin
    Soft delete + archive RBAC service, approval automation: Jaztin
    Live queue model, branch scoping, notification/search/chart endpoints: Joevan
    Rule: do not edit a component you do not own. Log the request in the Blockers table instead.
  </shared_component_owners>
  <git>
    Branch: qa/<member>-<batch-id> (example: qa/jaztin-JAZ-1)
    One commit per revision ID, message: [ID] short title
    PR per batch; title: [BATCH] name; description lists IDs and acceptance results
    Foundation PRs (Day 1) are merged first; everyone rebases before starting Day 2
  </git>
  <cadence>
    15-minute sync at the start of each day: yesterday done, today plan, blockers.
    Feature freeze at end of Day 5. Days 6 and 7 are fixes and regression only.
    Any item not done by end of Day 5 is escalated to the lead at the Day 6 sync.
  </cadence>
</working_agreement>

---

<default_decisions>
  <note>If no answer is given before Day 1, Claude and the team proceed with these defaults. Anything marked CONFIRM is a proposal, not a fact from the QA notes.</note>
  <d id="Q1" item="OWN-10">Owner Work schedule reuses the staff schedule component and logic (STF-07, STF-08) and manages both dentists and staff (OWN-11).</d>
  <d id="Q2" item="OWN-01">Line graph = daily revenue. Histogram = per-day revenue Monday to Saturday, generated on Saturday.</d>
  <d id="Q3" item="STF-19">Provider names exactly as typed: Intellicare, Avega, InLife iCare, eTiQa, Dental Network.</d>
  <d id="Q4" item="GEN-11">RBAC as stated: Dr Dana sees all archives; Staff sees staff-created only; Dentist sees dentist-created only.</d>
  <d id="Q5" item="STF-13">Proposed walk-in design is accepted as written in the item.</d>
  <d id="STF-14" item="STF-14">CONFIRM: remaining queue statuses = In queue, In treatment, Done (keep any cancelled/no-show status that already exists).</d>
  <d id="STF-18" item="STF-18">Do not invent payment methods. Keep the existing options and only replace the "Invoice" wording with "Payment method".</d>
  <d id="DEN-03" item="DEN-03">BLOCKER until exact reproduction steps are added. Do not start without them.</d>
</default_decisions>

---

## 5. Instructions for Claude

<claude_instructions>
  1. Work only on the member and batch the user names. Read the whole batch first.
  2. Check `depends_on`. Build shared components once and reuse them across dashboards.
  3. Fix items in order. Stay within each item's scope and say so when you touch anything else.
  4. Satisfy every acceptance line before marking an item done. Flag anything unclear instead of guessing.
  5. UI standards: responsive (mobile/tablet/desktop), all states (hover, focus, active, disabled, loading, error), keyboard accessible, consistent with the shared design tokens.
  6. Backend standards: server-side validation, RBAC on every protected action, explicit error handling, no duplicate submissions, soft-delete only (see GEN-11), no secrets in logs.
  7. After the batch, run the batch verification and summarize changes per ID.
  8. Clarification protocol: if an item has `needs_clarification`, an unapproved `proposed_design`, or you lack a required file, stop and ask before coding. Never invent file paths, endpoints, or field names; find them in the attached code or ask.
  9. Keep changes small: one revision ID per commit, message `[ID] short title`. Do not edit components owned by another member (see Working Agreement); describe the needed change instead.
  10. Report format per ID: files changed, summary, how to test, acceptance results (pass/fail), and anything not done.
  11. Respect the schedule: do the ID order in the 7-day plan; flag any item that cannot finish that day.
</claude_instructions>

<global_dependencies>
  GEN-11 (archive + RBAC) must land before any delete UI is changed (STF-25, DEN-16, GEN-10 delete button).
  GEN-08 (design tokens) should land first so other UI work uses shared styles.
  GEN-14 (calendar component) feeds STF-01, OWN-07, OWN-08, OWN-09.
  STF-14/15 (queue model) must land before STF-16/17 and OWN-13.
  GEN-01 (approval automation) feeds STF-06, STF-11, DEN-15.
</global_dependencies>

---

## Definition of Done

<definition_of_done>
  A revision is `done` only when ALL are true:
  - [ ] Every task checkbox is ticked and every acceptance line passes
  - [ ] Works on Staff, Dentist, and Owner dashboards where the item applies ("same as" items reuse the shared component)
  - [ ] UI items: checked at mobile, tablet, desktop; all states present (hover, focus, disabled, loading, error); uses design tokens
  - [ ] Backend items: server-side validation, RBAC enforced, errors handled, tests added, no hard delete, no secrets in logs
  - [ ] No new console errors; build, lint, and tests pass
  - [ ] PR reviewed by one other member
  - [ ] Status set to done in the owner's slice file
</definition_of_done>

---

## Ready-to-Paste Prompts for Your Batches

Paste the context pack + this file, then use the prompt for the batch you are on.

**JOE-1 (Kiosk removal): items GEN-05**
```text
Work ONLY on batch JOE-1 (Kiosk removal): GEN-05.
Follow <claude_instructions> and the clarification protocol in this file.
Attached code: [attach the files from key_paths this batch touches]
Step 1: list your plan per ID and any blocking questions; wait for my go.
Step 2: implement one ID at a time.
Step 3: per ID report files changed, summary, how to test, acceptance pass/fail, not done.
```
**JOE-2 (Live queue and branch scoping): items STF-14, STF-15, STF-20, OWN-13**
```text
Work ONLY on batch JOE-2 (Live queue and branch scoping): STF-14, STF-15, STF-20, OWN-13.
Follow <claude_instructions> and the clarification protocol in this file.
Attached code: [attach the files from key_paths this batch touches]
Step 1: list your plan per ID and any blocking questions; wait for my go.
Step 2: implement one ID at a time.
Step 3: per ID report files changed, summary, how to test, acceptance pass/fail, not done.
```
**JOE-3 (Billing, HMO, and schedules): items STF-18, STF-19, OWN-11**
```text
Work ONLY on batch JOE-3 (Billing, HMO, and schedules): STF-18, STF-19, OWN-11.
Follow <claude_instructions> and the clarification protocol in this file.
Attached code: [attach the files from key_paths this batch touches]
Step 1: list your plan per ID and any blocking questions; wait for my go.
Step 2: implement one ID at a time.
Step 3: per ID report files changed, summary, how to test, acceptance pass/fail, not done.
```

For bug fixes, self-check before PR, and end-of-day status, use templates B, C, D in the master file (section 9).

---

# YOUR TASKS

<member_section name="Joevan" track="backend" primary_count="8">

<task_list>
**Batch JOE-1: Kiosk removal**
- [x] GEN-05 !!! Remove everything about kiosk

**Batch JOE-2: Live queue and branch scoping**
- [x] STF-14 Live queue: remove (waiting, called, treatment ready, temporarily away)
- [x] STF-15 Live queue: remove the urgent queue priority
- [x] STF-20 Social Inquiries: Record and Inquiry: remove the dropdown for choosing branch
- [x] OWN-13 Live queue by branch: same

**Batch JOE-3: Billing, HMO, and schedules**
- [x] STF-18 Billing and payment: remove the invoice and replace the text with payment method
- [x] STF-19 HMO providers (Intellicare, Avega, InLife iCare, eTiQa, and Dental Network)
- [x] OWN-11 Work schedule: add staff as option so it's dentist and staff

**Support tasks**
- [ ] GEN-10 (support Celin): notifications grouped-by-date and soft-delete endpoints
- [x] STF-05 (support Yzhekiel): aggregated dental chart summary endpoint — existing chart `summary` verified by DentalChartTest; JOE-QA-02 report records role limits.
- [x] STF-23 (support Richmon): message search endpoint — existing scoped search verified by MessageSearchTest; preserves Rapid A2 evidence.
- [x] OWN-01 (support Richmon): daily revenue and weekly summary endpoints — existing on-demand endpoints verified; does not certify a scheduled Saturday artifact.
- [x] OWN-02 / OWN-03 (support Richmon): branch code list and coordinates storage — existing Owner update/validation verified by OwnerBranchAcceptanceTest; no new backend preset whitelist.
</task_list>

<batch id="JOE-1" name="Kiosk removal" priority="high">
  <goal>No trace of the kiosk remains in code, data, routes, or UI.</goal>
  <depends_on>none</depends_on>

  <revision id="GEN-05" status="done" severity="high" owner="Joevan" support="Celin">
    <tasks>
      - [x] Search the entire codebase for "kiosk" (routes, pages, components, APIs, DB tables/columns, enums, config, env, docs, seeds, tests)
      - [x] Remove or migrate each reference; handle existing data safely (migration + backup)
      - [x] (Celin) Remove kiosk menu items, buttons, labels, and settings from the UI
      - [x] Make sure queue and check-in flows still work without kiosk-originated entries
    </tasks>
    <hardening>Broken references, orphaned records, dead routes returning errors, migration rollback plan.</hardening>
    <acceptance>A repo-wide search for "kiosk" returns nothing; app builds and all flows pass.</acceptance>
  </revision>

  <batch_verification>
    - [x] Repo-wide search returns no matches (excluding historical/unalterable records)
    - [x] Build, tests, and migrations pass
  </batch_verification>
</batch>

<batch id="JOE-2" name="Live queue and branch scoping" priority="high">
  <goal>Simplified live queue model and automatic branch scoping.</goal>
  <depends_on>JOE-1</depends_on>

  <revision id="STF-14" status="done" severity="medium" owner="Joevan" support="Celin">
    <tasks>
      - [x] Remove the statuses: Waiting, Called, Treatment ready, Temporarily away
      - [x] Migrate existing queue entries to the remaining statuses; update status enums/validation
      - [x] Confirm with the team what the remaining queue statuses are before migration
    </tasks>
    <acceptance>Removed statuses no longer exist in data or UI; existing entries are migrated cleanly.</acceptance>
  </revision>

  <revision id="STF-15" status="done" severity="medium" owner="Joevan" support="Celin">
    <tasks>
      - [x] Remove the urgent queue priority from data, logic, sorting, and UI
      - [x] Queue order becomes first-come-first-served
    </tasks>
    <acceptance>No urgent priority anywhere; queue order is by arrival.</acceptance>
  </revision>

  <revision id="STF-20" status="done" severity="medium" owner="Joevan" support="Celin">
    <tasks>
      - [x] Social Inquiries (Record and Inquiry): remove the branch selection dropdown
      - [x] Auto-scope to the user's branch from the session
    </tasks>
    <acceptance>No branch dropdown; records are saved under the user's branch.</acceptance>
  </revision>

  <revision id="OWN-13" status="done" severity="medium" owner="Joevan" support="Celin">
    <tasks>
      - [x] Apply STF-14, STF-15, STF-16, STF-17 to Live queue by branch (owner view keeps the branch filter)
    </tasks>
    <acceptance>Owner live queue by branch matches staff queue behavior.</acceptance>
  </revision>

  <batch_verification>
    - [x] Queue tested across branches
    - [x] No leftover removed statuses or priority
  </batch_verification>
</batch>

<batch id="JOE-3" name="Billing, HMO, and schedules" priority="medium">
  <goal>Billing and HMO data are correct; work schedules support dentists and staff.</goal>
  <depends_on>none</depends_on>

  <revision id="STF-18" status="done" severity="medium" owner="Joevan" support="Celin">
    <tasks>
      - [x] Billing and payment: remove the "Invoice" text/option
      - [x] Replace it with "Payment method" (field and label)
      - [x] Confirm payment method options with the team (e.g. cash, card, HMO)
    </tasks>
    <acceptance>No "Invoice" wording; Payment method is shown and saved.</acceptance>
  </revision>

  <revision id="STF-19" status="done" severity="medium" owner="Joevan" support="Celin">
    <tasks>
      - [x] Add HMO providers: Intellicare, Avega, InLife iCare, eTiQa, Dental Network (see Q3)
      - [x] Store as a managed list (not hard-coded) and use in billing and patient records
    </tasks>
    <acceptance>All five HMO providers are selectable in billing and patient records.</acceptance>
  </revision>

  <revision id="OWN-11" status="done" severity="medium" owner="Joevan" support="Richmon">
    <tasks>
      - [x] Add "Staff" as a selectable option in Work schedule alongside Dentist
      - [x] Support schedules for both roles; feed STF-07 duty status
    </tasks>
    <hardening>Role-based permissions, overlapping schedules.</hardening>
    <acceptance>Work schedule can be set for dentists and staff.</acceptance>
  </revision>

  <batch_verification>
    - [x] Billing flow tested with each HMO and payment method
    - [x] Staff and dentist schedules save correctly
  </batch_verification>
</batch>

</member_section>
