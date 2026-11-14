# AUD-10 clinical Follow-ups integration

Date: 2026-11-12, Asia/Manila. Assignment: DENTALOPS-AUD10-CLINICAL-UI-01.
Status: GO for focused independent source re-review after DENTALOPS-AUD10-CLINICAL-UI-FIX-01. The five-file candidate remains uncommitted and deliberately fail-closed. The final correction section records current evidence; earlier execution counts are historical. Operational booking activation, unresolved-form navigation protection and PostgreSQL acceptance remain blocked. This is implementing-session verification, not independent account sign-off.

## Plan recorded before code

A. Current call graph: FollowupRow -> modal -> AppointmentForm ordinary prefills -> appointmentFlow.create -> ordinary adapter. Exact task ID/revision are missing. Revised graph: row validates/captures exact task + revision + Patient + branch -> shared serverFollowupSelection + captured prefills -> shared gate. No attestation is supplied, so the shared form must refuse before submitting. There is no ordinary fallback.

B. Deployment: repository/API route and adapter inspection found no trustworthy runtime selected-contract verification. Source SHA, VITE_API_BASE_URL, matching URL, arbitrary props and synthetic tests cannot prove running capability. Relative API bases resolve against browser origin; equality with an empty string proves neither resolved origin nor deployed revision. No environment secret is read, no compatibility object is manufactured, and no new endpoint is invented. Activation remains blocked pending a separately reviewed runtime/deployment contract.

C. Recovery: shared retry material is component-local. Existing row/filter/page/auth transitions can unmount the form. The shared form has no parent lifecycle/leave-guard callback, only verified onSaved; changing that interface needs scope review. Production selected submission stays disabled. Always-visible Staff recovery guidance survives returning to the page/reload without storing patient details or keys. A bounded authorized patient-followups read can show the exact task's current status/link; missing/stale/inaccessible results do not prove no commit and current linkage is not an original-command receipt. No automatic replacement or browser storage is introduced.

D. Interface: pass serverFollowupSelection={taskId, expectedRevision, patientPublicId, branchId} and captured existing Patient/branch/service/date prefills. Do not pass the legacy followup prop or accept caller-created verifiedFollowupBackend. Reuse shared verified callback; no second booking HTTP path or duplicate retry/proof logic.

E. Scope: only src/pages/ServerFollowups.jsx production changes; supporting Node tests, real-component browser fixture/runner and this document. Shared API/lifecycle, backend/auth/payment/styles/config remain unchanged. Existing patientFollowups read is reused; adding an exact-read API-client export is outside scope and not necessary for this bounded review.

F. Failure model: malformed ULID/revision, terminal/linked task, wrong scope/role and stale row block selection. Unsupported deployments fail closed. Captured identity must not change during modal lifetime. Current reads and verified callbacks require current auth/branch/row ownership. Missing receipt never means successful linkage; incomplete readback never means failure. Lost component state requires front-desk review, not a fresh automatic key.

G. Tests: pure exact-selection/current-state helpers from the production JSX (bundled for Node), actual page + shared form synthetic browser cases across 375/430/768/1024/1440, role/state/context mutation, false attestation injection, zero POSTs, readback mismatch/refusal/absence and focus/overflow. Shared 78 tests and browser harness preserve active retry/proof evidence. Clinical-row active POST/pending/unknown/retry/verified/conflict execution remains BLOCKED by the missing deployment gate, not enabled with fabricated evidence. Fresh baseline/candidate full suite comparison, build and smoke evidence retain inherited issues.

## Git and exact scope

