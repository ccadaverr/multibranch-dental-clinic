> **Current same-day owner checkpoint (2026-11-16):** Expected Operations HEAD is `54a727274901b9db2256fb8c6b1bef64eaa1c0d2`, bundle `joevan-qa-20261116-182348.bundle`, still undelivered on Windows. Independent SHA-256 has not been supplied. Owner accepts apparent-template classification subject to scan limitations, approves Jaztin as recipient and conditionally authorizes local isolated integration after authentic source, SHA-256/ancestry and safe database/migration verification. **No merge now.** GitHub delivery is preferred but deployment-trigger safety remains gated; private fallback delivery is not finalized. All earlier SHA/gate statements below retain historical context. Independent QA closure is not a prerequisite to constructing the authorized candidate after those conditions pass.

# Clinical integration handoff — 2026-11-16 Asia/Manila

Jaztin / Developer C. **Review-ready handoff, not merge/deployment authority.** Shared source baseline `a0725e645df6f8266c2bc4bebacc9d62dd18e7c1`; Batch06 starts at `e312f1aa4274ad97836da70b81547f113a822cdf` on `feature/jaztin-qa-20261115`, `/private/tmp/dentalops-jaztin-qa-20261115`. Draft PR #9 remains unmerged. Final commit/publication is recorded in the delivery message. Expected Operations input is **`1b521b886c54fa0c222c640551431f3b191fc7e0`**, `feature/joevan-qa-20261115`, user-verified clean on Joevan’s Windows repository. Its source and three clearance/recovery/readiness documents are not yet available on this Mac. This is unavailable delivery, not missing implementation; no fetch, merge, reconstruction or independent source/test acceptance was attempted. Batch07 continues from published Clinical `b5a9b8abc05883e15ee2277f156552f5e161961e`.

## Integration decision

**Clinical source/contracts ready for controlled review. No-go for actual merge or a shared acceptance target yet.** First obtain the approved exact Operations source through an approved private delivery channel, inspect its actual contracts, migrations and changed-file/test inventory, and agree a private schema-preservation profile. GitHub publication is not a prerequisite if a complete-history private bundle is approved; its hosting-trigger gate remains separate. Then request/use explicit merge authorization and run a consolidated milestone at the actual resulting HEAD. No production/hosted readiness claim. The [68-row reconciliation](QA_RECONCILIATION_20261116.md) is authoritative for this phase; unresolved policy is not completed by integration.

## Operations delivery and review checklist (prepared, not executed)

1. Joevan explicitly confirms Codex B has finished and will perform no further writes before Codex A takes sole Git ownership. Clean Git status does not establish agent inactivity or transfer permission.
2. Owner classifies the historical PostgreSQL URL and approves the exact new complete-history bundle **including `1b521b886c54fa0c222c640551431f3b191fc7e0`** and the exact private delivery method. The reported password/database template markers are not evidence of a proven live secret. Do not send a bundle until both classification/transfer gates are satisfied. This Mac has neither the bundle nor its verified checksum; none is fabricated here.
3. On separately authorized receipt: verify checksum, bundle heads/prerequisites and complete history in an isolated review repository; verify baseline ancestry and exact expected full HEAD without overwriting either developer’s worktree. Read `SECURITY_MAIL_CAPTURE_CLEARANCE_20261116.md`, `OPERATIONS_STORAGE_RECOVERY_20261116.md` and `OPERATIONS_RELEASE_READINESS_20261116.md` from that source. Preserve accepted runtime, security, Mailpit and storage-recovery evidence; do not rerun or reopen accepted Operations work without a demonstrated discrepancy.
4. Inspect baseline-to-Operations changed files and actual contracts before selecting merge strategy. Compare route ordering, role/resource authorization, API-client exports, User/Patient/branch IDs, shared clinical navigation, document/storage recovery, mail capture, notification ownership, configuration and migration filename/dependency/constraint overlap. Keep all four held migrations protected. No competing workforce scheduling authority or implicit clinical availability cutover.
5. Reconcile genuinely actionable Joevan-owned remaining criteria from the authoritative 68-row document against his inspected implementation/tests. A Partial label or provisional source does not prove missing code. Preserve both developers’ functionality in shared files; do not choose one whole file during conflict resolution.
6. Keep GitHub publication blocked for Operations until authoritative **Vercel, Render, Railway and GitHub trigger evidence** is reviewed. Previous authorization for the Clinical feature branch does not clear Operations hosting or private transfer gates.
7. Request/use **separate explicit integration authorization** before any merge/cherry-pick/shared-baseline change. Only then build an isolated combined target and run the later consolidated acceptance milestone at its real HEAD. PR #9 remains draft/unmerged; no deploy.

