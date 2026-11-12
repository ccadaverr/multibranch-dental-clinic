# AUD-10 shared selected-follow-up booking — frontend candidate

Date: 2026-11-12, Asia/Manila. Assignment: DENTALOPS-AUD10-FE-SHARED-01.
Status: CONDITIONAL — implemented uncommitted frontend candidate; ready for separate independent source review after recorded checks. No full-stack acceptance.

## Verified checkpoint

Frontend starts at UX baseline `15d626c03c97baf7198a7b7ca6dea2bec8f60836` on isolated branch `feature/jaztin-aud10-shared-booking-20261112`. Fresh remote backend reference: `e2654fafb1d30b6e50d3c1e475b2a3c0af227457`. Backend source is read-only; it is not merged here. Existing worktrees and their prior Playwright logs are preserved.

## Plan recorded before implementation

A. Current flow: AppointmentForm -> appointmentFlow.create -> appointments-api.createAppointment -> api-client cookie/CSRF POST -> Laravel -> adapter -> projection refresh -> form feedback. ServerFollowups supplies ordinary prefills only; the shared form/request builder lacks explicit task/revision transport. commandResult discards top-level meta. Form edits regenerate keys; the ordinary flow awaits refresh after creation and can throw after the create succeeded.

B. Proposed selected state: idle draft; submitting frozen task/revision/appointment intent/key; verified receipt; definite initial refusal; unknown outcome; obsolete completion. The mounted form owns one command. Unknown outcomes retain the command and lock conflicting edits. A deliberate retry sends the identical key/payload. After any unknown outcome, a later refusal cannot establish that the original create never committed. No new command or ordinary fallback is automatic. Known initial refusals permit only an explicit review step where supported; task conflicts require reloading/reselecting the task. No storage persistence is introduced.

C. Compatibility: retain createAppointment and appointmentFlow.create return shapes and ordinary Staff/Owner, Patient/dependent, calendar, Patient-record prefill, payment and legacy local-followup behavior. Add a distinct selected API method and flow command factory. Reschedule/cancel remain unchanged. api-client is read-only.

D. Files: src/appointment-flow.js owns the selected command lifecycle and recovery; src/appointments-api.js owns narrow serialization, strict identity/key checks and metadata access; src/pages/Scheduling.jsx accepts distinct serverFollowupSelection and verifiedFollowupBackend props and renders protected retry/refusal states. Supporting additions: focused Node tests, synthetic fixture/browser cases and this document. No other production file is authorized.

E. Risks: duplicate committed creation, wrong-task substitution, false success/failure, obsolete auth/branch adoption, adapter-shape regression, ordinary/payment regression and accessible recovery. The selected path defaults closed: no capability endpoint exists. An integration owner must explicitly attest the reviewed R2 commit and exact API base before enabling it; this is deployment evidence supplied by the caller, not runtime server discovery. Older/unknown targets must remain disabled.

F. Tests: frozen same-key retry and dispatch latch; invalid selection/key/attestation with zero POSTs; exact-task/proof and context mismatches; missing-proof old-server responses; refusal after uncertainty; refresh failure after valid receipt; stale/unmounted/auth/branch ownership; ordinary request/result shapes including payment/dependents; synthetic real-form/flow/transport browser scenarios at 375/430/768/1024/1440. Capture a fresh full-suite baseline before editing, compare exact final failing identities, run smoke/build. Database tests, migrations, live API and predefense Artisan checks are excluded.

## Evidence and acceptance

Evidence directory: `/private/tmp/aud10-fe-shared-hfw73p60`. These are machine-local artifacts; no real patient data is used.

