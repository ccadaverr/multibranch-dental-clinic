# GEN-07 schema and Sex/Other decisions

GEN-07 remains Partial. This document proposes decisions; it does not authorize a migration, establish clinic demographic policy or change access.

## Exact additive proposal

`backend/database/proposals/2026_11_22_000100_add_gen07_selection_details.php` SHA-256 `dd6fc2ae8a68a8d806e66cf776fbad7555224b65dfaeba965811852341854016` adds seven nullable columns: `assistant_answers.category_detail` (255), `appointments.cancellation_category` (100), `cancellation_detail` (255), `cancellation_actor_role` (20), `followup_tasks.reason_category` (100), `treatments.followup_reason_category` (100), and `prescription_lines.value_origins` (JSONB). It has no backfill, status conversion, history rewrite, grant schema, index or foreign-key change. Its rollback refuses destructive reversal; recovery requires a reviewed snapshot/forward plan. Existing table constraints and encrypted prescription values remain operative. Server validation supplies category/detail constraints; these columns do not add database check constraints.

The file remains outside default migration discovery. No installation occurred. Separate approval was requested for a NEW disposable target `/private/s02-gen07`, loopback55573 only; no approval has been received. Do not copy the proposal into the discovered chain or run an 88-entry profile without that approval and a reviewed exact execution plan. Existing integration/demo/test and developer databases must remain untouched by installation.

## Supported unchanged 87-entry runtime

`SelectionDetailsSchema` reads column availability without DDL. Login/me reports a boolean capability, which is not an authorization grant. The client preserves existing recorded-text cancellation, follow-up, treatment and prescription workflows, with a notice that a separate category label is unavailable. Typed provenance requests are explicitly rejected with 503 and `selection_details_unavailable`; they are never silently discarded or stored in unrelated fields. Owner Other-category answer creation/changes are visibly disabled until ready; standard answers and existing reads remain supported. Historical values are not retroactively classified from catalog matches. Documents use their existing metadata column and leave forms use existing reason storage.

The six `SelectionPersistenceTest` cases require the approved new columns and remain **not executed on the integrated source**. They are delivered source-workspace tests, not integrated evidence. The new `LegacySchemaCompatibilityTest` instead verifies the actual unchanged profile, atomic refusal, persisted text, replay, branch privacy and current actor revocation. No main runner guard or 87-entry expectation was weakened.

## Staff Sex/Other: proposed contract, not implementation

The relevant Staff surface edits a Patient's sex in `Clinical.jsx`/`ServerPatientSummary`, not a personnel-demographics administration API. Current server `UpdatePatientRecordRequest` accepts nullable free text up to30 characters in `sex`; `patient-records-api.js` maps that one value and `persons.sex` is a nullable string. The local prototype New Patient modal has Female/Male/Other and `sexOther`; its flattening does not establish a two-field server contract. Guardian/intake choices differ and must not be silently unified.

Proposed review questions and boundaries:

- Confirm the clinical meaning/label and allowed codes. Female/Male/Other exist in the prototype; whether blank or any additional choice is permitted requires clinic approval. Do not conflate sex and gender or assume Other means a diagnosis.
- Other would mean an explicitly selected category with a separately entered, trimmed Specify value. Approve maximum length and wording/example before implementation. Reject missing/whitespace detail and stale detail on standard selections server-side; clear it on a deliberate standard selection.
- Preserve existing `persons.sex` values byte-for-byte as unclassified recorded text. A separately reviewed nullable category/detail representation and compatibility response must store/read both; do not infer a code from historical free text or backfill it without approval.
- Keep editors restricted to current `PatientPolicy::update`: Staff with existing full-profile branch/record authority. Retain patient revision/CAS, account revocation, exact Patient/Person linkage and idempotent recovery. This proposal adds no Owner, Dentist, Patient-self or blanket branch access.
- Retain `PatientRecordResource` tiered disclosure: identity-only responses omit sex; authorized full-profile reads retain current visibility. Audit field names only, never demographic values in logs, messages, notifications or analytics.

Required next work after policy/schema approval: implement this single approved contract across Staff UI, API validation, canonical Person persistence/readback and recovery, with branch/role/revocation tests, legacy-record tests and keyboard/six-width checks. Until then GEN-07 cannot be fully accepted.