Repository: `https://github.com/ccadaverr/multibranch-dental-clinic.git`.
Registered worktree: `/Users/glesielynalcantara/Documents/dentalops-integrated-review/scratch/integration-abc-20261111/scratch/jaztin-aud10-clinical-ui-20261112`.
Branch: `feature/jaztin-aud10-clinical-ui-20261112`.
Starting/current HEAD: `f4749ddb8ec0a93fe88df9dbf0897579371b9718` (published shared frontend).
Fresh remote UX: `15d626c03c97baf7198a7b7ca6dea2bec8f60836`; backend: `e2654fafb1d30b6e50d3c1e475b2a3c0af227457`; shared frontend: `f4749ddb8ec0a93fe88df9dbf0897579371b9718`.
The clinical branch has no published remote reference. The index is empty. No staging, commit, push, merge, migration, database connection or deployment occurred. Restricted fetch settings and existing branch heads were preserved. The ignored dependency symlink reuses an existing dependency installation with identical package-lock content; no package/configuration changes.

| Path | Purpose |
| --- | --- |
| `src/pages/ServerFollowups.jsx` | Exact frozen selection, distinct shared-form selected interface, closed activation, Staff/branch/eligibility checks, current-context ownership, bounded current-state read, accessible recovery feedback. |
| `tests/aud10-clinical-ui.test.js` | 77 tests importing the actual production helpers through esbuild; strict IDs/revisions, eligibility, roles/scope, observed-status consistency and fixture CSS order. |
| `tests/aud10-clinical-ui.browser.mjs` | Real-component clinical row, Modal, shared form and read transport challenges; no live backend. |
| `tests/fixtures/aud10-clinical-ui.html` | Synthetic authorized reference state and intercepted responses; intentionally forged caller attestation must be ignored. |
| `docs/AUD10_CLINICAL_UI_ACCEPTANCE.md` | Plan, acceptance boundaries, evidence and handoff. |

Only one production file changed. Shared booking lifecycle, adapter, Scheduling, backend, authentication, payments, styles and existing tests remain unchanged.

## Implemented behavior and source challenge

The old row provided only ordinary patient/branch/service/date prefills. The revised row validates a real public task ID and observed integer revision, permits both Open and Contacted only with server `can_book`, refuses an existing appointment, requires current Staff scheduling authority and an Open scoped branch, and captures a frozen task snapshot. ULIDs with LF/CRLF suffixes are rejected. Service IDs retain their existing transitional reference format.

`FollowupRow -> SelectedFollowupBooking -> AppointmentForm(serverFollowupSelection)` carries `{taskId,expectedRevision,patientPublicId,branchId}` and snapshot prefills. It does not pass legacy `followup` or `verifiedFollowupBackend`. Consequently the existing shared gate returns an unavailable notice without a form, availability fetch or appointment POST. Arbitrary claims in caller props/store cannot change this. Ordinary scheduling elsewhere is untouched. The clinical page intentionally stops its prior automatic-match booking path.

The shared implementation still owns command keys, frozen intent, duplicate dispatch, timeout classification, same-command retry and proof validation. Its verified callback provides `{followupLink}`; the clinical callback records only that exact task's verified revision/status in the existing continuity guard, invalidates prior reads and requests a fresh list. Closing invalidates the callback token synchronously. Task/Patient/branch/revision/service/date and actor context key the row lifetime; authentication, permissions and branch changes cannot revive a previous row callback, including permission removal/restoration. No second booking HTTP path or proof verifier was added.

The new current-task action reuses `patientFollowups`, an authorized list capped at 50. It accepts exactly one matching task with matching Patient/branch and a valid non-regressing revision. At unchanged revision, status must match the captured observation. A Booked result requires a valid linked appointment public ID. Accepted newer reads update the existing continuity guard, so older or contradictory later reads cannot downgrade it and a stale row must reload before another command. It copies only status, revision and minimal appointment display data. Missing, duplicate, stale, contradictory, mismatched, forbidden or failed reads display an unresolved message. An Open snapshot does not prove absence of an earlier commit, and a Booked snapshot does not prove the original command's outcome. This read does not clear an unknown booking, generate a key, call booking, announce success or mutate clinical records.

Always-visible Staff guidance explains lost component retry details and discourages replacement booking. No idempotency keys, payloads or patient data are persisted to browser storage. A parent outcome callback/leave guard is absent from the published shared interface; adding one requires separately approved shared-file scope. The current closed path cannot create a new unresolved appointment. This is a bounded limitation, not cross-navigation recovery.

