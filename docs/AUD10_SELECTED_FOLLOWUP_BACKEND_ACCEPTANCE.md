# AUD-10-BE-01 — Selected follow-up linkage backend handoff

Date: 2026-11-11, Asia/Manila. Revision: **AUD-10-BE-R2**. Status: **CONDITIONAL — backend source corrections and database-free checks complete; PostgreSQL and frontend acceptance pending.** Technical choices below implement the expressly approved contract; they are not newly asserted clinic policy.

## Checkpoint and scope

- Repository: `https://github.com/ccadaverr/multibranch-dental-clinic.git`.
- Branch: `feature/joevan-aud10-followup-linkage-20261111`.
- Absolute worktree: `/Users/glesielynalcantara/Documents/dentalops-integrated-review/scratch/integration-abc-20261111/scratch/joevan-aud10-followup-linkage-20261111` (a separate registered Git worktree under the writable scratch workspace).
- Starting and final uncommitted HEAD: `15d626c03c97baf7198a7b7ca6dea2bec8f60836`.
- Fresh `git ls-remote` verified `integration/ux-hardening-20261111` at that exact SHA before implementation and again during final verification. No fetch configuration changes were needed; the commit was already present.
- No frontend production, route, policy, resource, shared idempotency helper, payment service, configuration, dependency or migration file was changed. No staging, commit, push, merge, deployment, database connection or migration execution occurred.

R2 preflight verified the exact four-modified/seven-untracked manifest, empty index, branch/HEAD and all eleven R1 SHA-256 hashes. The complete reviewed R1 files and hash manifest were copied, without alteration, to `/private/tmp/aud10-be-r1-checkpoint-i7iky4v_`. Previous logs and `/private/tmp/aud10-be-final-manifest.json` are preserved. R2 uses the same worktree and eleven-file manifest; it creates no new branch or commit.

## R2 corrective scope

The independent audit identified an opposing task/appointment lock order and a direct-service regex whose `$` anchor accepted a final newline. R2 moves only the authoritative selected-task lock and revalidation after provisional appointment creation and slot claims. An early **nonlocking** check, after the journal's completed-replay path, preserves prompt 404/409/422 refusals. The final locked record is separately resolved and revalidated; the early snapshot never authorizes a transition.

The direct-service key regex now uses absolute `\A`/`\z` anchors. The accepted format remains exactly 1–255 visible ASCII characters, matching the existing HTTP header reader. New real-service tests stop at an actor-lookup sentinel before any database access: valid keys reach it; invalid keys must raise validation first. Against R1, trailing LF and CRLF reached the sentinel (two failures out of twelve cases); all twelve pass against R2. Leading/embedded newlines, tabs, spaces, Unicode, empty/missing and oversized keys are also covered. Existing replay/different-intent checks are retained.

## Confirmed defect

`ServerFollowups.jsx` prefills Patient/branch/service/date but loses the selected server task's ULID and revision. `Scheduling.jsx` and `appointments-api.js` submit ordinary appointment fields. The original `StoreAppointmentRequest` and controller neither validate nor forward selected identity. `Followups::booked` chooses a task by Patient, branch preference, due date and internal ID, so a selected later task can be replaced by an older eligible task. The browser evidence from earlier work did not prove persisted linkage.

This backend-only change supplies the missing contract. The existing frontend continues ordinary matching until Jaztin and Yzhekiel adopt it; AUD-10 is not yet corrected end to end.

## Request and response

`POST /api/appointments` retains all ordinary appointment fields, legacy branch/service/Dentist references, Patient ULID, scheduling validation, and existing role policies.

Selected mode adds **both** `followup_task_id` (public ULID string) and `followup_expected_revision` (integer 1–2147483647), plus the `Idempotency-Key` HTTP header (1–255 visible ASCII characters). Presence of either field, even null/empty, selects strict validation. Neither field supplied means ordinary booking, including its optional idempotency key. A body field cannot replace the header. Integral revision strings are normalized to integers for the command fingerprint.

Successful selected booking is HTTP 201 with the existing appointment `data` resource and additive proof:

```json
{
  "meta": {
    "followup_link": {
      "task_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "appointment_id": "01ARZ3NDEKTSV4RRFFQ69G5FAA",
      "status": "Booked",
      "revision": 8
    }
  }
}
```

