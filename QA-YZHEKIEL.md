# QA SLICE: YZHEKIEL (UI/UX)

## YZH-QA-02 R2 — new-prescription Visit identity (2026-11-03, Asia/Manila)

The independent R1 re-audit's remaining P1 was reproduced before editing: all four delayed new-prescription Save/Issue success/failure cases failed. R2 adds synchronous Visit-selection generation ownership, starts an explicitly changed Visit with blank medicine/note state, and suppresses stale completion effects without retargeting or replaying the original command. Final R2 browser matrix: **52/52**, including A → B → A success/failure, B's own error, active B Save/Issue, and both Issue response stages. Existing R1 matrix **52/52**, booking/clinical/original prescription/calendar harnesses PASS; full frontend **1028 passed, 0 failed, 5 skipped**, smoke/build PASS. See report section K and `docs/ui-review/yzh-qa-02/r2/`. **GO FOR READ-ONLY R2 RE-AUDIT** only; authenticated E2E, GEN-06/DEN-03 and deployment/predefense limitations remain. No commit, backend change or database operation.

## YZH-QA-02 independent acceptance — 2026-11-02 (Asia/Manila)

**Post-audit R1:** the two P1 findings (stale prescription write completion and disabled quotation recovery) and two P2 findings (calendar A/pending-B/A and online-payment copy) are corrected in the same workspace. Deterministic browser regressions and all four widths are recorded in report section J. R1 full suite: **1028 passed, 0 failed, 5 skipped**; smoke/build pass. Prior QA-02 evidence preserved byte-for-byte. Recommendation: **GO FOR READ-ONLY RE-AUDIT**, with authenticated acceptance still blocked; no commit/integration authorization implied.

Branch `qa/yzhekiel-ui-20261102`, baseline HEAD `a6a0de5bf36c77a43d948b98f821940bac41df3d`, initially clean. See [cross-role acceptance report](docs/YZH_QA_02_CROSS_ROLE_ACCEPTANCE_REPORT.md) for reproductions, bounded frontend corrections, screenshots, exact commands and closure checklist.

- Reproduced/corrected: same-month booking calendar retaining another branch's availability; dependent search/create context mismatch; integrated payment quote/capability not consumed; prescription draft A's delayed response replacing draft B. No backend edits.
- Synthetic browser coverage: 390/768/1024/1440 for booking, shared controls, Staff check-in/walk-in combobox, clinical queue/editor/chart, and Dentist Home/Schedule. Prescription late-response test fails before correction and passes after it; Save stays Draft and Issue requires confirmation.
- Baseline reproduced: 1025 passed / 0 failed / 5 skipped. Final frontend: 1028 passed / 0 failed / 5 skipped; smoke/build pass. Existing Table key/chunk warnings remain. Required predefense check is blocked by existing CRLF at line 8.
- **GEN-06 remains blocked/unverified**: no evidence tying the original vague report to a global dropdown defect; shared-control and selected active-page tests are not exhaustive authenticated cross-role acceptance. **DEN-03 remains unverified**, independent of passing current schedule/date checks. Existing Done statuses and Jaztin/Richmon/Celin ownership unchanged.
- **Authenticated cross-role end-to-end acceptance: BLOCKED — approved authenticated synthetic session unavailable**, confirmed by the user. Only synthetic/intercepted browser work authorized. No production account, real record, existing clinic credential or auth bypass used. Remaining prerequisites and exact scenarios are in report section H.
- No commit, merge, push or deployment; nothing staged. Ready for bounded code review with these acceptance gates outstanding.

---