## Batch07 contract additions and overlap

* Family `GET /me/dependents` advertises safe creation capability; `POST /me/dependents` requires the existing command-key convention. New read-only `GET /me/dependents/creation-receipt` precedes dynamic resource binding. See [Dependent creation v1](contracts/DEPENDENT_CREATION_API_V1.md). Person/Patient/link/audit/receipt are atomic; current guardian authority applies to replay. Existing preferred branch inheritance, ten-dependent limit and invitation/claim semantics remain unchanged. No Visit/admission is created.
* Message history/search/newer reads include exact conversation/Patient/branch proof. The shared client checks that proof and existing request lifetimes before adoption. See [Message read context v1](contracts/MESSAGE_READ_CONTEXT_API_V1.md). No sending, active-Dentist switch, notification or operational archive mutation changes.
* Shared overlaps: one Family receipt route, API-client exports, Family props in Patient Portal, narrow ConversationController read response metadata/cache headers, ServerMessages read arguments, local runner contention lane and test fixtures. Deliver compatible read metadata/backend with frontend. No new middleware, App.jsx/layout.jsx, workforce code or schema changes.

## Clinical route inventory

All paths are under `/api`, existing authenticated account/role middleware and resource policies; public intake is explicitly rate-limited. All public record IDs below are exact resource ULIDs unless a legacy_ref is named. Existing non-clinical ownership is unchanged.