The IDs and revision above are illustrative. Actual proof comes from the saved task and appointment inside the transaction. Internal bigint identifiers never enter this proof. Ordinary responses gain no new `meta` key. The appointment serializer's existing resource remains unchanged.

| Refusal | Status / shape |
| --- | --- |
| Missing/invalid paired fields or required header | 422, existing Laravel `message`/`errors` validation envelope |
| Non-Staff selected mode, inactive/stale actor, forbidden appointment branch | Existing 403 authorization boundary |
| Missing task or task outside current Staff scope | Scoped 404, before any Patient/branch comparison |
| Authorized task with a different Patient | 422 `followup_patient_mismatch`, `errors.followup_task_id` |
| Authorized task at a different intended branch | 422 `followup_branch_mismatch`, `errors.followup_task_id` |
| Stale revision, noneligible status or existing appointment link | 409 `followup_conflict`, generic reload guidance; no clinical reason/current task details |
| Same key, changed authorized intent | Existing 422 `idempotency_key_reused` |
| Scheduling validation / exhausted scheduling race | Existing 422 `schedule_invalid` / 409 `schedule_conflict` |

Unknown or inaccessible identities are deliberately refused before journal replay/hash errors; changing a key's task to an inaccessible task does not reveal its existence. No invalid selected identity falls back to ordinary matching.

## Authorization, replay and transaction order

1. Authenticated route middleware and `EnsureAccountAccess` retain their existing session/account checks. Request authorization permits selected fields only for Staff; Owner, Patient and Dentist acquire no clinical selected-booking authority.
2. The controller retains `AppointmentPolicy::book` for the intended branch and the existing Patient/guardian resolution. It forwards only validated selected fields and requires the header in selected mode.
3. `AppointmentService::create` also validates selected input/key for direct service callers. `Followups::selectedForBooking` rereads the actor, requires Active Staff, unchanged authentication version and a Person, applies the existing booking policy, and scopes the exact task query using current `UserBranchScope` rows. No creator or assignee restriction is added.
4. This state-independent authorization happens **before** `IdempotentCommand::run` can replay. The task is not rejected merely because the original command booked it. Replay returns the originally committed HTTP status/body with `Idempotent-Replayed: true`; proof is an original receipt, not a claim about the task's latest state after cancellation/closure or later authorized changes.
5. For new work, the unchanged journal opens the transaction and inserts the per-account unique key row. An early scoped **nonlocking** task snapshot validates Patient, branch, revision, eligibility and absence of linkage. This preserves an immediate `followup_conflict` for a task already Booked, even when its appointment would also cause a scheduling conflict. Completed replay never enters this callback.
6. Existing scheduling/price rules run, then the appointment, history/audit and slot-opening claims are provisionally written inside the transaction. Staff selected bookings cannot initiate online checkout. After appointment/slot claims, selected booking rechecks current actor/scope, locks the exact task with `FOR UPDATE`, and revalidates Patient, branch, revision, `Open`/`Contacted`, and null `appointment_id`. Only then does `bookSelected` run; the generic matcher remains exclusively the ordinary-mode alternative.
7. The task becomes `Booked`, gets that appointment, booking time, actor update marker and revision +1. Existing `followup.booked` audit naming is retained, with the Staff actor and public task/appointment IDs, without reason/close note. A refreshed task supplies proof. Existing appointment history, notification/send intent, serialized response and journal response are in the same transaction.
8. A refusal or propagated failure, including a late task-state or authority refusal, rolls back the provisional appointment, slot claims, task transition, history, audit and command key together. Notifications/send intents follow successful linkage; mail dispatch is after commit. As before, a failed command stores no durable refusal receipt; a retry may reevaluate. Same-key successful replay never reexecutes work; different intent binds both task identity and revision in the existing fingerprint. PostgreSQL sequence gaps on rollback are normal and are not durable business rows.

### Lock ordering and remaining concurrency acceptance

R1 locked **journal key → selected task → appointment/exclusion constraint → slot openings**. An ordinary booking could own an uncommitted overlapping appointment and wait for task T while selected booking owned T and waited for that appointment's constraint. The R1 snapshot retains that source for comparison.