> Self-contained slice of FINALS-QA-REVISIONS.md. Give Claude THIS file only, plus the context pack and the code files for the batch you are working on.
> **This file is the source of truth for Yzhekiel's status.** Update `status` fields and tick checkboxes here.
> Master reference: FINALS-QA-REVISIONS.md (assumptions, default decisions, full matrix, other members' work).

---

## Your 7-Day Plan

- [ ] **Day 1:** GEN-06, GEN-12 (shared dropdown + button components; merge EOD)
- [ ] **Day 2:** GEN-07, STF-03, DEN-04 (shared dental chart fix)
- [ ] **Day 3:** STF-04, DEN-10, DEN-05, STF-05 UI (needs Joevan summary endpoint from Day 2)
- [ ] **Day 4:** DEN-01, DEN-02, DEN-06, DEN-07, DEN-08
- [ ] **Day 5:** DEN-09, DEN-12, DEN-15 (needs GEN-01 from Day 2)
- [ ] **Day 6:** Support UI: DEN-03, DEN-11, DEN-13 (after Jaztin); integration bug fixes
- [ ] **Day 7:** Full regression on Dentist dashboard + dental chart; final retest; sign-off

**Feature freeze at end of Day 5.** Days 6 and 7 are fixes and regression only.

<dependencies>
  <you_need_from_others>Richmon: tokens (Day 1). Joevan: STF-05 summary endpoint (Day 2). Jaztin: GEN-01 (Day 2), DEN-03/11/13 logic (Day 2-5).</you_need_from_others>
  <others_need_from_you>Everyone: shared dropdown + button components (Day 1). Dental chart fix (Day 2).</others_need_from_you>
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

**YZH-1 (Global form and button fixes): items GEN-06, GEN-07, GEN-12**
```text
Work ONLY on batch YZH-1 (Global form and button fixes): GEN-06, GEN-07, GEN-12.
Follow <claude_instructions> and the clarification protocol in this file.
Attached code: [attach the files from key_paths this batch touches]
Step 1: list your plan per ID and any blocking questions; wait for my go.
Step 2: implement one ID at a time.
Step 3: per ID report files changed, summary, how to test, acceptance pass/fail, not done.
```
**YZH-2 (Dental chart and patient record): items STF-03, STF-04, STF-05, DEN-04, DEN-05, DEN-10**
```text
Work ONLY on batch YZH-2 (Dental chart and patient record): STF-03, STF-04, STF-05, DEN-04, DEN-05, DEN-10.
Follow <claude_instructions> and the clarification protocol in this file.
Attached code: [attach the files from key_paths this batch touches]
Step 1: list your plan per ID and any blocking questions; wait for my go.
Step 2: implement one ID at a time.
Step 3: per ID report files changed, summary, how to test, acceptance pass/fail, not done.
```
**YZH-3 (Dentist dashboard screens): items DEN-01, DEN-02, DEN-06, DEN-07, DEN-08, DEN-09, DEN-12, DEN-15**
```text
Work ONLY on batch YZH-3 (Dentist dashboard screens): DEN-01, DEN-02, DEN-06, DEN-07, DEN-08, DEN-09, DEN-12, DEN-15.
Follow <claude_instructions> and the clarification protocol in this file.
Attached code: [attach the files from key_paths this batch touches]
Step 1: list your plan per ID and any blocking questions; wait for my go.
Step 2: implement one ID at a time.
Step 3: per ID report files changed, summary, how to test, acceptance pass/fail, not done.
```

For bug fixes, self-check before PR, and end-of-day status, use templates B, C, D in the master file (section 9).

---

# YOUR TASKS

<member_section name="Yzhekiel" track="uiux" primary_count="17">

<task_list>
**Batch YZH-1: Global form and button fixes**
- [ ] GEN-06 !!! Fix dropdowns bug [BLOCKED: no reproducible case, waiting for the reporter]
- [x] GEN-07 !!! If the choice is "other" add "specify"
- [x] GEN-12 !!! Fix the buttons (make the buttons readable and reasonable sizes)

**Batch YZH-2: Dental chart and patient record**
- [x] STF-03 Patient record: dental chart moving teeth anomaly
- [x] STF-04 Patient record: patient summary: ID selection (when the choice is "other valid ID" there should be a "please specify")
- [x] STF-05 Patient record suggestion: overall summary of the dental chart instead of clicking the tooth one by one
- [x] DEN-04 Dental chart: dental chart moving teeth anomaly
- [x] DEN-05 Dental chart: add top view
- [x] DEN-10 Patient Records: if the choice is "other" add "specify" and add example

**Batch YZH-3: Dentist dashboard screens**
- [x] DEN-01 Clinic Home: make the texts bigger
- [x] DEN-02 My schedule: fix the date layout
- [x] DEN-06 Prescription: remove the dosage from the medicine dropdown
- [x] DEN-07 Prescription: make the remove medicine color red
- [x] DEN-08 Prescription: fix the save button size from the license number on my prescription
- [x] DEN-09 Follow up care: add color to the status
- [x] DEN-12 My work hours: fix the UI (completed by Yzhekiel in B7)
- [x] DEN-15 Wording to approve: fix the button sizes, change the preview and make the UI consistent

**Support tasks**
- [ ] DEN-03 (support Jaztin): UI after the schedule bug is fixed
- [ ] STF-06 / DEN-11 (support Jaztin): handover UI after approval is removed
- [ ] DEN-13 (support Jaztin): leave UI changes
- [ ] STF-04 / GEN-07 (support Jaztin): server-side validation for required "specify"
</task_list>

<batch id="YZH-1" name="Global form and button fixes" priority="high">
  <goal>Dropdowns, "other/specify" fields, and buttons are reliable and consistent everywhere.</goal>
  <depends_on>GEN-08 preferred</depends_on>

  <revision id="GEN-06" status="blocked" blocked_reason="no reproducible case, waiting for the reporter" severity="high" owner="Yzhekiel">
    <tasks>
      - [ ] Reproduce and list all dropdown bugs (not opening, clipping, wrong value, not closing, z-index)
      - [ ] Fix in one shared dropdown component and apply to all dashboards
      - [ ] Verify selection, clearing, keyboard use, and scroll behavior
    </tasks>
    <acceptance>All dropdowns open, select, close, and clip correctly on every dashboard.</acceptance>
  </revision>

  <revision id="GEN-07" status="done" severity="high" owner="Yzhekiel" support="Jaztin">
    <note>2026-10-29 B1: Playwright MCP against the real local Laravel API and verified dental_clinic_scratch rendered Join (adult guardian plus minor dependent), signed-in Patient Family, and Staff CounterIntake. Other detail stayed controlled while typed; switching to a standard choice hid and cleared it; switching back started blank; whitespace-only detail disabled submission. Join POST sent Other/Niece and preserved guardian identity; Staff review showed the minor, guardian, and Other (Niece). Staff confirmed with Other ID/Company Health Card, and GET patient record returned that ID detail and unchanged guardian name. Family POST returned Other/Nephew; page reload showed the saved relationship. IntakeTest includes server-side blank rejection, standard-ID stale-detail clearing, minor/guardian rules, and role/branch restrictions. Added an API regression for the intake Other relationship after Staff confirmation. Clinical.jsx's older NewPatientModal is a browser-only path and is not rendered in the supported server session; Staff registration uses the server-backed form without a Sex Other choice. The active Join self Sex field has no Other option. No production defect was reproduced.</note>
    <tasks>
      - [x] Find every applicable intake dropdown that has an "Other" choice
      - [x] When "Other" is chosen, show a required "Specify" text field (with placeholder example)
      - [x] Validate server-side: if "Other", specify text is required; store both values
      - [x] Hide and clear the field when another option is selected
    </tasks>
    <acceptance>Every "Other" reveals a required "Specify" field; saving without it is blocked.</acceptance>
  </revision>

  <revision id="GEN-12" status="done" severity="high" owner="Yzhekiel">
    <tasks>
      - [x] Audit buttons for unreadable text, tiny or oversized sizes
      - [x] Define button sizes (sm/md/lg), minimum tap size, and readable font size
      - [x] Apply across all dashboards via shared button component
    </tasks>
    <acceptance>All buttons are readable, reasonably sized, and consistent.</acceptance>
  </revision>

  <batch_verification>
    - [ ] Spot-check forms on all three dashboards
    - [ ] Mobile and desktop widths
  </batch_verification>
</batch>

<batch id="YZH-2" name="Dental chart and patient record" priority="high">
  <goal>Dental chart is stable and richer; patient record forms handle "other" correctly.</goal>
  <depends_on>YZH-1</depends_on>

  <revision id="STF-03" status="done" severity="high" owner="Yzhekiel">
    <tasks>
      - [x] Reproduce the "moving teeth" anomaly (teeth shift/jump on hover, click, or render)
      - [x] Fix layout so teeth positions are fixed (no reflow on state/selection change)
      - [x] Fix in the shared dental chart component (also covers DEN-04)
    </tasks>
    <acceptance>Teeth never move when interacted with or when data loads.</acceptance>
  </revision>

  <revision id="STF-04" status="done" severity="medium" owner="Yzhekiel" support="Jaztin">
    <tasks>
      - [x] Patient summary ID selection: when "Other valid ID" is chosen, show "Please specify"
      - [x] Make it required; reuse GEN-07 pattern
    </tasks>
    <acceptance>"Other valid ID" shows a required "Please specify" field.</acceptance>
  </revision>

  <revision id="STF-05" status="done" severity="medium" owner="Yzhekiel" support="Joevan">
    <tasks>
      - [x] Add an overall dental chart summary view (all teeth with findings/treatments in one list)
      - [x] Group by condition/treatment; tapping an entry highlights the tooth
      - [x] (Joevan) Endpoint that returns chart data aggregated per patient
    </tasks>
    <acceptance>User can see the whole chart summary without clicking teeth one by one.</acceptance>
  </revision>

  <revision id="DEN-04" status="done" severity="high" owner="Yzhekiel">
    <tasks>
      - [x] Apply the STF-03 fix on the Dentist dental chart (same component)
    </tasks>
    <acceptance>No moving teeth in the dentist dental chart.</acceptance>
  </revision>

  <revision id="DEN-05" status="done" severity="medium" owner="Yzhekiel">
    <tasks>
      - [x] Add a top (occlusal) view toggle to the dental chart
      - [x] Tooth selection and findings stay in sync between views
    </tasks>
    <acceptance>Dentist can switch to top view and record findings there.</acceptance>
  </revision>

  <revision id="DEN-10" status="done" severity="medium" owner="Yzhekiel">
    <tasks>
      - [x] Patient Records: if the choice is "Other", show a "Specify" field
      - [x] Add an example placeholder text in the specify field
    </tasks>
    <acceptance>Every "Other" in Patient Records shows "Specify" with an example.</acceptance>
  </revision>

  <batch_verification>
    - [ ] Chart tested on staff and dentist views
    - [ ] Summary matches the per-tooth data
  </batch_verification>
</batch>

<batch id="YZH-3" name="Dentist dashboard screens" priority="medium">
  <goal>Dentist screens are readable and consistent.</goal>
  <depends_on>YZH-1</depends_on>

  <revision id="DEN-01" status="done" severity="medium" owner="Yzhekiel" implementer="Joevan">
    <tasks>
      - [x] Increase text sizes on Clinic Home (headings, stats, list text)
    </tasks>
    <acceptance>Clinic Home text is clearly larger and readable.</acceptance>
    <evidence>A6 / Joevan: Scoped Clinic Home heading, stats, schedule and task typography enlarged; navigation and counts preserved. Playwright 1440px/390px, light/dark OS preferences; existing app palette retained (no separate dark theme). See docs/DENTIST_UI_A6_ACCEPTANCE.md for synthetic-data boundaries and focused results.</evidence>
  </revision>

  <revision id="DEN-02" status="done" severity="medium" owner="Yzhekiel">
    <tasks>
      - [x] Fix the My schedule date layout (alignment, order, spacing, format)
    </tasks>
    <acceptance>Dates are clearly laid out and consistent.</acceptance>
  </revision>

  <revision id="DEN-06" status="done" severity="medium" owner="Yzhekiel" implementer="Joevan">
    <tasks>
      - [x] Remove the dosage text from the medicine dropdown options
    </tasks>
    <acceptance>Medicine dropdown shows only medicine names.</acceptance>
    <evidence>A6 / Joevan: Existing names-only local and synthetic server medicine options verified; separate empty dosage and custom draft save/reload/edit passed. No prescribing logic changed. Playwright 1440px/390px, light/dark OS preferences; existing app palette retained (no separate dark theme). See docs/DENTIST_UI_A6_ACCEPTANCE.md for synthetic-data boundaries and focused results.</evidence>
  </revision>

  <revision id="DEN-07" status="done" severity="low" owner="Yzhekiel" implementer="Joevan">
    <tasks>
      - [x] Make the "remove medicine" control red (default and hover states)
    </tasks>
    <acceptance>Remove medicine is clearly red.</acceptance>
    <evidence>A6 / Joevan: Existing danger variant verified red with readable normal/hover/keyboard-focus contrast; removal does not submit. No code change required. Playwright 1440px/390px, light/dark OS preferences; existing app palette retained (no separate dark theme). See docs/DENTIST_UI_A6_ACCEPTANCE.md for synthetic-data boundaries and focused results.</evidence>
  </revision>

  <revision id="DEN-08" status="done" severity="medium" owner="Yzhekiel" implementer="Joevan">
    <tasks>
      - [x] Fix the Save button size near the license number on My prescription
      - [x] Match the standard button size from GEN-12
    </tasks>
    <acceptance>Save button is correctly sized and aligned with the license number field.</acceptance>
    <evidence>A6 / Joevan: Scoped 44px license Save/input alignment, mobile wrapping, busy/disabled, success and failure feedback verified. Persistence unchanged. Playwright 1440px/390px, light/dark OS preferences; existing app palette retained (no separate dark theme). See docs/DENTIST_UI_A6_ACCEPTANCE.md for synthetic-data boundaries and focused results.</evidence>
  </revision>

  <revision id="DEN-09" status="done" severity="medium" owner="Yzhekiel" implementer="Joevan">
    <tasks>
      - [x] Add status colors in Follow up care (e.g. pending, done, overdue) with text labels
    </tasks>
    <acceptance>Each status has a distinct color plus label, readable in light and dark.</acceptance>
    <evidence>A6 / Joevan: Existing Open/Contacted/Booked/Closed and Overdue labelled colors verified as five distinct fills with text contrast at least 4.5:1. No status or booking change. Playwright 1440px/390px, light/dark OS preferences; existing app palette retained (no separate dark theme). See docs/DENTIST_UI_A6_ACCEPTANCE.md for synthetic-data boundaries and focused results.</evidence>
  </revision>

  <revision id="DEN-12" status="done" severity="medium" owner="Yzhekiel" implementer="Yzhekiel">
    <tasks>
      - [x] Fix the My work hours UI (layout, spacing, day rows, time inputs)
    </tasks>
    <acceptance>Work hours screen is clean and consistent with the design system.</acceptance>
    <evidence>B7 / Yzhekiel: Rendered the production WorkSchedulesPage with fictional Dentist, Owner and Staff data at 1440px and 390px. Rows display Monday–Sunday, per-branch scheduled hours and breaks, day off, branch closed, and estimated profile hours without horizontal overflow. Scoped styles separate branch names from times and align time controls; Owner Save, Cancel, day-off, keyboard activation, and backend error feedback were exercised. Dentist and Staff had no edit controls. The dated, branch-scoped server duty projection now displays On duty today, Off duty, or Duty status unavailable; missing/stale data is never treated as on duty. Focused tests 23/23 and production build passed. No production backend or booking rules changed. See docs/DEN12_B7_WORK_HOURS_ACCEPTANCE.md. FINALS-QA-REVISIONS.md already marked DEN-12 done before this batch; it was not edited.</evidence>
  </revision>

  <revision id="DEN-15" status="done" severity="medium" owner="Yzhekiel" implementer="Joevan">
    <tasks>
      - [x] Fix button sizes on Wording to approve
      - [x] Change the preview (clearer layout of the wording being approved)
      - [x] Make the UI consistent with the rest of the dentist dashboard
      - [x] Align with GEN-01 (fewer approval inputs)
    </tasks>
    <acceptance>Buttons are sized correctly, preview is improved, UI is consistent.</acceptance>
    <evidence>A6 / Joevan: Scoped read-only wording/preview and 44px controls; loading, empty, retry, approval-state visibility and manual revision-bound approval verified. Shared Automations untouched. Playwright 1440px/390px, light/dark OS preferences; existing app palette retained (no separate dark theme). See docs/DENTIST_UI_A6_ACCEPTANCE.md for synthetic-data boundaries and focused results.</evidence>
  </revision>

  <batch_verification>
    - [ ] Full dentist dashboard click-through
    - [ ] Text readable at all widths
  </batch_verification>
</batch>

</member_section>

## GEN-09 prescription-flow baseline (support evidence, 2026-10-29)

GEN-09 is owned by Richmon in `FINALS-QA-REVISIONS.md`; this note does not change its status. Source-derived path: a Dentist opens Prescriptions from role navigation, selects a recent visit, reviews the allergy notice, enters prescription lines, chooses Issue prescription, confirms the locking action, and the issued record opens automatically (`src/data.js`, `src/layout.jsx`, `src/App.jsx`, `src/pages/ServerPrescriptions.jsx`). Save draft is optional: the Issue path creates or updates the draft before issuing it. No runtime user actions were counted; the page loads server-backed visits and prescriptions, and no verified database-free runtime was available under this batch's restrictions.

Potential navigation repetition, not a measured saving: Treatment already resolves the exact visit ID (`src/pages/Clinical.jsx`), while ordinary navigation clears page context and the Prescriptions page receives none (`src/layout.jsx`, `src/App.jsx`). A later shortcut could carry that encounter context and preselect only a matching server-authorized visit; the Dentist must still review allergies, choose medicines and instructions, and confirm issue. The existing `tests/m19-prescriptions.test.js` checks source structure, not this interaction. The earlier source-level concern about Other selection is resolved by the rendered acceptance below.

## B1 rendered and API acceptance (2026-10-29)

- **GEN-09 custom-value acceptance: completed for the assigned prescription behavior.** In Playwright MCP, the signed-in Dentist opened Prescriptions, selected a server-listed recent visit, chose a predefined medicine, switched to Other, typed a fictional custom medicine, switched to another predefined medicine, and returned to Other. The field hid on the predefined choice and returned blank, then retained the newly typed custom value. Blank Other disabled Save draft. Custom dosage, frequency, and duration also stayed selected while edited. The POST contained only the five clinical line fields. A 201 response saved the draft; after page reload, Edit draft restored all four Other selections and their saved values. A PUT changed dosage only; the reopened dialog showed the edited dosage and unchanged medicine, frequency, duration, and instructions, and an authenticated GET returned 200. The prescription remained Draft; no issued record was altered. New PrescriptionTest coverage repeats create/GET/edit/GET with exact field assertions on the scratch database. Existing PrescriptionTest checks Dentist and branch authority, patient and Owner visibility, and issued-record locking. No production defect was reproduced.
- **QA scope distinction:** `FINALS-QA-REVISIONS.md` defines GEN-09 as Richmon's broader click-reduction task. This B1 evidence completes the custom-value acceptance requested by the coordinator; it does not establish fewer clicks for check-in, appointments, patient records, or prescriptions. The master tracker needs a separate owner-led click audit before its GEN-09 item can be marked done.
- **Verification:** `node --test tests/gen07-*.test.js tests/intake.test.js tests/m19-prescriptions.test.js` 24/24; focused scratch-guarded IntakeTest and PrescriptionTest 27/27, 674 assertions; full frontend suite 954/954 outside the sandbox; `npm run test:smoke` passed with existing React key warnings; `npm run build` passed with the existing chunk-size warning. The first sandboxed full frontend run failed in 10 subprocess-backed files; rerun outside the sandbox passed. Browser tests used the existing idempotent fictional seeders on `dental_clinic_scratch` only. `scripts/predefense-check.sh` was not run because it targets the separate demo environment rather than the authorized scratch database.

## A7 DEN-02 acceptance (2026-10-29)

Implementer: Joevan; original QA owner: Yzhekiel. Scoped rendered acceptance passed at 1440px and 390px. Full date heading, grouped controls, responsive timeline and assigned walk-in crash fix. See [A7 evidence](docs/DENTIST_WORKFLOW_A7_ACCEPTANCE.md).
