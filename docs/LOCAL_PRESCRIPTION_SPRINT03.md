# Sprint03 — persisted prescription lifecycle

2026-11-15, Asia/Manila. **FULL PRESCRIPTION WORKFLOW LOCALLY ACCEPTED** within the established clinical contract. Local synthetic acceptance of the existing prescription system. This report distinguishes actual browser journeys, PostgreSQL tests and intercepted component journeys. No hosted release, real prescription for clinical use, external delivery or selected-follow-up activation is claimed.

## Checkpoint and implementation

The registered controlled worktree is `scratch/integration-abc-20261111/scratch/qa-fullstack-controlled-20261114`, branch `integration/qa-fullstack-controlled-20261114`. Initial HEAD `820510b74e8131e9f3a130eec063b56b74e2f611`, parent `2b68c76d4d6f05d7077ffec3d8a313a3bd968c46`; index/worktree initially clean. The acceptance commit containing this report must have that starting HEAD as its parent. No push, merge, deployment or protected-reference change is authorized.

The existing prescription model, routes, revision counter, yearly number allocator, append-only triggers, audit service and PDF renderer are retained. No schema or migration change was needed. Changes complete the existing system:

- Browser Save, Issue and Void carry stable idempotency keys. The existing generic command journal stores encrypted clinical response snapshots; audit/notification metadata never contains medicines or notes. Replays reauthorize before exposing even the encrypted journal result.
- Transactions lock current account, Dentist profile and branch membership before the prescription. Concurrent revocation cannot slip past an earlier authorization projection. Issuance records the actual issuing Dentist, retaining the original creator separately.
- Every Void requires the reviewed revision. Server-owned identity, status, number and issuer fields cannot be supplied by the client.
- A server-issued opaque clinical context binds the browser's reviewed intent to its authenticated session instance. The browser rechecks local authorization after CSRF preparation and before bounded retries. A replaced cookie session is refused server-side even when the same Dentist signs back in. Headerless legacy/non-browser callers retain the established authentication, branch and revision rules; the header is an intent constraint, not an authentication credential.
- Save and Issue receipts must match exact prescription, Patient, Visit, branch, content, revision and lifecycle evidence. Success also requires authoritative GET readback. Unknown results retain the same command and pause competing edits; valid input survives refusal. A late result cannot overwrite a newer encounter or session.
- Empty additional medicine lines cannot disappear silently. Save Draft and explicit Issue remain separate. Confirmation captures the reviewed version rather than silently adopting later edits.
- Patient readback admits only authoritative Issued/Void records. Failed requests show Retry rather than a false empty state; obsolete reads cannot overwrite current data. Void reasons/dates remain visible.
- PDF responses remain authenticated and `private, no-store`, now with `nosniff`; the actual document visibly states Issued or VOID — DO NOT USE. No signature, license or verification credential is fabricated.

## Workflow and clinical policy

| Stage | Actual React action and backend operation | Persistence, access and recovery |
|---|---|---|
| Encounter → Draft | Dentist opens an existing completed synthetic encounter from My Queue history, follows Open visit prescriptions, enters Other medicine and saves with `POST /api/prescriptions`. | Exact Visit/Patient/branch; whitespace refusal; same-tick duplicate Save; reload and Edit draft read actual saved content. The corresponding Patient's detail read is404 and own list excludes Draft. |
| Explicit Issue | Review confirmation → saved revision → `POST /api/prescriptions/{id}/issue`. | Unique `RX-YYYY-NNNNNN`, Issued revision and actual issuer. Real response deliberately lost after server commit; Retry same prescription request reuses the identical key/body and returns the original number. Fresh GET must agree before UI success. |
| Patient readback | Separate Patient session → Prescriptions → exact issued record. | Own clinical details, reference and status persist after reload/new session; foreign Patient/Dentist/Staff reads refused. Owner receives permitted metadata only. |
| PDF | Patient clicks Download PDF. | Actual downloaded bytes parsed with strict PDF parsing: A4 pages, Patient, issuer, issue number/status, all medicine/instruction/note text and signature disclaimer. Unauthenticated401, foreign404, Owner403, invalid identifier404. Branch Staff has established non-draft print access. |
| Void | Dentist opens Issued record, supplies required reason and explicitly confirms `POST /api/prescriptions/{id}/void`. | Reviewed revision, unchanged issued number, incremented revision, reason/actor/time and audit retained. Real Void response lost after commit; same-key Retry recovers one effect. Patient reload shows VOID and newly downloaded PDF is visibly invalid. |
| Correction | Dentist explicitly creates and issues another prescription for the same Visit. | New ID/issued number; original remains immutable Void. No replacement-link field, automatic reissue or new clinical approval rule was invented. |