R2 now locks **journal key → appointment/exclusion constraint → slot openings → exact selected task**, then holds the task lock through linkage, proof and commit. Ordinary immediate creation and provider settlement already acquire appointment/slot locks before task locks. Neither early selected lookup acquires a task row lock. The identified opposing task/appointment and task/slot order is therefore removed at source level; retries were neither increased nor suppressed.

Two selected attempts for one task at different times may both create provisional appointments, but serialize at final task validation; only one can link, and the loser rolls back its provisional rows/key. Overlapping attempts serialize/refuse through appointment exclusion first. Contact/Close serialize on the task; if they change it first, final selected validation refuses without undoing a separately committed change. Rescheduling retains the existing appointment identity/link; cancellation reopens with its existing revision increment. No generic matcher runs in selected mode.

The original four contention scenarios are retained. R2 adds an overlapping-slot scenario with test-worker IPC barriers: pause selected immediately before appointment INSERT; pause ordinary immediately after its competing INSERT; release selected and observe its INSERT actually waiting on PostgreSQL; release ordinary. R2 must produce ordinary 201, selected 409 `schedule_conflict`, one appointment/key and the ordinary task linkage. Both workers must report exactly one command-journal INSERT attempt, so deadlock retries cannot hide the old cycle. Unrelated after-commit mail transactions do not affect this counter. R1 would either change the winning outcome or require a second command attempt. This is a designed regression, **not an executed PostgreSQL result**.

No global deadlock-freedom claim is made. Existing opening-before-appointment move-up operations, multi-row contention, provider handling and concurrent account/scope revocation remain separate acceptance concerns. The existing cancellation/refund HTTP call inside its transaction is unchanged and remains an external-atomicity risk; this correction does not redesign it. Existing appointment retry counts, webhook retries and polling behavior are unchanged.

## Exact changed-file manifest

Modified tracked production files:

- `backend/app/Http/Controllers/AppointmentController.php`
- `backend/app/Http/Requests/Appointment/StoreAppointmentRequest.php`
- `backend/app/Services/Appointments/AppointmentService.php`
- `backend/app/Services/Followups/Followups.php`

New tests, support and evidence:

- `backend/tests/Unit/SelectedFollowupRequestTest.php`
- `backend/tests/Unit/SelectedFollowupBookingTest.php`
- `backend/tests/Unit/SelectedFollowupIdempotencyTest.php`
- `backend/tests/Feature/Followups/SelectedFollowupBookingTest.php`
- `backend/tests/Feature/Followups/SelectedFollowupConcurrencyTest.php`
- `backend/tests/Support/aud10_booking_worker.php`
- `docs/AUD10_SELECTED_FOLLOWUP_BACKEND_ACCEPTANCE.md`

## Executed checks and failure-before evidence

Safe execution used MAMP PHP **8.3.30** and the existing Composer dependencies in `scratch/fe-int-p1-20261110/backend/vendor`. The default Herd PHP executable cannot start on this macOS version. Temporary bootstrap files explicitly remap **both** Composer PSR-4 and optimized class-map entries to the feature's App/Tests sources (or to the baseline for comparison). No shared vendor files were altered, no dependencies installed and no Laravel kernel/providers/.env loaded by Unit execution.

| Check | Result |
| --- | --- |
| Original baseline, all existing backend Unit tests | **171 passed, 1,027 assertions** |
| New request regressions against original baseline source | **17 cases: 4 pass, 13 fail**, exposing ignored malformed/pair fields and absent selected-role restriction |
| R1 feature source, complete backend Unit directory (preserved evidence) | **211 passed, 1,110 assertions** (40 new cases; no inherited Unit failure) |
| R2 feature source, complete backend Unit directory | **226 passed, 1,135 assertions** (all prior cases retained; 15 additional key/header cases) |
| R2 direct-service key regressions against preserved R1 source | Twelve cases: trailing LF and CRLF fail; ten pass |
| Same direct-service key regressions against R2 | Twelve passed; no model/database lookup for refused keys |
| Source-order contract inspection | R1 fails; R2 passes appointment → slot claims → exact task lock → locked validation → linkage → notification order |
| Test-barrier streaming transport | Passed in a database-free child-process probe; no Laravel kernel or database worker started |
| Real appointment resource and appointment command response serializer | Executed in Unit checks with unsaved related models and only model refresh stubbed; ordinary envelope and selected metadata pass |
| Real shared idempotency helper | Executed with an in-memory key-store/transaction double; proof replay, changed intent, failed work and retry pass |
| Changed PHP syntax checks | Pass for all 10 PHP files |
| Whitespace / changed-content secret-pattern scan | Pass; provider credentials in authored tests are explicitly synthetic, and no environment file was read or changed |

