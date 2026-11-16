# Arrival recovery API v1 — implemented, 2026-11-15

Clinical owner: Jaztin. Additive to the existing Visit contract; no schema migration or workforce authority change. This contract does not activate AUD-10 on other targets.

## Commands

Authenticated, active Staff in the target branch may invoke these existing commands. Preserve the existing documented Owner administrative exception; Dentist/Patient cannot admit. Current server authority is checked before journal replay and again inside the transaction.

`POST /api/visits/check-in`, with `Idempotency-Key`:

```json
{"appointment_id":"<appointment public ULID>","expected_revision":1,"id_confirmed":true}
```

Patient, branch, service and Dentist are resolved from that exact appointment; client substitutions are prohibited. The new UI sends the explicit physical-ID acknowledgement. `id_confirmed` is additive/optional for existing clients; if supplied it must be accepted. This does not establish a new global ID/HMO policy. The original observed revision is never substituted. Existing same-day, state and payment-hold prerequisites remain operative.

`POST /api/visits/walk-in`, with `Idempotency-Key`:

```json
{"patient_id":"<Patient public ULID>","branch_ref":"<branch legacy_ref>","service_ref":"<service legacy_ref>","dentist_ref":"<Dentist legacy_ref>"}
```

The Patient must already exist. Existing separate Patient registration remains available; registration never admits. Walk-ins have no appointment. The existing server supports nullable service/Dentist; the queue-oriented UI requires both. Eligibility uses the existing branch hours, service, Dentist and scheduling authority. No new priority/capacity policy is introduced.

Both commands return `201 {"data": <VisitResource>}`. The resource contains exact Visit ULID, Patient ULID/code, branch/service/Dentist references, source (`appointment`/`walk_in`), appointment or null, clinic date/arrival time, revision, and queue or null. New arrival is `Checked In`, revision 1. An assigned queue is `Waiting`, revision 1. Scheduled appointment becomes `Checked In` at expected revision + 1. No treatment starts or completes.

Writes use existing transactions, account/key journal, appointment row locking, one-Visit-per-appointment and one-active-Visit-per-Patient constraints, queue uniqueness, and append-only history. Same-account/same-key/same-payload retry returns the original receipt. Reusing a key with another payload conflicts. Distinct Staff/key contenders cannot create a second active Visit. The UI freezes intent/key after uncertainty; it never infers success from a refreshed list.

## Durable original receipt

New: `GET /api/visits/{visit-public-ULID}/arrival-receipt`.

```json
{"data":{"data":{"id":"<Visit public ULID>","status":"Checked In","revision":1}},"meta":{"historical_receipt":true}}
```

The example abbreviates the resource fields. `data.data` is the full original object from the committed command, not the current Visit. Response is `private, no-store`. Requires current Staff/Owner role, current Visit visibility/view authorization, and a successful arrival journal belonging to the **same authenticated account** and exact Visit. Patient, branch and appointment linkage must still agree. Missing or another account's journal returns 404. Patient/Dentist access is forbidden. A new sign-in by the original account can recover without retaining a browser key.

Use existing scoped `GET /api/visits` / `GET /api/visits/{id}` for current state. Patient reads their resulting scheduled appointment through the existing appointment API; Visit access remains prohibited. Do not expose another Patient's record or present historical `Waiting` as the current queue state.

Errors preserve existing envelopes: 401 session, 403 role/scope, 404 absent/inaccessible resource/receipt, 409 stale revision, duplicate active Visit or changed idempotency payload; 422 invalid fields/eligibility/prerequisites. Network/server/timeout outcomes remain unconfirmed. Retry the original command or review exact recorded arrivals; a missing receipt does not prove failure. No automatic retry loop.

## ID evidence extension

Existing Staff-only `POST /api/patients/{patient-public-ULID}/verify-id` accepts existing `id_type` and conditional `other_details`. Response now includes `patient_id` alongside `id_type`, `other_details`, `id_verified_at`. `other` requires nonblank trimmed details. Patient update and administrative audit are atomic. New verification timestamps preserve their actual instant under UTC or Manila PostgreSQL sessions; historical values are unchanged. The React checker requires exact Patient/type/detail/valid-time readback and retains the existing uncertain-outcome reload behavior. No new ID-number retention or external HMO operation.

## Shared dependencies and readiness

Only shared route addition: Visit receipt GET. API client adds this read and a walk-in request-ownership callback. No App/layout, roster schema, schedule API or duty semantics changed. Scheduling continues to use the established scheduling service. Integration must preserve Joevan's authoritative workforce changes and independently verify each target. Local focused PostgreSQL, actual contention, React/browser and build evidence is in `../JAZTIN_CLINICAL_BATCH02_20261115.md`. Full-system/integrated acceptance is deferred.
