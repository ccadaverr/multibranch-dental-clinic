# Chart recording API v1 — implemented, 2026-11-16 Asia/Manila

Clinical owner: Jaztin. Additive protocol on existing chart routes, notation, status list and append-only tooth history. No migration; the held tooth backfill remains held. This does not activate other-target AUD-10, introduce sign-off/correction policy or change workforce authority.

## Read and capability

`GET /api/patients/{patient-public-ULID}/chart`: existing authorized Dentist full chart; scoped Staff read-only chart without notes. Patient uses `GET /api/me/chart` (optional existing dependent `patient_id`), own/authorized dependent only, simplified current chart without history/notes/encounter/Visit identifiers. Owner has no chart-content access. All reads are private/no-store.

Dentist response `data` includes existing `patient`, `settings`, `current`, `summary`, `history`, plus:

```json
{"write_contract":{"version":1,"revision_scheme":"tooth_entry_count","idempotency":true},"tooth_revisions":{"36":2}}
```

Revision is the number of immutable entries for that exact Patient and FDI tooth, zero when absent. It is not a Patient-wide or Treatment revision. Existing 32 permanent / 20 primary FDI validation, Owner-configured status list and surface precedence remain authoritative. Dentist history adds `branch:{id:<legacy_ref>,name}`, `dentist_id:<legacy_ref>`, `treatment_id:<public ULID>|null`, `visit_id:<public ULID>|null`, `created_at:<offset timestamp>`. Existing clinical `recorded_on` remains separate from the actual documentation timestamp. Staff/Patient projections do not gain these fields.

The new React editor remains read-only without the actual v1 capability and revision map. Patient readback requires exact signed-in Patient identity and the simplified projection. Obsolete responses are not adopted.

## Record and recover

`POST /api/patients/{patient-public-ULID}/chart`, authenticated active authorized Dentist, `Idempotency-Key`:

```json
{"tooth":"36","status":"Caries","surfaces":["O"],"note":"<optional Dentist note>","recorded_on":"2026-11-16","branch_ref":"<assigned branch legacy_ref>","expected_revision":2,"treatment_id":"<optional exact Treatment public ULID>","expected_treatment_revision":3}
```

`branch_id` (internal integer) remains a legacy alternative to `branch_ref`, never both. Exact Treatment/revision are paired for keyed linked commands. Patient, Visit, Dentist/audit author, entry IDs and history cannot be overridden. A linked Treatment must belong to this Patient and this Dentist; branch must match its actual Visit and the Dentist's current branch assignment. Unlinked chart observations retain the existing branch-resolution rules. No Visit/appointment is fabricated for patient-level observations or walk-ins.

A keyed command requires its original tooth revision. Supplying an observed revision requires a key. Original legacy unkeyed clients remain compatible; they do not receive the new keyed/CAS guarantee. New UI always uses the guarded protocol. Do not present this additive contract as a removal of the legacy API.

Response `201` contains the authoritative chart snapshot plus:

```json
{"meta":{"chart_receipt":{"entry_id":"<public ULID>","patient_id":"<public ULID>","tooth":"36","revision":3,"branch_ref":"<legacy_ref>","dentist_ref":"<legacy_ref>","treatment_id":"<public ULID>|null","visit_id":"<public ULID>|null","treatment_revision":3}}}
```

Nullable fields above are JSON null, not the string `"null"`. The optional Treatment revision is null when unlinked. Same account/key/exact validated payload replays the original snapshot with `Idempotent-Replayed:true`, even after later findings; use a fresh GET for current chart state. Current account/role/Patient authority is rechecked before replay, and again inside a new write. Changed key payload: 422 `idempotency_key_reused`; stale tooth: 409 `chart_revision_changed`; stale linked Treatment: 409 `chart_treatment_changed`; invalid context/status/date/surfaces: 422; unauthorized role/current account: 403; inaccessible chart reads: 403/404 under existing role policy. Network/server/timeout means unconfirmed, never saved.

Command journal, append, clinical readback and privacy-preserving `chart.recorded` audit share one transaction. Patient+tooth advisory lock serializes CAS; linked Visit and Treatment locks precede it. Existing immutable history/command-key uniqueness remain in force. No Treatment, procedure, Visit, queue or finalized documentation is overwritten. A separate allowed chart append may reference a Completed Treatment without changing it.

React freezes original intent/key after an uncertain response, retries it without revision substitution, validates the exact returned receipt/history and preserves later typed drafts. After uncertain-command recovery it separately reads current chart state; a later tooth revision or unavailable current read requires explicit review, without silently updating the observed revision. Conflict also requires explicit saved-chart review. Reload/new sign-in reads persisted history; the in-memory unsaved editor/key is not stored as clinical text in localStorage. Reviewing a chart does not prove an earlier uncertain command failed, and does not edit/delete history. No automatic clinical completion.

## Evidence / dependencies

See [Batch 05](../JAZTIN_CLINICAL_BATCH05_20261116.md). Three actual PostgreSQL contention scenarios cover same-tooth distinct authorized Dentists, same command and independent teeth. No roster API/backend change. Shared API-client/Portal changes must preserve Joevan's functionality during later integration; no integration is performed here.