The final read-only implementing-session source challenge checked actual helper boundaries, shared callback serialization, immutable prefills, role/branch gates, stale callback ownership, API shape, closed attestation, absence of fallback and unchanged shared/backend files. It found no remaining blocker for this closed source candidate. It does not authorize activation or substitute for external review.

## Original implementation execution evidence (historical)

These results predate the two corrections. Fresh correction evidence is recorded in the final section; do not reuse the historical counts as current execution.

Evidence directory: `/private/tmp/aud10-clinical-pp5q8tid/`. Outputs are local and temporary; retain/copy them for independent review before cleanup. No live service was contacted by browser fixtures. Vite was bound only to loopback, external browser requests blocked, and all API fetches intercepted.

| Check | Command/method | Result | Evidence |
| --- | --- | --- | --- |
| Focused + shared + Follow-ups lifecycle | `node --test tests/aud10-clinical-ui.test.js tests/aud10-shared-booking.test.js tests/yzh-clin-12-followup-lifecycle.test.js tests/m20-followups.test.js` | 196 passed, zero failed; includes 50 new clinical and 78 shared tests | `targeted-final.tap` |
| Pristine shared-parent full suite | `node --test tests/*.test.js` in the unchanged shared-frontend worktree | 1,389 passed, 17 failed, 8 skipped, 6 TODO; total 1,420 | `baseline-pristine.tap` |
| Final candidate full suite | `node --test tests/*.test.js` | 1,439 passed, 17 failed, 8 skipped, 6 TODO; total 1,470 | `candidate-final.tap` |
| Failure identity comparison | Parse exact TAP failure names | Zero new or resolved failures; same 17 identities | `failure-comparison.json` |
| Clinical browser | `AUD10_FIXTURE_BASE=http://127.0.0.1:5194 AUD10_EVIDENCE_DIR=/private/tmp/aud10-clinical-pp5q8tid/browser-reviewed AUD10_PLAYWRIGHT_MODULE=/private/tmp/staff-p0-fe-01-browser-tools/node_modules/playwright/index.mjs node tests/aud10-clinical-ui.browser.mjs` | 34 passed, zero failed/runtime errors | `browser-reviewed/browser-results.json`, screenshots and log |
| Existing shared-form browser | Same environment, evidence `shared-browser-final`, `node tests/aud10-shared-booking.browser.mjs` | 33 passed, zero failed | `shared-browser-final/browser-results.json` |
| Existing scheduling browser | `node tests/fe-int-p1-scheduling.browser.mjs /private/tmp/staff-p0-fe-01-browser-tools/node_modules/playwright/index.mjs http://127.0.0.1:5194` | 28 passed, zero failed | `scheduling-browser.log` |
| Production build | `npm run build` | Passed; missing OCR language asset and large-bundle warnings retained | `build-final.log` |
| Render smoke | `npm run test:smoke`, candidate and pristine shared parent | Both fail at unchanged HMO assertion, `scripts/render-smoke.mjs:190` | `smoke-final.log`, `smoke-pristine.log` |
| Whitespace, scope, credentials | `git diff --check`; exact inventory and targeted pattern scan; unchanged shared/backend byte checks | Clean whitespace/scope; no credential candidates | `integrity-final.json` |
| Operational predefense | `scripts/predefense-check.sh` inspected only | NOT EXECUTED: invokes `php artisan demo:check`, database/provider operations outside authorization | Source inspection |

Clinical widths: 375, 430, 768, 1024 and 1440; keyboard modal open/close, focus restoration, readable unavailable state and overflow checked at each. Current-state result/error focus and narrow/desktop feedback were exercised. Shared browser tests cover active synthetic pending, unknown, retry, refusal and proof states at those widths. Native screen-reader, physical-device and real session/cookie behavior were not executed; no comprehensive WCAG 2.2 AA conformance claim.