Logs remain in `/private/tmp/aud10-be-failure-before.log`, `/private/tmp/aud10-be-baseline-unit.log`, `/private/tmp/aud10-be-unit.log`. Bootstrap files are `/private/tmp/aud10-be-unit-bootstrap.php` and `/private/tmp/aud10-be-baseline-bootstrap.php`. These machine-local aids are not committed artifacts. The request failure-before test establishes the missing contract boundary, **not a persisted wrong-task reproduction**; that requires PostgreSQL.

R2 evidence is separate: `/private/tmp/aud10-be-r2-key-failure-before.log`, `/private/tmp/aud10-be-r2-unit.log` and `/private/tmp/aud10-be-r2-order-check.json`. The ordering check is structural source inspection, not execution of a database command or proof of deadlock freedom. The original baseline/request evidence remains historical evidence and was not overwritten by R2.

No frontend suite, browser acceptance, production frontend build, smoke/predefense script, Feature execution, provider diagnostic or database-backed test was run in this backend-only assignment. Prior frontend failures, HMO smoke, OCR/bundle warnings and clinical/database gaps are not claimed fixed.

## Authored PostgreSQL regression matrix — NOT EXECUTED

The Feature files now contain **25 request/workflow cases** (20 methods with providers) and **one contention case containing five scenarios**. All original 23 cases/four scenarios are retained. Request/workflow cases use `DatabaseTransactions`, not `RefreshDatabase`; they require an approved preprovisioned disposable schema. The contention case requires empty committed fixtures, `AUD10_DISPOSABLE_POSTGRES_ACCEPTANCE=1`, the inherited scratch guard and separate approval; it neither migrates nor cleans the database. Its worker takes the synthetic token through stdin and never prints it. Test-only barriers and command-attempt counts are outside the production API response envelope.

| Scenario | Executable evidence now | PostgreSQL acceptance authored |
| --- | --- | --- |
| Paired fields, ULID, positive bounded revision, required ASCII header | Real request/header/service Unit checks | 422, no appointment/key |
| Non-oldest selected task, two open tasks, Open/Contacted | Pure locked-record invariant Unit checks | Exact chosen row only, revision/proof/history/audit |
| Different branch, Patient mismatch, assignment independence | Context invariant Unit checks | Authorized B2 success, authorized mismatch 422, out-of-scope/missing 404 |
| Owner/Patient/Dentist and Staff branch limits | Real request authorization Unit checks | 403, fresh account/scope and replay checks |
| Closure, stale revision, existing link | Real invariant Unit checks | HTTP 409, no fallback or orphan |
| Same-key replay and task/revision changed intent | Real journal helper with memory store | Same original proof, one appointment/transition; 422 on changed authorized intent |
| Refusal/retry, exception after task write | Memory transaction protocol checks only | Schedule refusal and post-link audit failure roll back key/history/audit/appointment/task |
| Different keys / same task | No simulated concurrency claim | Two real blocked workers: 201+409, one link |
| Same key / same task | Sequential replay Unit only | Two real blocked workers: same 201 body, one appointment |
| Closure while waiting | No concurrency claim | Parent closes locked task; both workers 409 |
| Ordinary competitor | Source review of existing generic row lock | Mixed paths never overwrite selected linkage |
| Opposing overlapping-slot cycle | Structural corrected-order check; database-free barrier transport only | Coordinated real INSERT/constraint/task contention; ordinary wins without a retry; no selected provisional row/key survives |
| Late refusal after appointment and slot writes | Locked invariant/source review only | Deterministic in-transaction closure injection refuses and rolls back appointment, slot claim, history, audit, key and injected change; separate real-process closure scenario preserves the independently committed closure |
| Malformed selected HTTP header | Real direct-service/header-reader checks | LF/CRLF/embedded/leading newline, space and oversized header refused without business writes |
| Ordinary Staff/Owner/Patient/dependent | Existing paths source-reviewed | Existing authorization, guardian Patient identity and ordinary automatic matching |
| Online payment hold, polling and webhook settlement | All existing payment code/call sites reviewed, unchanged | Fake-provider polling/webhook settlement links automatically once; selected Staff never creates checkout |

