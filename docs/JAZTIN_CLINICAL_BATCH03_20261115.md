# Clinical / Patient batch 03 — 2026-11-15, Asia/Manila

Branch `feature/jaztin-qa-20261115`; worktree `/private/tmp/dentalops-jaztin-qa-20261115`. Starting HEAD `02baad5a524ef2a8cca469a6d903fa85642e8286`, verified clean and preserved. Original baseline `a0725e645df6f8266c2bc4bebacc9d62dd18e7c1`. Publication remains the existing draft PR #9; no merge, integration or deployment.

Encounter implementation commit: `49b3a0b` — `feat(encounters): recover exact queue-linked treatment starts safely`. Patient booking and this evidence/contract are the companion commit; final Git report records its SHA.

## Completed functional slices (local acceptance)

1. **Queue → exact encounter → safe start/recovery.** Existing lifecycle retained. New UI submits original Visit and queue revisions/identity. Backend validates current authority before replay and under lock, then uses the existing atomic start, audit/history/journal and uniqueness constraints. Authorized GET by exact Visit recovers the existing encounter, including a walk-in with no appointment. Duplicate starts reject/replay. Served means started, not completed.
2. **No documentation revision substitution.** Previously, start refreshed and automatically saved the pre-start draft against whichever treatment revision appeared in that list. It now validates the exact transaction response and uses its original revision for the first documentation command. Another tab's revision produces conflict instead of overwriting it. A list-refresh failure reports partial verified start and preserves the original retry; obsolete auth/selection stops automatic documentation/adoption. A newer record always offers explicit review, even with no dirty draft.
3. **Patient booking recovery/status.** Existing booking retained. Server errors, timeouts and mismatched/malformed receipts keep intent/key protected; a later refusal cannot prove an earlier uncertain write failed. Exact Patient/dependent, branch/service/provider/time proof is required. Auth-generation, unmount and CSRF-dispatch ownership checks suppress stale work. Exact-ID current read prevents original Confirmed receipts masking later cancellations/reschedules. Failed readback preserves the booking reference with current status unverified. Success shows the authoritative code and focuses that appointment in My visits.
4. **GEN-09 functional shortcut.** Dentist Waiting → Called → encounter review formerly required Call patient + Open encounter (2 interactions). “Call and open encounter” does both in **1 keyboard/click action**, after verified receipt/refresh. It creates no treatment. Full Waiting → treatment start is 3 → 2 explicit actions. Remaining GEN-09 benchmark coverage is unverified; no full closure claimed.

## Original requirements and scope

`FINALS-QA-REVISIONS.md` GEN-09 tasks require common-flow mapping, counted reduction and recorded before/after. This batch supplies the queue path above and exact-context Patient navigation; it does not invent timing savings or a numeric benchmark absent from the source. The user-directed queue/encounter and Patient-recovery acceptance cases are functional source-supported work, not extra original QA IDs.

STF-10/12 single refresh/keyboard picker and prior STF-04/GEN-07 ID work remain unchanged. Broader STF-11/13 auto-admission/cancellation policy remains gated. No DEN-06/07/08 prescription rebuild or speculative DEN-03/GEN-06 requirement. AUD-10 remains accepted only on its prior private target; checked-in activation defaults are untouched. Joevan's workforce, notifications and operational domains are unchanged.

## Persistence / contracts

[Encounter recovery API v1](contracts/ENCOUNTER_RECOVERY_API_V1.md): new Dentist-only GET `/api/visits/{visit}/treatment`; additive queue pair on existing treatment POST; additive queue revision in TreatmentResource. No migration/schema change, held-guard change, new encounter lifecycle, payment/HMO operation or historical status rewrite.

Patient booking uses existing routes and journal/authorization, not a competing booking endpoint. Clinical identities resolve from the exact Visit; walk-ins retain null appointment. Current encounter readback is distinct from original idempotent start receipts. Patient current appointment reads are distinct from original booking receipts. No browser-persisted clinical draft or command credential.

## Modified file manifest / integration overlap

Backend: `backend/app/Http/Requests/Treatment/StartTreatmentRequest.php`; `backend/app/Http/Controllers/TreatmentController.php`; `backend/app/Http/Resources/TreatmentResource.php`; `backend/app/Services/Treatments/TreatmentService.php`; one domain GET in `backend/routes/api.php`.

Clinical client/UI: `src/encounter-readback.js`, `src/encounter.js`, `src/treatments-api.js`, `src/queue-api.js`, `src/appointment-flow.js`, `src/pages/DentistQueue.jsx`, `src/pages/EncounterWorkspace.jsx`. Patient: `src/appointments-api.js`, `src/patient/booking-flow.js`, `src/patient/pages/Book.jsx`, one BookPage prop/key change in `src/patient/Portal.jsx`. Shared raw-client additions: `src/api-client.js`. No App/layout/store or scheduling authority edit.