Development diagnostics are preserved rather than hidden: `baseline.tap` began before edits and read changing source, so it is NOT baseline evidence; `baseline-pristine.tap` replaces it. Initial browser fixtures omitted a required reference-data array and supplied invalid same-revision status transitions; corrected fixtures now exercise actual contracts. One shared browser navigation timed out during concurrent build/test load (32 passed, 1 navigation failure); the unchanged suite rerun without contention passed all 33. These early outputs remain in the evidence directory.

Historical implementing/reviewing evidence under `/private/tmp/aud10-fe-shared-hfw73p60/` and `/private/tmp/aud10-fe-independent-7eckjr8_/` was inspected for context. It is not substituted for this session's executions.

## Risk matrix and acceptance boundary

| Risk/scenarios | Observable verification | Boundary |
| --- | --- | --- |
| Exact non-oldest B, same Patient, revision, invalid IDs, legacy separation (1–8) | Actual helper tests plus row/modal snapshot and unavailable selected form | No active clinical POST claimed |
| Open/Contacted, terminal/linked state, non-Staff, branch/permission changes (9–15) | Helper and actual page browser checks, existing Contacted/Close commands preserved | Server authorization remains authoritative |
| Caller attestation, unsupported target, older backend, relative base, drift (16–23) | Forged correctly shaped caller claim ignored; shared gate/proof tests; source API-base inspection | Running compatibility cannot be established; activation BLOCKED |
| Exact command/key/proof, mismatches and refresh failure (24–32) | Existing 78 Node/33 shared-form browser tests; source connects selected interface | Activated clinical-row execution BLOCKED |
| Unknown/network/timeout/refusal after uncertainty/same-key retry (33–40) | Shared lifecycle and browser tests; generic recovery warning persists after remount/reload; bounded read never becomes receipt | Original command cannot be recovered after destruction; no parent leave guard; activation BLOCKED |
| Real row/prefill, permissions/account/branch/unmount (41–49) | Actual page/modal and stale read browser cases, permission-cycle challenge and existing lifecycle suite | Real cookie/server revocation concurrency unverified |
| Feedback, keyboard/focus, widths, ethics, human/automated separation (50–58) | 41 corrected clinical browser cases and screenshot evidence; production CSS order and Modal reused | No full WCAG/native screen-reader/live clinical acceptance |

## UX/backend laws and ethics

Read installed `~/.agents/skills/ux-backend-laws/SKILL.md` and `references/laws.md`; also used `dentalops-production-ui`. The repository-local laws package is absent; none was added.

| Principle | Specific decision | Observable evidence | Limitation |
| --- | --- | --- | --- |
| Postel's Law | Strict fields that matter: exact public IDs/revision/context and same-revision status consistency; preserve ordinary adapter shape and reference formats | 77 production-helper tests and unchanged shared adapters; ordinary shared tests | Security strictness does not establish deployed capability |
| Tesler's Law | Reuse backend clinical authority and existing shared key/proof logic | No booking HTTP path or policy duplicated in the page | Real database transitions still unexecuted |
| Jakob's Law | Reuse existing row actions, Modal, AppointmentForm, Field and focus restoration | Actual page keyboard/viewport checks; Contacted/Close remain functional | Booking intentionally unavailable pending activation |
| Zeigarnik Effect | Unresolved operations stay explicitly unresolved with a bounded review option | Recovery warning persists across return/reload; Open/Booked readback wording never claims original receipt | No durable command/retry recovery |

Ethical review: no invented urgency, clinical policy, fake success, manipulative dismissal, hidden charge, extra authority or browser clinical storage. Unavailability and uncertainty are stated plainly.

## BPA acceptance