| Resource | Actual endpoints / behavior | Authorization / contract |
|---|---|---|
| Booking | GET `/appointments`, `/appointments/{appointment}`, `/appointments/availability`, `/appointments/booking-options`, `/appointments/branch-options`, `/appointments/dentist-options`, `/appointments/calendar`, `/appointments/recommendation`; POST `/appointments` | Patient own/guardian, branch-scoped Staff, established Owner exception; Dentist assigned read. Existing scheduling service remains authoritative. Exact Patient/branch/service/Dentist/slot; original revisions/command keys on named commands. |
| Appointment actions | POST `/appointments/{appointment}/reschedule`, `/cancel`, `/confirm`, `/no-show`; GET `/{appointment}/receipt-pdf`; POST `/{appointment}/on-my-way`; GET `/slot-offers/mine`, POST `/slot-offers/{slotOffer}/accept` | Existing supported rules only. Do not infer approval of the broader STF-11 cancellation-reason or automatic admission policy from old endpoints. No live provider/refund flow is exercised. |
| Follow-ups | GET `/followups`, `/{followupTask}`, `/patients/{patient}/followups`, `/followups/booking-capability`, `/followups/{followupTask}/booking-receipt`; POST `/followups`; PATCH `/followups/{followupTask}`; linked booking via POST `/appointments` | [Follow-up booking v1](contracts/FOLLOWUP_BOOKING_API_V1.md). Exact task/Patient/branch/requesting Dentist and `followup_expected_revision`; task read/contact/close use observed revisions. Booking does not close clinical follow-up. Original receipt belongs to the original booking account. |
| Profile and ID | GET `/patients`, `/{patient}`, `/{patient}/records`; POST `/patients`; PATCH `/patients/{patient}`; POST `/patients/{patient}/verify-id` | Staff-owned permitted non-clinical fields, exact Patient/full-profile tier and original `expected_revision`; [profile v1](contracts/PATIENT_PROFILE_SAVE_API_V1.md). Existing Patient/Dentist/Owner projections and field restrictions remain. Patient-bound ID audit/timestamp are atomic; no full ID image/number retention added. |
| Intake | GET `/public/intake/{branchRef}` and POST `/public/intake`; POST `/intake/join`; GET `/intake/code`, `/intake/submissions`; POST `/intake/code/refresh`, `/intake/submissions/{intakeSubmission}/confirm`, `/cancel` | Existing explicit supported intake/ID/branch checks. Counter registration is not new automatic admission policy. No real Patient communication or HMO operation. |
| Arrival / Visit | POST `/visits/check-in`, `/visits/walk-in`; GET `/visits`, `/{visit}`, `/{visit}/arrival-receipt` | [Arrival v1](contracts/ARRIVAL_RECOVERY_API_V1.md). Staff branch authority and established explicit Owner exception; no Patient raw Visit API. Receipt is original committed result and requires original account plus current authorization. Walk-in source has null appointment. |
| Queue / encounter | GET `/queue`, `/queue/mine`, `/queue/{queueEntry}`; POST `/queue/{queueEntry}/priority`, `/late-order`, `/{command}` (per existing whitelist); POST/GET `/visits/{visit}/treatment` | [Encounter recovery v1](contracts/ENCOUNTER_RECOVERY_API_V1.md). Queue commands retain their role-specific policies. Treatment start uses exact Visit/queue IDs and original revision pair. **Served = treatment START**, never completion. Do not apply held vocabulary transformations. |
| Treatment | GET `/treatments`, `/{treatment}`, `/treatments/mine`; POST `/{treatment}/document`, `/complete` | [History read v1](contracts/CLINICAL_HISTORY_READ_API_V1.md). `patient_id` without date window reads only authorized Completed history, paginated; no new permission. Author-only document/complete, original revisions and keyed commands. Patient own completed safe subset. Author-only historical snapshots; continuity access expires under existing policy. |
| Chart | GET/POST `/patients/{patient}/chart`; GET `/me/chart` | [Chart v2](contracts/CHART_RECORDING_API_V2.md) **mandatory** key + original tooth revision; linked Treatment revision required. No legacy unkeyed write exception. Dentist authorized write/full history; Staff redacted read-only; Patient own/authorized dependent simplified current projection; Owner no chart content. |
| Prescriptions | GET `/prescriptions`, `/prescriptions/visits`, `/{prescription}`, `/{prescription}/pdf`, `/me/prescriptions`; POST `/prescriptions`, `/{prescription}/issue`, `/void`; PUT `/{prescription}`; PUT `/me/prescription-license` | Accepted persisted Draft→Issued→Void, revision checked, distinct correction identity, author/current clinical authority and Patient permitted issued/void read. No lifecycle rewrite in these batches. Source policy decides each role; Owner does not acquire clinical content through a summary/archive. |
| Billing / receipt | GET `/billing/treatments`, `/invoices`, `/{invoice}`, `/invoices/mine`, `/receipts/mine`; POST `/invoices/from-treatment/{treatment}`, `/{invoice}/review`, `/discount`, `/issue`, `/payment`; GET `/{invoice}/pdf`, `/receipt-pdf`; existing explicit `/resend-receipt` | Accepted completed-treatment billing and synthetic Cash settlement. [Patient receipt read v1](contracts/PATIENT_RECEIPT_NAVIGATION_API_V1.md): exact invoice/Patient/receipt PDF headers, appointment filter and null-appointment walk-ins. Reads never settle. Existing online payment routes remain unexercised; no real processor or email action is authorized by this handoff. |

Full exact role middleware/queue whitelist remains in `backend/routes/api.php`; this inventory does not grant additional roles. Existing consent/document/guardian/HMO read rules are unchanged, and they must remain entity-specific during archive integration.

## Revisions, command receipts and history

* Existing appointment and shared command journals enforce unique `(user_id,idempotency_key)`. Preserve original payload/identity/revision after uncertainty. Matching replay returns the original snapshot; an absent receipt is not proof of failure. Exact GET current read is distinct from a historical receipt.
* Follow-up selected-task association persists in `followup_tasks.appointment_id`, exact requesting Dentist is retained; Patient+branch similarity alone never links. Safe transaction/slot claims and task CAS are atomic. `SELECTED_FOLLOWUP_BOOKING_ENABLED=false` remains default; capability is a readiness gate, not authorization. Enable on another target only after its real evidence.
* Arrival uses existing one-Visit/appointment, one-active-Visit/Patient and one queue/Visit constraints. Scheduled expected appointment revision and explicit ID acknowledgement are preserved. New-session receipt recovery is account/resource scoped.
* Encounter start journals exact Visit/queue and revision pair. Already-created recovery does not create another Treatment. Save uses the original returned Treatment revision; no refresh-to-latest substitution. Completed Treatment/lines and history remain protected.
* Profile keyed writes are additive; older unkeyed profile writes still require CAS. Real changes increment once and audit field names only; no-op is explicit `meta.unchanged`. This is distinct from chart v2, which now mandates both key and revision for every write.
* Chart tooth revision is immutable entry count for the exact Patient/FDI tooth; absent means zero. Advisory lock serializes CAS, linked Visit→Treatment lock order precedes it. Append/audit/journal/receipt are atomic. Whole-tooth/surface precedence and existing statuses/numbering remain. No note/status in general audit. Historical chart observations are never overwritten. Current chart across visits is not an invented as-of-encounter reconstruction.
* Cash settlement retains exact amount/balance/revision, one persisted payment and receipt. Paid UI requires persisted proof, not redirects/status strings alone. PDF reads confirm existing identities and never create a payment. Issued/void prescription identity/history is retained.