Tests/tooling: `backend/tests/Feature/Treatments/EncounterRecoveryTest.php`, `EncounterContentionTest.php`, `backend/tests/Support/encounter_worker.php`; guarded lane/refusal test in `scripts/local-system.py` and `scripts/tests/test_local_system.py`; `tests/encounter-recovery.test.js`, `tests/patient-booking-recovery.test.js`, actual local browser drivers `tests/local-encounter.browser.mjs` and `tests/local-patient-booking.browser.mjs`. Existing contract fixtures updated in `tests/support/mock-server-world.js`, `tests/support/den-ui-02-fixture.js`, `tests/fixtures/den-ui-02.jsx`, `tests/den-ui-02.browser.mjs`: queue revisions/real public IDs/exact GET and method-specific mutation counting, without weakening invariants. This report and the v1 contract are added.

Potential overlap for eventual review: routes, API client, appointment flow, shared clinical resource and Patient portal. Preserve Joevan's independent duty contract; no integration attempted.

## Verification evidence

Private manifest `/private/tmp/jaztin-clinical-20261115c/target.json`: verified owned loopback PostgreSQL port 55493, only demo/test databases, 83 reviewed migrations/four exclusions. Real contention used fresh independent clone `/private/tmp/contention-a2926d71/target.json` (port 58312), no reset/migration/deletion. Clone was backed up and stopped; credentials/data/screenshots remain private and uncommitted.

* `python3 scripts/local-system.py --target <owned target> --profile test test tests/Feature/Treatments/EncounterRecoveryTest.php tests/Feature/Treatments/TreatmentTest.php`: **32 passed, 649 assertions**. Exact scheduled/walk-in identity, stale/wrong queue pair, no-record read, new-auth readback, same-key replay, role/foreign-Dentist denial, reassignment/revocation, audit rollback and established lifecycle.
* Filter `duplicate_create|reusing_a_key|keys_are_per_account|patient` across existing `AppointmentLifecycleTest.php` and `AppointmentAuthorizationTest.php`: **10 PostgreSQL tests, 56 assertions passed**.
* Guarded `encounter-concurrency` lane: **1 test, four real two-session PostgreSQL contention scenarios, 1,404 assertions passed**. Same Visit/different keys; same Visit/same key; same Dentist/two Visits; different Dentists/two Visits. Both workers demonstrably wait on locks; final commits verify counts, history/audit, exact links, unchanged losing states, no completion or fabricated appointment.
* Final `node --test` batch: **219 passed**, zero failed/skipped, across `encounter-recovery`, `patient-booking-recovery`, `den-ui-02`, `m5-treatment-cutover`, `m9-queue-cutover`, `dev-b-01-r1`, `patient-booking-policy`, `arrival-command`, `m9-live-queue-truthfulness`, `m6-cutover`, `aud10-shared-booking` `.test.js` files. Tests include original revision preservation despite refreshed revision 7, lost-response retry after projection changes, wrong service/identity receipts, obsolete auth/unmount, bounded waiting, guardian isolation and cancelled/rescheduled current readback.
* Runner safety discovery: **16 passed**; inherited Python lock-handle resource warnings remain.
* Actual React/Laravel/PostgreSQL browser: **6 encounter groups** collected across resumable runs, including scheduled committed response loss + same-key keyboard retry + one draft save; new Dentist session; walk-in start committed-loss reload without retry; Patient/Staff denial; one-action call/open without treatment creation; six widths. **5 Patient booking groups**: real booking committed then deliberately returned HTTP 500; identical-key/body retry; exact reference/focused row; new-session current read; foreign Patient denial; six widths.
* Existing adversarial Dentist fixture browser: **4 complete width journeys (390/768/1024/1440), 221 intercepted requests, zero page errors**, including stale revision, validation, clinical text retention, navigation protection, chart/prescription/follow-up return paths and expired session. Contract-fixture locator/count mismatches were corrected while preserving the business assertions.
* Smoke/build pass with inherited React Table key and >500 kB bundle warnings. Six-width actual workflows also cover 375/430. Keyboard and horizontal-overflow checks are scoped evidence, not WCAG certification.
* `git diff --check`, all changed PHP syntax checks and changed/new-file secret scan passed. No migration, App/layout or activation-config changes. No hosting/deployment triggers added.

No full-system suite or comprehensive audit. Prior six queued-mail Intake assertion failures and historical OWN-11 were not rerun or claimed fixed. Prior predefense prerequisites remain unaccepted (worker, scheduler, synthetic Patient count, unpaid invoice, synthetic contacts/hours, aged unsent outbox); no live delivery or invented clinic facts were used to make that gate pass. No new failing business invariant is accepted.

## Remaining / next owned batch

GEN-09 remains partial beyond these measured paths. STF-11/13 policy blockers remain. Next source-supported independent work: exact Patient clinical record/receipt navigation and any reproducible original validation/accessibility defect; preserve accepted prescription/settlement semantics. Full-system acceptance and branch integration remain later phases. Other-target AUD-10 activation must still satisfy its actual gates.