| Stage | Responsible actor/automation | Evidence/completion |
| --- | --- | --- |
| Trigger | Authorized Staff chooses one eligible server task | Real non-oldest row action exercised synthetically |
| Inputs/validation | Task ULID/revision and Patient/branch/service/date; local checks and frozen capture | Production helper tests; backend still validates authorization and eligibility |
| Human decision | Staff chooses appointment details and confirms | Shared form exists, clinical confirmation deliberately unavailable |
| Automated operation | Shared transport submits exact command; backend schedules, locks, links, advances revision, records journal/history | Backend/shared source inspected; only shared synthetic execution, not real persistence |
| Exceptions/retries | Shared verified/refused/unknown/obsolete classification; same-key retry while mounted | Shared tests; clinical closed gate and bounded authorized current read |
| Human recovery | Keep original form open; if lost, review current state with branch team before any replacement | Guidance and current-read tests; no original receipt reconstructed |
| State/completion | Only matching authoritative linkage proof allows exact task Booked feedback | Existing shared proof verifier and callback reused; clinical live completion BLOCKED |
| Audit/monitoring | Existing backend command journal, task history and appointment records | No frontend authoritative clinical log invented; persisted audit acceptance pending |

Useful future operational measurements: unknown/refused/verified command counts, unresolved-operation age, same-key retry/replay rate, proof mismatch rate, and task-to-appointment discrepancy counts. No telemetry or clinical-data collection was added here. Staff remains responsible for clinical task selection and manual reconciliation; no clinical decision is automated.

## Outstanding acceptance and next action

- Running deployment verification: BLOCKED. Source compatibility, a configured URL/version, running capability and per-operation proof are different evidence. Empty/relative bases and same-URL rollback remain unsafe grounds for activation. A separately reviewed trustworthy server/deployment gate is required; no endpoint invented.
- Unresolved navigation/destruction: PARTIAL. Warning and bounded current read implemented; no durable retry/replay or parent lifecycle guard. Any activation must separately review the shared interface/leave guard and recovery procedure before enabling submissions.
- PostgreSQL: 25 workflow cases and five contention scenarios remain UNEXECUTED. No persisted linkage, rollback, exclusion-constraint or concurrency claim.
- Live authentication/session revocation, refund external atomicity, broader clinical/financial acceptance and full-stack integration remain outside this frontend candidate.
- The same 17 inherited frontend failures, HMO render smoke failure, missing OCR asset and bundle warning remain.

Done: isolated correct-parent worktree, scoped closed integration, strict exact selection, bounded manual review, safe synthetic tests, build, source challenge and integrity evidence. In progress: none in this implementation run. Remaining: external independent source review, separately authorized commit/publication, trustworthy activation/recovery contract, combined integration and database acceptance. Next action: independent review of this deliberately closed candidate; do not activate or publish automatically.

## Final source corrections — DENTALOPS-AUD10-CLINICAL-UI-FIX-01

2026-11-12, Asia/Manila. **GO for focused independent source re-review only.** No staging, commit, push, merge, deployment or operational activation is included.

### Verified checkpoint and original findings

The existing registered worktree and branch remain `scratch/jaztin-aud10-clinical-ui-20261112` / `feature/jaztin-aud10-clinical-ui-20261112`, with HEAD unchanged at `f4749ddb8ec0a93fe88df9dbf0897579371b9718`. Before editing, all five candidate hashes matched the independent review in `/private/tmp/clinical-qa-resume-_i53s2v4/integrity-final.json`. The index was empty; the inventory was exactly one modified production file plus four untracked supporting files. No new branch or dependency was needed.

P2 reproduced before correction: an observed Open task B at revision 7 accepted a current-state response of Booked at revision 7 with a valid appointment ID. The helper returned that relationship; the independently reviewed browser had displayed it as current state, without a booking POST or success toast. Fresh pre-fix source reproduction is retained as `before-reproduction.json`.

P3 was verified against `src/main.jsx`: the fixture loaded only styles/foundation/polish, omitting production's Follow-ups stylesheet and the intervening production CSS imports.

### P2 rule and implementation

Actual R2 source at `e2654fafb1d30b6e50d3c1e475b2a3c0af227457` increments revision in selected/ordinary booking and reopening; the existing FollowupController increments it for Contacted and Closed mutations. Therefore a changed status at an unchanged revision contradicts the observed snapshot. No generalized clinical transition policy was added: a later current read may span intervening operations, and it remains distinct from a command receipt.