## Database / migration inventory

**No migration or compatibility-schema change anywhere on Jaztin's feature branch since the shared baseline.** New behavior uses existing constraints/journals and additive read fields. Verified private PostgreSQL target uses 83 reviewed migrations; four held sources are unchanged/unexecuted:

1. `2026_11_10_000100_remove_patient_feedback_table.php`
2. `2026_11_15_000400_backfill_tooth_chart_branch.php`
3. `2026_11_15_000500_add_critical_foreign_key_and_analytics_indexes.php`
4. `2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php`

Relevant existing invariants: appointment Patient/Dentist time-overlap GiST exclusions for active states; unique account/key journals; Visit source↔appointment consistency, one Visit per appointment and one active Visit per Patient; queue unique Visit and `(dentist_queue_id,queue_number)`; Treatment unique Visit/one active Dentist and immutable completed record/procedure guards; append-only appointment/Visit/queue/Treatment histories; follow-up status/linked appointment checks; chart append-only history; unique Invoice/Treatment, Payment/Invoice, Receipt/Payment and receipt number; append-only payment/receipt/invoice histories; prescription issued identity/status/void checks and protected lines. Do not disable triggers or mark held migrations executed to reconcile schema.

Before any future integration database operation, inspect Joevan's actual migration filenames/dependencies, preserve history and use a disposable private clone/backup. Do not run the blanket legacy scratch suites against this profile: some use `migrate:fresh` or held migrations. The owned runner refuses unsafe paths. Updated legacy chart race assertions are not a claim that its reset harness was executed; the owned safe three-scenario PostgreSQL runner is the actual contention evidence.

## Shared code and likely conflicts

Since baseline, narrow additions touch `backend/routes/api.php` (follow-up capability/receipt, arrival receipt, encounter GET), `backend/config/clinic.php` and `.env.example` (default-off selected-follow-up flag), `backend/config/cors.php` (retain audit-export headers while exposing PDF identity/filename), `src/api-client.js`, Patient `src/patient/Portal.jsx`, and local development runner/tests. **No App.jsx, layout.jsx, shared auth middleware or workforce schema changes on this feature branch.** Resource controllers/services listed below contain fresh account/auth-version/Patient/branch checks around mutation/replay; do not replace them with frontend-only checks.

Potential overlap: appointment availability callers consume the established scheduling service; Joevan owns any new duty projection and clinical availability must not switch authorities implicitly. Preserve both sets of API-client exports, route ordering (static before resource binding), existing role gates, CORS audit headers, appointment lock order and notification intents. PatientFlow/Clinical/Staff-role navigation may overlap his UI work; reconcile by resource behavior rather than choosing one developer's whole file. Documentation pointers/local-runner lanes may also conflict. No notification lifecycle, archive policy or Owner operations implementation is rewritten here.

## Known failures / remaining gates

* Three existing receipt-resend 200 assertions return mail transport 502 in the owned profile; reproduced with starting Batch05 document controller. Not silently passed or fixed by PDF/navigation work.
* Six queued-mail Intake assertions previously reproduced against baseline code remain unresolved; historical OWN-11 failure is not cleared until Joevan source/tests are inspected. Current clinical changes have focused tests, not a new global suite result.
* Six historical predefense prerequisites are separate: worker down, scheduler down, synthetic Patient-count rehearsal gap, missing unpaid fixture, synthetic contact/hours, aged unsent outbox. No new predefense/hosted pass is claimed; fixture counts may have changed. Do not fabricate clinic facts or start real delivery to make checks green.
* Existing React list-key, large-bundle and runner lock-handle warnings are known. See Batch06 for actual new failures/fixes and final checks.
* Remaining policy/source blockers and all 68 exact next actions are in the reconciliation. Full GEN-09 benchmark and missing GEN-06/DEN-03 reproductions remain open. Other-target AUD-10 stays disabled. No new clinical sign-off/correction, automatic admission/cancel/handover or roster policy is invented.