| Check | Executed result | Evidence |
| --- | --- | --- |
| Fresh unmodified frontend baseline | 1,311 pass / 17 fail / 8 skipped / 6 TODO; 1,342 total | baseline-tests.tap |
| Focused adversarial Node cases | 78 passed, zero failures/skips/TODO | focused-tests.tap |
| Impacted existing plus focused cases (earlier focused count 74) | 142 passed / 1 inherited failed, 143 total | impacted-tests.tap |
| Final full frontend suite | 1,389 pass / same 17 fail / 8 skipped / 6 TODO; 1,420 total | final-tests.tap |
| Exact baseline failure comparison | No new failures; none of the inherited failures claimed fixed | test-failure-comparison.json |
| Existing scheduling browser cases | 28 passed, including reschedule, cancel/no-show, ordinary lifecycle/keyboard and five-width checks | existing-scheduling-browser.log |
| Selected shared-form browser cases | 33 passed / zero failed; synthetic only | browser-results.json, browser-run.log |
| Production build | Passed; OCR English asset missing and bundle-size warnings retained | build.log |
| Render smoke | Failed at scripts/render-smoke.mjs:190, HMO Record Provider Response assertion; independently reproduced at unchanged UX baseline | smoke.log, baseline-smoke.log |
| PostgreSQL / live backend / full-stack clinical entry point | NOT EXECUTED | Outside this assignment |
| Predefense script | NOT EXECUTED: launches Artisan demo:check and database/provider checks | Source inspected only |

Commands: `node --test tests/aud10-shared-booking.test.js`; full suite `node --test --test-reporter=tap tests/*.test.js`; `npm run test:smoke`; `npm run build`. Existing browser: `node tests/fe-int-p1-scheduling.browser.mjs /private/tmp/staff-p0-fe-01-browser-tools/node_modules/playwright/index.mjs http://127.0.0.1:5193`. Selected browser: `AUD10_PLAYWRIGHT_MODULE=file:///private/tmp/staff-p0-fe-01-browser-tools/node_modules/playwright/index.mjs AUD10_EVIDENCE_DIR=/private/tmp/aud10-fe-shared-hfw73p60 node tests/aud10-shared-booking.browser.mjs`. Vite served the isolated frontend on 127.0.0.1:5193; fixture fetches are intercepted, and external browser requests are blocked. Existing shared dependencies were used through an ignored node_modules symlink; package-lock.json matched, and no dependency was installed or updated.

## Revised interface and integration handoff

The future clinical UI supplies the following distinct props (values must come from exact authorized server task readback and verified release evidence):

```jsx
<AppointmentForm
  role="staff"
  store={store}
  serverFollowupSelection={{
    taskId: task.id,
    expectedRevision: task.revision,
    patientPublicId: task.patient.id,
    branchId: task.branch.id,
  }}
  verifiedFollowupBackend={verifiedDeployment}
  prefill={{ patientPublicId: task.patient.id, branchId: task.branch.id,
    patientName: task.patient.name, serviceId: task.service?.id, date: task.due_on }}
  onSaved={(appointment, { followupLink }) => { /* current-context verified completion */ }}
/>
```

`verifiedDeployment` must identify `{ commit: SELECTED_FOLLOWUP_BACKEND_COMMIT, apiBase: apiBase() }` only after an integration/release owner verifies that exact target serves the R2 contract. The constant is exported from appointments-api.js and pins `e2654fafb1d30b6e50d3c1e475b2a3c0af227457`. This record is caller-supplied release attestation, NOT runtime backend capability discovery or security. No capability endpoint exists; a GET of an ordinary task cannot prove selected POST support. Do not fabricate this record in ServerFollowups, set it merely because a branch exists on GitHub, or enable the path against the UX baseline backend. Runtime attestation/rollout verification remains an integration gate. No current production entry point supplies these props in this assignment.

Revised call graph: explicit shared-form selection -> beginSelectedFollowup -> frozen command and request-owner guard -> createSelectedFollowupAppointment -> unchanged api-client cookie/CSRF POST -> detailed row/meta -> exact receipt validation -> bounded list refresh -> current-context callback. The ordinary createAppointment adapter still returns `{ok:true,row}`. The legacy `followup`/followupId bridge remains distinct. Calendar, Patient record, Owner and Patient/dependent/payment callers remain on their existing path. Only the selected response gains metadata access; no global return-shape migration occurs.

R2 source inspection establishes exactly one revision increment, so accepted proof revision is captured expectedRevision + 1, within the backend integer range. Proof must identify the exact task and appointment and Booked status. Patient, branch, service, date/time and any explicitly selected Dentist must match the captured appointment intent. A later task GET is not substituted for the original journal receipt.

## Lifecycle and hard-risk boundaries