`reviewCurrent` now captures an immutable private read context containing exact task/Patient/branch identity, observed revision and `observedStatus`. `currentFollowupReview()` requires that observed status, keeps the existing identity/type/link checks and refuses stale revisions or changed status at equal revision. Valid unchanged snapshots and supported newer states remain readable. The server-selected booking tuple remains the original four fields; `observedStatus` is not sent as a booking payload field.

The existing `pendingTasks.verified` continuity guard supplies any newer accepted snapshot at dispatch and again before adopting the response. A valid read advances that guard monotonically through the existing `rememberFollowup()` function. Repeated stale reads and a newer snapshot arriving during a pending read cannot downgrade it. A later stale list reload is also refused by the existing list guard. No new state system or persistence was added. A row older than an accepted current read uses the existing changed/reload warning and disabled command controls; it is not silently rebased.

Contradictions use the existing focused unverified alert: “The current task could not be verified from this authorized list.” The existing Review action can retry, and the existing changed-row action can reload. No contradictory Booked relationship is displayed, no success toast appears and no booking POST is created or repeated. Read evidence does not settle an unknown booking, change its idempotency key, mutate its frozen intent or become an original-command receipt. Only the unchanged shared authoritative `meta.followup_link` verifier can establish selected-booking success.

### P3 production stylesheet parity

The fixture now imports the exact production sequence from `src/main.jsx`:

`styles.css` → `foundation.css` → `patient.css` → `public-site.css` → `polish.css` → `patient/portal.css` → `landing.css` → `automations.css`.

No production CSS changed. A source regression compares the complete import order. At all five widths the browser verifies that automations.css was requested and the Follow-ups list computes to grid / list-style none. Closed booking controls, modal focus/close, unverified feedback focus/visibility and horizontal overflow are checked with those styles loaded. The fixture still mounts the real production page, Modal and shared form; it does not run `main.jsx`, branding initialization, Laravel or provider calls.

### Fresh regression and challenge evidence

Temporary evidence root: `/private/tmp/aud10-clinical-fix-su99zv8z/`. All inputs are synthetic. Node environment is sanitized, esbuild uses write:false, and the temporary Vite server uses configFile:false with envDir/cacheDir outside source on loopback port 5198. Browser API calls are intercepted and external page requests blocked. No npm predev/prebuild lifecycle script was invoked.

| Fresh check | Actual result | Evidence |
| --- | --- | --- |
| Expanded helper/CSS regressions against unchanged old candidate | **61 passed / 16 failed**, 77 total; includes P2 contradiction, observation completeness, repeated snapshots and missing CSS order | `regression-red.tap` |
| Corrected clinical + shared + Follow-ups lifecycle suites | **223 passed**, zero failed/skipped; includes 77 clinical and 78 shared tests | `focused-green.tap` |
| Corrected clinical browser | **41 passed**, zero failed/runtime errors; five styled viewports | `clinical-browser-final/browser-results.json` |
| Published shared-form browser | **33 passed**, zero failed | `shared-browser/browser-results.json` |
| Ordinary scheduling browser | **28 passed**, zero failed | `ordinary-browser.log` |
| Additional actual-component browser checks | Frozen four-field booking selection unchanged after contradiction; newer read disables stale row without POST/success | `ordinary-browser.json` |
| Additional implementing-session source challenge | **51 checks passed**; not external independent acceptance | `final-source-challenge.json` |
| Broader relevant ordinary Node subset | **39 passed / 1 inherited failure**, identical to freshly executed published shared-parent baseline | `ordinary-regressions.tap`, `ordinary-baseline.tap`, `ordinary-failure-comparison.json` |

The inherited failure is `the follow-up screen (M20, clinic server) offers booking to the front desk only`, in `tests/m6-hardening.test.js:77`. Its unchanged regex expects historical `setBooking(true)` markup and fails on the published shared parent as well. No new failure identity was introduced in that subset; the unrelated test was not changed. Historical full-suite counts, HMO smoke failures and OCR/build warnings were not rerun or presented as new execution.

Commands executed from this worktree unless the baseline is explicitly identified:

```bash
env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node --test tests/aud10-clinical-ui.test.js
env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node --test tests/aud10-clinical-ui.test.js tests/aud10-shared-booking.test.js tests/yzh-clin-12-followup-lifecycle.test.js tests/m20-followups.test.js
env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node --test tests/fe-int-p1-scheduling.test.js tests/m6-hardening.test.js tests/m6-cutover.test.js
env -i PATH=/usr/local/bin:/usr/bin:/bin AUD10_FIXTURE_BASE=http://127.0.0.1:5198 AUD10_EVIDENCE_DIR=/private/tmp/aud10-clinical-fix-su99zv8z/clinical-browser-final AUD10_PLAYWRIGHT_MODULE=/private/tmp/staff-p0-fe-01-browser-tools/node_modules/playwright/index.mjs /usr/local/bin/node tests/aud10-clinical-ui.browser.mjs
env -i PATH=/usr/local/bin:/usr/bin:/bin AUD10_FIXTURE_BASE=http://127.0.0.1:5198 AUD10_EVIDENCE_DIR=/private/tmp/aud10-clinical-fix-su99zv8z/shared-browser AUD10_PLAYWRIGHT_MODULE=/private/tmp/staff-p0-fe-01-browser-tools/node_modules/playwright/index.mjs /usr/local/bin/node tests/aud10-shared-booking.browser.mjs
env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node /private/tmp/aud10-clinical-fix-su99zv8z/ordinary-browser.mjs "$PWD"
env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node /private/tmp/aud10-clinical-fix-su99zv8z/final-source-challenge.mjs "$PWD"
```

The broader ordinary subset was also freshly executed read-only in `scratch/jaztin-aud10-shared-booking-20261112` at the published parent for exact failure comparison. It wrote only redirected evidence outside that worktree.

Coverage includes the original Open 7 → Booked 7 refusal; all equal-revision status comparisons; unchanged snapshots; actual Contacted/Booked/Closed/reopened progression; stale/unknown/partial/mismatched responses; Staff/permission/scope guards; duplicate reads; sequential regression attempts; newer continuity evidence during a pending read; stale filter reload; frozen selection preservation; no booking POST or success attribution; and the original shared command/key/proof cases. All viewport checks use 375, 430, 768, 1024 and 1440 pixels. Screenshot evidence includes closed gate and unverified read feedback at each width. These fixtures do not prove real server sessions, PostgreSQL behavior, screen-reader conformance or physical-device acceptance.

### Source QA established and remaining limitations

P2 and P3 now have targeted red/green regressions and current browser evidence. Shared booking source at `f4749d...`, backend source, API payloads, key handling, proof matching, role/branch/Patient guards and ordinary booking behavior remain unchanged. Selected booking stays closed with no trusted running-backend capability; caller claims do not activate it. The correction adds no command, endpoint, approval authority or clinical policy.

Unmount/reload recovery remains incomplete: component-local command/key material is not durable, and current task state is not its receipt. The existing warning and closed submission gate remain. The 25 workflow cases and five contention scenarios, persisted linkage/audit/rollback, live authorization and PostgreSQL acceptance were not executed. Queue migration and all database holds remain active. No database, Laravel, Docker, migration, seeder, worker, provider, provisioning or deployment operation occurred.

General/Member QA is not globally complete. This advances only AUD-10 current-read consistency and fixture rendering evidence. GEN-06's original dropdown reproduction, GEN-09's efficiency measurement and DEN-03's original schedule report remain unresolved; other member workflows, deployment and clinical runtime acceptance retain their separate evidence requirements. No QA tracker or product module status was promoted.

DONE: correct isolated checkpoint, both original findings reproduced, narrow source correction, targeted regressions, actual browser/viewport checks and implementing-session challenge. IN PROGRESS: none after handoff. REMAINING: focused independent acceptance, then a separately authorized local-only commit if accepted. OPEN: trusted activation, durable unknown-outcome recovery, PostgreSQL/contention acceptance and General/Member QA gaps. Remote publication remains held until Vercel/Railway triggers are verified; no deployment settings were inspected or changed in this correction.