## Changed-file inventory since collaboration baseline

The following inventory is generated from Git plus the current Batch08 working changes, not from Joevan's unpublished branch. It includes test/document/runtime safeguards; no secrets/dumps/runtime screenshots are included. Final delivery records actual committed HEAD and push state.

* `backend/.env.example`
* `backend/app/Http/Controllers/BillingController.php`
* `backend/app/Http/Controllers/BillingDocumentController.php`
* `backend/app/Http/Controllers/ConversationController.php`
* `backend/app/Http/Controllers/DentalChartController.php`
* `backend/app/Http/Controllers/FollowupController.php`
* `backend/app/Http/Controllers/GuardianController.php`
* `backend/app/Http/Controllers/IntakeController.php`
* `backend/app/Http/Controllers/PatientRecordController.php`
* `backend/app/Http/Controllers/TreatmentController.php`
* `backend/app/Http/Controllers/VisitController.php`
* `backend/app/Http/Requests/Treatment/StartTreatmentRequest.php`
* `backend/app/Http/Requests/Visit/CheckInVisitRequest.php`
* `backend/app/Http/Resources/InvoiceResource.php`
* `backend/app/Http/Resources/TreatmentResource.php`
* `backend/app/Services/Appointments/AppointmentService.php`
* `backend/app/Services/Followups/Followups.php`
* `backend/app/Services/Intake/IntakeService.php`
* `backend/app/Services/Treatments/TreatmentService.php`
* `backend/app/Services/Visits/VisitService.php`
* `backend/config/clinic.php`
* `backend/config/cors.php`
* `backend/routes/api.php`
* `backend/tests/Feature/Billing/PatientReceiptNavigationTest.php`
* `backend/tests/Feature/Charts/ChartBe01AuditAtomicityTest.php`
* `backend/tests/Feature/Charts/ChartBe02ConcurrentRecordingTest.php`
* `backend/tests/Feature/Charts/ChartCommandContentionTest.php`
* `backend/tests/Feature/Charts/ChartCommandRecoveryTest.php`
* `backend/tests/Feature/Charts/DentalChartTest.php`
* `backend/tests/Feature/Followups/SelectedFollowupBookingTest.php`
* `backend/tests/Feature/Followups/SelectedFollowupConcurrencyTest.php`
* `backend/tests/Feature/Followups/SelectedFollowupRecoveryTest.php`
* `backend/tests/Feature/Intake/DependentCreationContentionTest.php`
* `backend/tests/Feature/Intake/DependentCreationRecoveryTest.php`
* `backend/tests/Feature/Intake/IdVerificationAtomicityTest.php`
* `backend/tests/Feature/Intake/IntakeTest.php`
* `backend/tests/Feature/Messaging/MessageSearchTest.php`
* `backend/tests/Feature/Patients/ProfileSaveContentionTest.php`
* `backend/tests/Feature/Patients/ProfileSaveRecoveryTest.php`
* `backend/tests/Feature/Treatments/EncounterContentionTest.php`
* `backend/tests/Feature/Treatments/EncounterRecoveryTest.php`
* `backend/tests/Feature/Treatments/HistoricalTreatmentReadTest.php`
* `backend/tests/Feature/Visits/ArrivalContentionTest.php`
* `backend/tests/Feature/Visits/ArrivalRecoveryTest.php`
* `backend/tests/Support/arrival_worker.php`
* `backend/tests/Support/chart_worker.php`
* `backend/tests/Support/dependent_worker.php`
* `backend/tests/Support/encounter_worker.php`
* `backend/tests/Support/local_message_search_fixture.php`
* `backend/tests/Support/local_receipt_fixture.php`
* `backend/tests/Support/local_visit_fixture.php`
* `backend/tests/Support/profile_worker.php`
* `docs/CLINICAL_INTEGRATION_HANDOFF_20261116.md`
* `docs/JAZTIN_CLINICAL_BATCH02_20261115.md`
* `docs/JAZTIN_CLINICAL_BATCH03_20261115.md`
* `docs/JAZTIN_CLINICAL_BATCH04_20261115.md`
* `docs/JAZTIN_CLINICAL_BATCH05_20261116.md`
* `docs/JAZTIN_CLINICAL_BATCH06_20261116.md`
* `docs/JAZTIN_CLINICAL_BATCH07_20261116.md`
* `docs/JAZTIN_CLINICAL_SPRINT_20261115.md`
* `docs/QA_RECONCILIATION_20261116.md`
* `docs/contracts/ARRIVAL_RECOVERY_API_V1.md`
* `docs/contracts/CHART_RECORDING_API_V1.md`
* `docs/contracts/CHART_RECORDING_API_V2.md`
* `docs/contracts/CLINICAL_HISTORY_READ_API_V1.md`
* `docs/contracts/DEPENDENT_CREATION_API_V1.md`
* `docs/contracts/ENCOUNTER_RECOVERY_API_V1.md`
* `docs/contracts/FOLLOWUP_BOOKING_API_V1.md`
* `docs/contracts/MESSAGE_READ_CONTEXT_API_V1.md`
* `docs/contracts/PATIENT_PROFILE_SAVE_API_V1.md`
* `docs/contracts/PATIENT_RECEIPT_NAVIGATION_API_V1.md`
* `docs/defense/FEATURE_ACCEPTANCE_MATRIX.md`
* `scripts/local-system.py`
* `scripts/tests/test_local_system.py`
* `src/api-client.js`
* `src/appointment-flow.js`
* `src/appointments-api.js`
* `src/arrival-command.js`
* `src/chart-command.js`
* `src/clinical-history.js`
* `src/components/odontogram/ToothTimeline.jsx`
* `src/encounter-readback.js`
* `src/encounter.js`
* `src/message-read.js`
* `src/messaging-api.js`
* `src/pages/ArrivalRecovery.jsx`
* `src/pages/Clinical.jsx`
* `src/pages/ClinicalHistory.jsx`
* `src/pages/CounterIntake.jsx`
* `src/pages/DentalChart.jsx`
* `src/pages/DentistQueue.jsx`
* `src/pages/EncounterCare.jsx`
* `src/pages/EncounterWorkspace.jsx`
* `src/pages/PatientFlow.jsx`
* `src/pages/Scheduling.jsx`
* `src/pages/ServerFollowups.jsx`
* `src/pages/ServerMessages.jsx`
* `src/patient-profile-save.js`
* `src/patient-records-api.js`
* `src/patient/Portal.jsx`
* `src/patient/archive-readback.js`
* `src/patient/booking-flow.js`
* `src/patient/dependent-command.js`
* `src/patient/invoice-readback.js`
* `src/patient/pages/Archives.jsx`
* `src/patient/pages/Billing.jsx`
* `src/patient/pages/Book.jsx`
* `src/patient/pages/Family.jsx`
* `src/patient/pages/Teeth.jsx`
* `src/patient/pages/Visits.jsx`
* `src/queue-api.js`
* `src/treatments-api.js`
* `src/visits-api.js`
* `tests/archive-readback.test.js`
* `tests/arrival-command.test.js`
* `tests/aud10-clinical-ui.browser.mjs`
* `tests/aud10-durable-recovery.test.js`
* `tests/billing-pdf-identity.test.js`
* `tests/chart-command.test.js`
* `tests/clinical-history.test.js`
* `tests/den-ui-02.browser.mjs`
* `tests/dependent-command.test.js`
* `tests/encounter-recovery.test.js`
* `tests/fixtures/aud10-clinical-ui.html`
* `tests/fixtures/den-ui-02.jsx`
* `tests/id-verification-receipt.test.js`
* `tests/local-arrival.browser.mjs`
* `tests/local-chart-readback.browser.mjs`
* `tests/local-chart.browser.mjs`
* `tests/local-clinical-history.browser.mjs`
* `tests/local-encounter.browser.mjs`
* `tests/local-family-acceptance.mjs`
* `tests/local-followup.browser.mjs`
* `tests/local-message-search-acceptance.mjs`
* `tests/local-patient-booking.browser.mjs`
* `tests/local-patient-profile.browser.mjs`
* `tests/local-receipt-navigation.browser.mjs`
* `tests/m17-message-search.test.js`
* `tests/m17-messaging.test.js`
* `tests/m17-realtime-messaging.test.js`
* `tests/m23-archives.test.js`
* `tests/message-read-context.test.js`
* `tests/patient-booking-recovery.test.js`
* `tests/patient-invoice-readback.test.js`
* `tests/patient-portal.test.js`
* `tests/patient-profile-save.test.js`
* `tests/patient-records-api.test.js`
* `tests/support/den-ui-02-fixture.js`
* `tests/support/mock-server-world.js`
* `tests/yzh-clin-12-followup-lifecycle.test.js`

