# Selected follow-up booking API v1

Implemented on `feature/jaztin-qa-20261115`, from `a0725e645df6f8266c2bc4bebacc9d62dd18e7c1`. November 15, 2026, Asia/Manila. Clinical ownership: Jaztin. This extends the existing AUD-10 R2 implementation; it creates no scheduling authority, payment policy or clinical completion rule.

## Booking

`POST /api/appointments`, existing Sanctum authentication and appointment booking policy. Selected mode is Staff only, within current `user_branch_scopes`. Ordinary booking behavior is retained.

Existing body: `patient_id` (Patient public ULID), `branch_ref`, `service_ref`, optional `dentist_ref`, `date`, `start_time`, optional notes/consultation acknowledgement. Selected mode adds both `followup_task_id` (public ULID) and `followup_expected_revision` (integer 1–2147483647). Require `Idempotency-Key` header, 1–255 visible ASCII characters. Neither field may be silently ignored or replaced with a Patient/branch match.

If the task has a Dentist, omitted `dentist_ref` resolves that exact Dentist. Another Dentist is refused with 422 `followup_dentist_mismatch`; unavailable requesting Dentists do not fall back to a colleague. Scheduling still validates existing duty, eligibility, branch/service and conflicts. Staff may choose the booking service under existing rules; the task service remains a prefill, not a new eligibility policy.

The existing journal binds actor, key, command and original intent including task/revision. Within one transaction: journal → provisional appointment/exclusion constraint → slot claims → exact task lock → current authorization/revision/Patient/branch/Dentist validation → linkage/audit → notification intent → journal receipt. Conflict/failure rolls back provisional writes. No increased retries or lock-order reversal.

Success: HTTP 201, existing appointment `data`, plus:

```json
{"meta":{"followup_link":{"task_id":"<task ULID>","appointment_id":"<appointment ULID>","status":"Booked","revision":8}}}
```

Revision shown is illustrative: actual value is observed task revision + 1. `Booked` does not mean clinical follow-up `Closed`, treatment completed or admission. Same account/key/intent replays the original status/body with `Idempotent-Replayed: true`, after current authority checks. Never replace an old expected revision with a refreshed one. Failed commands leave no completed journal receipt.

Existing errors remain: 403 role/current authority; scoped missing/out-of-scope task 404 (ordinary appointment policy can refuse a forbidden intended branch first); 422 Patient/branch/Dentist mismatch, invalid fields/key or schedule; 409 `followup_conflict`/`schedule_conflict`; 422 `idempotency_key_reused`. A refusal after an uncertain outcome does not prove the first write failed.

## Exact task and transition readback

`GET /api/followups/{task ULID}` remains branch-authorized Staff/Dentist readback, independent of capped active worklists and generic Patient-profile permission. It now includes nullable `dentist: {id: <legacy Dentist ref>, name: <authorized display name>}`. Owner lists remain metadata-only; Patients cannot read task reasons.

`PATCH /api/followups/{task ULID}` retains `action: contacted|close` and optional close note. Additive `expected_revision` is optional for backward compatibility, but required by the updated React callers. When supplied, validate the observed revision under the task lock before any mutation: stale values return 409 `followup_conflict`. Existing allowed state/note rules, revision increment and transactional sanitized audit remain. This does not add idempotent contact/close receipts; uncertain updates require current-state review.

## Durable original receipt recovery

`GET /api/followups/{task ULID}/booking-receipt`, Staff only. Returns the **latest committed selected-booking receipt for this exact task and authenticated account**, not a receipt inferred from current linkage or a similar appointment:

```json
{"data":{"data":{"id":"<appointment ULID>","status":"Confirmed","revision":1},"meta":{"followup_link":{"task_id":"<task ULID>","appointment_id":"<appointment ULID>","status":"Booked","revision":8}}},"meta":{"historical_receipt":true}}
```

`data.data` is the complete existing appointment resource originally committed, abbreviated above. No command key, request hash, token or task reason is returned. Recheck active account/auth version, scoped task, appointment view permission and exact persisted Patient/branch identity before disclosure. Another Staff account does not acquire the creator's journal, even if it may view the current task/appointment. Out-of-scope/missing task, missing original receipt and changed Patient/branch context return 404. Other roles return 403.

This is a historical receipt: later cancellation, rescheduling, task closure or a subsequent authorized booking does not rewrite it. GET current task/appointment separately for current state. A missing receipt means unresolved, **not** proof of failed booking; the original transaction may still be pending or belong to another account. GET never retries or creates. Reload/new authenticated sessions need no browser-stored key or Patient details. The UI never uses this endpoint to rebase or automatically settle an in-memory booking command.

## Capability and rollout

`GET /api/followups/booking-capability`, authenticated active Staff only, `Cache-Control: private, no-store`:

```json
{"data":{"contract":"followup-booking.v1","enabled":false,"schema_ready":true,"exact_task_linkage":true,"receipt_recovery":true,"dentist_context":true}}
```

`enabled` requires the schema columns and `SELECTED_FOLLOWUP_BOOKING_ENABLED=true`. Checked-in default is **false**. The clinical modal reads the running endpoint, binds readiness to its API base and requires all contract flags before opening the existing shared form. Caller/store claims alone do not activate the clinical entry point. The legacy commit attestation remains only for compatibility with the already tested shared-form interface; production clinical entry uses runtime capability.

A capability response is a release control, not authorization or a substitute for acceptance. Run the scoped PostgreSQL tests, fresh-clone contention and real cross-role browser driver for each target before explicitly enabling. Local synthetic target acceptance does not authorize deployment or enable another environment. All exact task/receipt/capability GETs are private/no-store.

## Persistence and shared dependencies

No schema change or new migration. Reuse `followup_tasks.appointment_id`, existing foreign keys/revision/checks, appointment exclusion constraints, per-account unique command key and sanitized audit. Four held migrations stay pending. No records are deleted or historical states rewritten.

Workforce duty/roster remains Joevan's authority. Selected booking consumes the existing scheduling service, without changing workforce endpoints or semantics. Shared-file additions are limited to the two follow-up GET routes, three read adapters and the disabled-by-default configuration/example. No App/layout/middleware/payment changes.

Executable evidence and rollout limitations: [sprint record](../JAZTIN_CLINICAL_SPRINT_20261115.md).
