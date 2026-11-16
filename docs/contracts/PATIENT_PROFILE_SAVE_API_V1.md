# Patient profile save v1 — implemented 2026-11-15

Owner: Jaztin, Clinical/Patient. Additive to existing `PATCH /api/patients/{patient-public-ULID}`. No new route, schema, profile fields, permissions, retention rule or workforce authority.

```http
PATCH /api/patients/{patient-public-ULID}
Idempotency-Key: <one reviewed command identity>
```

```json
{"expected_revision":1,"emergency_contact":"<Staff-reviewed permitted value>"}
```

The existing field allowlist and validation remain unchanged. Clinical notes/history, identity substitutions, account/security fields and role changes remain prohibited. Staff must have the existing full-profile authorization: an in-scope appointment/Visit or already-supported handover grant. Dentist/Owner/Patient cannot edit through this route. No new handover authority is introduced.

The account must still be active with matching auth version/person and current update permission **before journal replay and under the Patient row lock**. Lock order retains the existing email-registration table guard, Patient and Person locks. Compare-and-swap uses the original expected revision. Profile/Person changes, revision increment, field-name-only audit and account/key command receipt commit atomically. A failed audit/validation/stale revision leaves no successful journal.

`Idempotency-Key` is optional for older clients; the new Staff UI always supplies it. Existing unkeyed clients retain CAS behavior. Supplied keys use existing visible ASCII/255-byte validation and the shared `command_keys` journal, command `patient.profile.update`. Fingerprint includes the exact Patient and validated payload. Same-account/same-key/same-payload retry returns the original response with `Idempotent-Replayed: true`, even in a new sign-in. Another Patient/payload under that key is rejected. Current authority is required to replay a full profile receipt.

Response: `200 {"data": <PatientRecordResource>, "meta":{"unchanged":false}}`. Actual changes increment revision exactly once. A true no-op has `unchanged:true` and the same revision; it does not fabricate an audit/revision increment. Profile GET, linked-index GET and PATCH responses are `private, no-store`. Read scopes/tier restrictions remain unchanged.

The response is an **original command receipt**, not an assertion that no later edit exists. Existing `GET /api/patients/{id}` reads the current profile; `GET /api/patients/{id}/records` reads that exact Patient's scoped index. Client checks the requested Patient ID on both; malformed index families are not represented as zero records. Successful save requires matching Patient, full-profile tier and original revision +1 (or explicit same-revision no-op). No latest revision is substituted automatically.

The UI retains an immutable reviewed payload/key after timeout, 5xx, transport or mismatched-result uncertainty. Fields stay protected; Retry same profile save reuses the original command. A later refusal cannot prove an earlier uncertain write failed. Current-record review explicitly confirms replacement of the retained editor; a current read does not prove a pending write failed. The profile read and save have bounded waits and stale Patient/session suppression, including a pre-dispatch check after CSRF preparation. No browser-persisted Patient draft/key is added.

Errors: 401 session; 403 role/profile scope/account; 404 Patient; 409 stale revision; 422 field validation or changed idempotency payload. UI never converts an unverified receipt into success or shows another Patient's data.

Readiness: local synthetic PostgreSQL, actual Staff contention and real browser acceptance only. Older servers may ignore the additive key and cannot promise journal recovery; the client remains truthful on stale/uncertain outcomes. Other targets require their own contract/deployment acceptance. [Batch 04 evidence](../JAZTIN_CLINICAL_BATCH04_20261115.md).