## Batch08 delivery supplement — exact prescription review

Starting actual Batch07 HEAD `801309084d59823368903708e87337c83f3c02b8` was verified clean; PR #9 independently verified draft/open/unmerged at that SHA. [Batch08 report](JAZTIN_CLINICAL_BATCH08_20261116.md) contains the new bounded GEN-09 subset, every remaining GEN-07/DEN-14 task, all 11 blocker decisions and actual test limits. [Integrated acceptance runbook](INTEGRATED_ACCEPTANCE_RUNBOOK_20261116.md) is prepared, not an executed integrated result.

Additive prescription contract: [exact encounter read v1](contracts/ENCOUNTER_PRESCRIPTION_READ_API_V1.md). Existing index accepts optional `visit_id` combined with Patient/status and role/branch filtering; non-Owner projections add stable `branch_id`; list/detail are private/no-store. Shared completed/historical encounter Review opens exact saved prescription in a view-only existing dialog. No schema, writes, permissions, notifications or held migration changed. Preserve this during PrescriptionController/ServerPrescriptions/EncounterCare/ClinicalHistory conflict resolution.

Additional inventory: `backend/app/Http/Controllers/PrescriptionController.php`, `backend/tests/Feature/Prescriptions/PrescriptionTest.php`, `src/pages/ServerPrescriptions.jsx`, `src/pages/EncounterCare.jsx`, `src/pages/ClinicalHistory.jsx`, `src/pages/EncounterPrescriptions.jsx`, `src/prescription-readback.js`, `tests/prescription-readback.test.js`, `tests/yzh-clin-13-prescription-void.test.js`, `tests/local-encounter-prescriptions.browser.mjs`, `scripts/validate-qa-reconciliation.py`, the new API contract/Batch08/runbook, plus reconciliation and system-state updates. No hosting configuration change.