Existing `AppointmentLifecycleTest`, `ConcurrentBookingTest`, `FollowupTest`, `Follow02AtomicTransitionsTest`, `Follow03RevisionResponseTest`, `FollowupExactReadbackTest`, `AppointmentBookingPaymentTest` and Intake guardian cases were inspected for compatibility but **not executed**. Some existing suites run destructive migration setup; do not run them until separately authorized.

The queue migration remains unsafe/blocked. A scratch guard allowing a database connection is not authorization to execute the migration chain. Separate infrastructure and migration-safety approval is still needed for any PostgreSQL acceptance.

## Frontend handoff

- **Yzhekiel:** propagate the exact server task `id` and observed `revision` from `ServerFollowups` into the booking context. Do not substitute a legacy/local follow-up ID. Retain selected identity across user edits; changing Patient/branch must invalidate/reselect the clinical context rather than silently dropping the fields.
- **Jaztin:** extend the shared appointment form and transport to serialize the pair only for selected mode and reuse one stable attempt header for retries of unchanged intent. The current `appointment-flow.js` legacy local `followupId` bridge is not this server contract. Review all callers. Preserve top-level `meta` through `appointments-api.js` (the raw client can decode it, but the command adapter currently drops it).
- Verify response task ID, appointment ID matching `data.id`, `Booked` status and returned revision. A replay receipt proves the original result, not the latest task state. Use authorized exact readback to reconcile later state. Do not adopt completion after actor/branch/context ownership changes.
- 409 requires reload/reselection and deliberate recovery; 403/404 must not reveal clinical details. A definitive refusal leaves no appointment/key. Timeout/connection loss is **unknown**, not a refusal: retry the same unchanged command with the same key; do not generate a new attempt or clear selection and send ordinary booking automatically. Lost-key recovery is outside this extension.
- **Combined acceptance:** run approved PostgreSQL cases, then browser-selected task B vs task A, context-switch/stale completion, failure recovery and ordinary booking/payment compatibility. No frontend or live acceptance has been granted by this backend report.

## Source review and limitations

A separate read-only R2 review pass covers the correction against preserved R1 source, the full baseline diff, all three generic `Followups::booked` call sites (ordinary creation, provider polling and webhook settlement), response serialization and existing authorization. The shared helper, policy, schema, generic matcher, cancellation and payment callers remain unchanged. Source inspection finds the identified inversion removed, final locked validation retained, and provisional writes inside the existing transaction. This is the implementing agent's separate source-review pass; a separate reviewer has not independently signed off R2.

**Verdict: CONDITIONAL for technical-lead review.** The two authorized source corrections and safe checks are complete. Required limitations: no real row-lock/rollback/replay/database acceptance; remaining legacy/provider contention and concurrent authorization revocation remain acceptance risks; no live cookie/session/provider testing; frontend identity/proof adoption and stale-completion handling remain outstanding. No new exclusive task ownership, cross-branch transfer, clinical decision, payment policy or schema was introduced.

Unsafe queue migration, unexecuted Staff/readback database regressions, clinical mutation receipt/idempotency gaps outside this selected-booking command, Dentist service eligibility, existing frontend failures and real payment/refund/reconciliation acceptance remain unresolved. The old architecture document's `Scheduled` terminology is not renamed by this change; this approved endpoint extension uses the actual task runtime `Booked` state. No source publication or end-to-end clinical acceptance is implied.

Final Git state: **4 modified tracked + 7 new untracked files; empty index; HEAD unchanged.** All original source/integration branches and worktrees are preserved. Stop here for technical-lead review; no commit/publication authorization was exercised.