- Idle draft: fields editable; selected Patient/branch locked. Malformed explicit selection (including null) cannot fall through to ordinary booking.
- Submitting: one synchronous dispatch latch plus current actor/request ownership; immutable primitive booking fields, selection, key and target record. There is no automatic booking retry except the pre-existing same-request CSRF retry in the unchanged transport.
- Unknown: network/server failure, unreadable/missing/wrong proof or a 30-second response timeout. This timeout is a client waiting bound, not a reservation expiry or server cancellation. Form edits are locked; only deliberate same-key/same-intent retry is available. Late responses after timeout cannot override a later retry.
- Refused: only an understood initial refusal. Scheduling validation/race or rate-limit refusal permits an explicit Review booking details step before a new intent/key. Task conflict, inaccessible context, authorization and key-reuse errors require closing and reviewing/reselecting the task; no revision rebasing occurs.
- A refusal after ANY unknown result remains unknown: revoked replay authority does not establish that the original command never committed.
- Verified: exact receipt accepted before refresh. Failed/timed-out list refresh returns verified creation with a warning and authoritative row fallback; it cannot lead to replacement creation. No browser-local follow-up mutation or fake clinical audit is written.
- Obsolete: account/auth lifetime, permissions, branch/context, selection/remount or unmount invalidates adoption. Checks occur before dispatch and after awaits. Frontend ownership cannot atomically revoke cookie/server authority during an already-started transport/CSRF exchange, cancel a server commit or replace backend authorization.

Recovery exists only for the mounted form's lifetime. Closing/remounting/reloading/auth replacement loses the in-memory key and draft. The UI warns against starting another booking before front-desk review; cross-reload lost-key recovery is NOT implemented. No patient details, notes, session material or idempotency key is added to localStorage/sessionStorage. Safe resolution after lost ownership requires an authorized clinical/integration recovery procedure; a task GET alone is not claimed as a receipt.

## Adversarial regression coverage

| Requested matrix items | Deterministic evidence |
| --- | --- |
| 1–7: exact non-oldest B, same Patient, no inference, incomplete selection, legacy distinction, ordinary omission | Exact adapter/transport tests, invalid-selection zero-command cases, legacy flow test; fixture includes older A and selected B |
| 8–16: receipt identity/state/revision/context, old-server response, failed refresh | 17 receipt mutation cases, correct receipt/selected Dentist cases, missing-proof browser case, refresh-failure Node/browser cases |
| 17–25: repeated submit, timeout, frozen retry, locked edits, no fallback, stale/repeated completion | Synchronous command latch, same-tick real-form click/submit, keyboard retry, timeout/late-response tests, frozen payload/key comparisons, settled-command guard |
| 26–30: auth/branch/unmount, cookie/CSRF and privacy | Ownership mutation Node/browser matrix, current-generation callback, real transport credentials/header assertions, no browser-storage changes |
| 31–36: 404/409/422/auth/key reuse and deliberate recovery | Refusal matrix, refusal-after-unknown cases, protected draft and explicit Review booking details browser cases |
| 37–44: ordinary/Owner/Patient/dependent/calendar/record/legacy/payment/result shape/refresh | Real ordinary adapter payload/result tests, synthetic shared ordinary/Owner/calendar forms, existing scheduling browser cases and unchanged full-suite failure identities |

Browser evidence covers 375, 430, 768, 1024 and 1440 pixels: pending/unknown/refused/verified states, disabled draft, keyboard retry and focus on feedback, no page overflow, and screenshot captures. Native screen reader, physical device, live cookie/session and live backend behavior are NOT accepted by these synthetic checks. Existing global styling is unchanged.

## Read-only challenge pass and findings

A separate source-review pass by the implementing agent challenged ownership checks, late response/retry adoption, receipt serialization, initial versus post-unknown refusal, refresh failure, caller compatibility and the default-closed gate. This is review preparation, not a separate person's independent sign-off. A same-tick pre-dispatch ownership gap was corrected and receives a zero-transmission regression. A legacy source-pattern test exposed changed lock-expression spelling; the existing ordinary expression was retained and selected-mode locking applied additively without weakening the test. The added Owner browser fixture initially omitted the required all permission; only synthetic fixture authority was corrected, with no production authorization change.