Current evidence: PostgreSQL two-file suite 11/210 passed; final no-store exact-Visit case 1/43 passed (overlap); focused frontend checks pass; five actual browser groups/six widths pass; smoke/build pass. Full frontend 1951 tests: 1939 pass, **four starting-HEAD-reproduced failures**, eight skipped. New full run identifies inherited queue-policy text, missing-context positive message fixture, OWN-11 schedule and chart-recovery wording assertions; do not silently clear them. Full reset-based backend not run on the held-migration profile; prior receipt-email/Intake failures stay unresolved. Owned local predefense: **5 FAIL/6 WARN**, actual current prerequisites in Batch08; no external delivery/hosted pass.

Authoritative counts stay **21 Complete / 36 Partial / 11 Blocked = 68**, all integration pending. Original source wording/tasks/owners and ten-column matrix are checked by `python3 scripts/validate-qa-reconciliation.py`. Operations transfer approval, exact bundle/hash, intended recipient/private channel and explicit integration authorization are still absent. Ready for Clinical contract review only; no candidate integration or deployment.

Batch08 implementation commit: **`b82da11813401c85fb938e9f17e06bef625c32a7`**. Final schema check 1/9, two changed PHP syntax checks, exact-source ledger validation, diff and 17-file credential scan passed. All source delivery/integration gates above remain unchanged.

## Same-day coordination and bounded correction

Communication approved by owner: provide the exact 21 Operations-primary/shared unfinished rows in this ChatGPT response for owner-mediated delivery to Joevan’s Codex A on Windows. No automated messaging and no assumption of access to Windows files. Extract contains 19 Partial/2 Blocked with original criteria/tasks, attribution, missing requirements, source/test evidence and integration dependencies. Prepared artifacts remain private at `/private/tmp/dentalops-integration-intake-20261116`; no delivery acknowledgement is claimed.

Only independent source-waiting correction: `tests/qa-batch08-workflows.test.js` positive/malformed message fixtures now honor the accepted exact-context read contract, with unchanged success/refusal expectations, actual query-encoding checks and additional denial for empty foreign/missing-context results. Focused checks 39 passed. No shared runtime/routes/API/clinical or migration changes. Current full-suite/environment results are in `docs/JAZTIN_SOURCE_WAITING_CHECKPOINT_20261116.md`.