Established transitions are **Draft → Issued → Void**. Issued → Draft and edits to issued clinical lines remain refused. The source explicitly defines correction as voiding with a reason and issuing a new prescription; same-branch colleague Dentists are permitted. The actual issuer is now correct when a colleague issues a draft. Optional license data comes only from that Dentist's saved value.

A previously downloaded Issued PDF is a static historical document: offline copies cannot be remotely rewritten. Current authorized reads/downloads return Void prominently. There is no invented online verification/signature or replacement-link policy.

## Modules and original QA evidence

Dentist prescription creation, explicit issuance, revision refusal, recovery and authorized Void/new issuance are integrated with persisted encounters. Patient own-prescription readback/PDF, retry, responsive display and void visibility are verified. Staff's established branch print/read scope and Owner's metadata-only boundary are verified; no new clinical authority is granted. Runtime prescription identity and module catalog meanings are unchanged.

Exact original IDs reinforced: **DEN-06, DEN-07, DEN-08** (existing prescription form/medicine/dosage/remove and lifecycle criteria), **GEN-07** (conditional Other/Specify), **GEN-12** (touched controls, responsiveness and accessibility). **GEN-09** receives actual workflow evidence only; broader efficiency benchmarks remain partial. Prior accepted Done labels are retained with stronger integration evidence, not counted as new closures. No invented Patient ID or unsupported total out of the original68 is reported. The master matrix was not reclassified.

Still open: OWN-11/STF-07 full dated roster contract; GEN-06/DEN-03 missing original reproductions; broader GEN-09; archival/privacy/notification policy; clinical handover semantics; four held migration diagnostics; AUD-10 durable/deployed activation gates. Selected-follow-up activation remains closed.

## Database, recovery and test environment

Existing PHP8.3.30/PostgreSQL18.6 and loopback cluster `127.0.0.1:55488` were reused. The protected identity marker verifies the owned cluster and exact demo/test database before operations. Application role remains restricted. The real `dental_clinic`, unrelated5432 and remote databases were not touched. Both active ledgers retain83 entries, with four reviewed holds pending. All original migration hashes and queue history meanings are unchanged.

Before writes: recoverable demo snapshot `dental_clinic_demo-20261115T022308541224Z.dump`. Committed contention and historical atomicity methods run on independently restored, guarded disposable clones; each clone was backed up and stopped. No migration reset/fresh was executed on demo/test or against the held files. Existing completed synthetic Sprint02 encounters/accounts were reused; the historical synthetic branch remains Inactive. No clinic credentials or clinical facts were invented.

The historical Rx01/Rx02 suites normally use destructive DatabaseMigrations. A private provisioning adapter instead restored a fresh verified clone per method and replaced only the reset hook with empty-schema checks; original assertions ran unchanged. Two invalid historical fixtures were corrected: an unfillable optional license setup now actually persists, and a second active Visit is no longer manufactured against the existing unique admission constraint. The old reset-based concurrency method is replaced by the explicit disposable contention lane, not counted as executed.

## Consolidated acceptance results

These are new executions; historical Sprint02 counts are not presented as new runs.

| Gate | New result |
|---|---|
| PHP Unit | **246 passed**, 1,158 assertions;30 existing PHPUnit notices. Database-free clean environment. |
| Guarded PostgreSQL regression | **389 passed**, 4,983 assertions across29 explicit API/workflow files, including auth, visits, clinical, billing, follow-ups and prescriptions. |
| Original Rx01/Rx02 atomicity/revision methods | **21 passed**,297 assertions on fresh prepared clones; all original assertions retained. |
| Real PostgreSQL contention | **10 scenarios passed** in one committed clone test;4,812 observed assertions, including actual lock waiting, same/different keys, stale revision and account/branch revocation. Assertion count includes lock-wait polling. |
| Schema/privilege guards | Preservation1 test/9 assertions; guard1/14; private-runner8 Python tests passed. |
| Held source diagnostics | **7 tests,39 assertions,4 inherited failures**: legacy constraint ordering, command vocabulary compatibility, irreversible mapping and history preservation. No held migration executed. |
| Full frontend Node | **1,818 passed,1 inherited OWN-11 failure,8 skipped,0 TODO** (1,827 total). Failure remains the dated Staff work-schedule assertion in `tests/staffing.test.js:102`. Previous two clinical TODOs are replaced by actual session/context and async dispatch evidence. |
| Actual browser acceptance | Final complete React/Laravel/PostgreSQL journey: all stages above, required conditional Specify values, same-user cross-tab replacement refusal, lost Issue and Void response recovery. Final original `RX-2026-000006` is Void revision4; explicitly corrected `RX-2026-000007` is Issued revision3. Both share the exact persisted Visit/Patient. Earlier successful journeys remain retained. |
| Responsive/accessibility/authorization | **25 groups passed**, Dentist detail/form and Patient at375/430/768/1024/1440, labels, keyboard Escape, preserved input, new session, failed-read Retry, own/foreign/Staff/Owner/anonymous/invalid PDF access. This is scoped browser inspection, not a blanket WCAG certification. |
| Actual PDF parsing | Strict pypdf6.7.5, issued and post-Void downloads: valid A4 documents; exact Patient, branch, clinical issuer, Manila issue date, reference, all populated medicine/dosage/frequency/duration/instructions/note and lifecycle warnings. No invented license/signature. Tool installed in private test venv only. |
| Intercepted browser regressions | CLIN-10:15 groups; CLIN-11 with actual store/StrictMode:25 groups; QA02 identity/Save/Issue/revoked-auth sequence passed. These are separately identified as in-memory API journeys. The CLIN-11 adapter's stale output-marker/file-URL assumptions were fixed without changing behavioral assertions. |
| Smoke/build/predefense/syntax | Smoke17 groups, production build, changed PHP/JS syntax and `git diff --check` passed. `scripts/predefense-check.sh --local-only` passed required checks with3 existing warnings. Build retains large-chunk warning; optional OCR asset warnings remain, and smoke retains the existing Table key warning. No provider calls. |