| Issue | Applicable law or requirement | Evidence | Impact | Correction | Verification status |
| --- | --- | --- | --- | --- | --- |
| Selected identity lost | Clinical identity/API compatibility | Existing prefills and ordinary request builder | Wrong eligible task may be automatically linked | Separate server selection and exact selected adapter | Source + synthetic Node/browser |
| Response metadata discarded | Postel; stable response contract | Existing commandResult drops meta | No authoritative linkage verification | Narrow detailed selected adapter; ordinary result unchanged | Source + synthetic Node/browser |
| Uncertainty permits conflicting intent/key changes | Transaction intent; recovery accuracy | Existing form regenerates key on edits | Duplicate creation or changed-intent retry | Frozen selected command, protected draft and same-key retry | Source + synthetic Node/browser |
| Refresh failure after valid creation | Accurate completion feedback | Existing ordinary flow awaits refresh | Successful create can look failed | Selected receipt verified before bounded refresh; warning fallback | Source + synthetic Node/browser; ordinary path intentionally preserved |
| Older backend may ignore fields | API compatibility/release integrity | No capability endpoint in reviewed contract | Unintended ordinary creation | Default-closed explicit verified-target gate | Negative synthetic cases; real deployment attestation remains pending |

## UX/backend principles and ethics

Postel: ordinary payload/result compatibility is retained, while selection/key/proof fields are validated strictly; real adapter tests verify both. Tesler: clinical authorization, task eligibility, transaction and replay remain server-owned; the frontend transports identity and verifies a receipt without local clinical mutations. Jakob: reuse the existing AppointmentForm, fields and scheduling patterns; existing 28 scheduling browser cases remain operative. Zeigarnik: an unresolved result stays visibly unresolved with a deliberate same-booking continuation; five-width keyboard/focus/locked-draft evidence demonstrates it. No fabricated urgency, invented clinic policy, hidden charge, manipulative confirmation or fake success is introduced.

## BPA evidence and completion boundaries

Trigger/actor: authorized Staff deliberately confirms an explicitly selected follow-up. Inputs: appointment draft, exact public task ID, observed revision, stable key and verified target attestation. Frontend checks shape/context; server owns authority, eligibility, availability and transaction validation. Automated shared-form action submits exact identity, then separates verified receipt, definite refusal and unknown outcome. Human action confirms the initial command, deliberately retries unchanged uncertainty or reviews a known refusal. Backend command journal, task transition, appointment history and sanitized audit are the authoritative evidence; no frontend audit is fabricated. Completion requires a matching receipt and current UI ownership. Suggested pilot measurements (not measured here): selected success/refusal/unverified/replay counts, duplicate dispatches (zero expected per active attempt), recovery time and refresh failure rate.

Shared module status qualification: Appointment Management / Follow-Up Management retain historical module classifications. This candidate adds tested shared frontend infrastructure only; clinical entry point, combined deployment and persisted database acceptance remain incomplete. Do not promote full BPA workflow status.

## Remaining gates and next assignment

No source-file scope expansion was required. ServerFollowups, shared api-client, authentication, backend, migrations, payments, dependencies and styling are unchanged. Existing 17 test failures and HMO smoke failure remain open. Build retains OCR/bundle warnings. Backend 25 PostgreSQL workflow cases and five contention scenarios remain UNEXECUTED; concurrent authorization revocation, legacy move-up locking and refund external atomicity remain open. No full-stack clinical acceptance, native screen-reader acceptance or cross-reload recovery is claimed.

Next: DENTALOPS-AUD10-CLINICAL-UI-01, from a freshly verified combined integration checkpoint, to wire ServerFollowups to this explicit shared interface and verified release gate. No commit, push or merge is authorized or performed here.

Final integrity: three modified production files and four new supporting files, empty staging index, HEAD unchanged at the UX baseline. All existing local branch refs and restricted fetch configuration match the preimplementation snapshot; the published backend worktree remains clean at its reviewed commit. Credential/conflict-marker pattern scan and git diff --check passed. Exact hashes are in the machine-local candidate-integrity.json.
