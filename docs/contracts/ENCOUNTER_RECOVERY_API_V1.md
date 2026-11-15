# Encounter recovery v1 — implemented 2026-11-15

Clinical owner: Jaztin. Existing Treatment lifecycle/constraints remain authoritative. No schema or workforce changes.

## Start (existing POST, additive reviewed queue context)

`POST /api/visits/{visit-public-ULID}/treatment`, authenticated responsible Dentist, `Idempotency-Key` required:

```json
{"expected_revision":1,"queue_id":"<queue-entry public ULID>","expected_queue_revision":2}
```

`expected_revision` remains the originally observed Visit revision. The new queue fields are optional for older clients but required together when supplied. The current UI supplies both and retains them on retry. A different queue identity or revision returns `409 queue_context_changed`; neither is silently updated. Patient/branch/Dentist/Visit identity overrides remain prohibited.

Current active account, auth version, role and responsible Dentist are checked before journal replay and again under the Visit lock. Existing prerequisites remain: valid Visit/appointment/queue relationships; Checked In Visit/appointment; Called or Treatment Ready queue; responsible Dentist resolved; clinic day valid; no existing Treatment for that Visit; no other active treatment for that Dentist. No roster policy is added.

Lock order remains appointment → Visit → queue → Treatment. One transaction creates Treatment at revision 1/In Treatment, moves Visit/appointment to In Treatment, queue to Served and appends history/sanitized audit/journal. **Served means treatment started.** Completion remains a separate explicit command.

`201 {"data":<TreatmentResource>}` includes exact Treatment, Visit, queue, Patient, branch, Dentist, optional appointment, requested service and state/revision. `visit.queue.revision` is additive. Same-account/same-key/same-payload replay returns the original response. Changed payload/key reuse refuses; distinct competing starts cannot create another Treatment. Existing unique indexes enforce one Treatment per Visit and one active treatment per Dentist.

The client validates the returned tuple and original start revision before any documentation. A pre-start draft is saved with the Treatment revision returned by that start (1) and its separate retained save key; a newer list projection cannot replace that expected revision. Changed auth/selection prevents automatic documentation or result adoption. Requests have bounded waiting, with no automatic retry loop or implication that a timeout cancelled the transaction.

## Exact current readback (new GET)

`GET /api/visits/{visit-public-ULID}/treatment`, responsible authoring Dentist only:

```json
{"data":{"id":"<Treatment public ULID>","status":"In Treatment","revision":2},"meta":{"encounter_readback":true}}
```

Example abbreviates the full clinical TreatmentResource and author-visible history. The route resolves the existing Treatment by unique Visit relationship under consistent locks and validates the persisted queue/appointment/state links. It creates nothing. Walk-ins retain `appointment: null`. Response is `private, no-store`.

This is **current encounter readback**, not a claim that a particular lost HTTP command succeeded. An absent record returns 404; absence does not prove a still-pending request failed. Existing own-history Treatment reads remain unchanged. Staff, Patient and Owner cannot use this Dentist recovery endpoint. Another Dentist/foreign assigned Visit is denied. Missing/inconsistent links refuse; identities are never repaired implicitly.

Errors preserve existing envelopes: 401 authentication; 403 active-account/role/responsibility; 404 missing Visit/Treatment; 409 stale revision, reviewed queue mismatch, already-existing Treatment or Dentist busy; 422 validation/prerequisite or changed idempotency payload. No error is converted to clinical completion.

## Queue navigation and Patient booking dependencies

The existing `POST /api/queue/{queue-public-ULID}/call` contract is unchanged. Dentist “Call and open encounter” navigates only after exact Patient/Visit/queue/branch/Dentist/appointment receipt validation and refresh, with auth/request-lifetime checks. It creates no Treatment. Waiting → call → open changes from 2 interactions to 1; Start Treatment is still explicit.

Patient booking uses the existing appointment POST/GET/list endpoints and scheduling authority. Server/transport/timeout/malformed-result ambiguity retains the original intent/key. A verified original booking receipt is followed by an exact-ID authorized current read: cancellation/reschedule changes are displayed, and a failed current read is labelled unverified rather than as failed booking or current confirmation. Patient/dependent, branch, service, provider and time are validated; obsolete sessions cannot adopt a result. My visits receives the exact returned appointment ID. No cancellation policy, processor, duty backend or AUD-10 activation change.

Source/test evidence and shared-file overlaps: [batch 03 report](../JAZTIN_CLINICAL_BATCH03_20261115.md).