Direct SQL independently confirmed both final identities/revisions/issuer links, exactly one issue and Void audit effect, unique issued numbers, encrypted clinical command journal and both83-entry ledgers. A final recoverable snapshot is `dental_clinic_demo-20261115T033337069921Z.dump`.

Private evidence root: `/var/folders/r3/d09_14x17h91r2nd70qvhdsc0000gn/T/dentalops-system-sprint03-_48dv8b2`. Key artifacts: `complete-journey/journey.json`, actual `issued.pdf`/`void.pdf`, `PDF_CONTENT_ACCEPTANCE.json`, `PERSISTED_PRESCRIPTION_ACCEPTANCE.json`, `visibility-results.json` and screenshots; `api-file-manifest.txt`, `api-final-context.log`, `php-unit-final.log`, `PREPARED_RX_FINAL_RESULTS.json`, per-method logs, clone backups, contention/regression/build/predefense logs and accepted file hashes. Interrupted test-driver attempts are retained and are not counted as successful journeys. Runtime credentials, cookies, dumps and synthetic clinical exports stay outside Git.

No assertions were weakened to remove the inherited OWN-11 or migration failures. External providers, email delivery, hosting and all-screen accessibility are outside this local acceptance.

## Reproduction and next complete process

See [local full-stack runbook](LOCAL_FULLSTACK_DEVELOPMENT.md) for guarded commands. Browser drivers require the existing synthetic completed encounters and a fresh private evidence directory; they create real demo prescription records, never fixture-only successful states. PDF tooling is private test tooling, not an application dependency.

Next complete business process: **Dentist follow-up task → Staff contact → exact selected appointment → Patient readback and durable recovery**. Preserve the closed AUD-10 activation gate until its own exact linkage, authorization, concurrency and reload/idempotency evidence is accepted. Roster and clinical handover work require their specific unresolved policies first.

## Accepted source manifest

Exactly32 paths, staged explicitly. File SHA-256 values and post-commit parent/reference verification are retained in the private evidence root. Git hooks contain sample files only; no external operation is invoked.

```text
backend/app/Http/Controllers/PrescriptionController.php
backend/app/Http/Resources/UserResource.php
backend/app/Support/PrescriptionSession.php
backend/resources/views/pdf/prescription.blade.php
backend/tests/Feature/Prescriptions/PrescriptionContentionTest.php
backend/tests/Feature/Prescriptions/PrescriptionRecoveryTest.php
backend/tests/Feature/Prescriptions/PrescriptionTest.php
backend/tests/Feature/Prescriptions/Rx01PrescriptionAuditAtomicityTest.php
backend/tests/Feature/Prescriptions/Rx02AcceptedDraftRevisionTest.php
backend/tests/Support/prescription_worker.php
docs/LOCAL_FULLSTACK_DEVELOPMENT.md
docs/LOCAL_PRESCRIPTION_SPRINT03.md
scripts/local-system.py
scripts/tests/test_local_system.py
scripts/verify-prescription-pdf.py
src/App.jsx
src/api-client.js
src/pages/ServerPrescriptions.jsx
src/patient/pages/Prescriptions.jsx
src/prescription-command.js
src/store.jsx
tests/local-prescription-visibility.browser.mjs
tests/local-prescription.browser.mjs
tests/m19-prescriptions.test.js
tests/prescription-command.test.js
tests/prescription-session-api.test.js
tests/yzh-clin-10-prescription-lifecycle.test.js
tests/yzh-clin-10-prescription.browser.mjs
tests/yzh-clin-11-auth-lifecycle.browser.mjs
tests/yzh-clin-11-auth-lifecycle.test.js
tests/yzh-clin-13-prescription-void.test.js
tests/yzh-qa-02-prescription.browser.mjs
```
