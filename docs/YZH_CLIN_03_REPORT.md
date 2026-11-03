# YZH-CLIN-03 - Odontogram identity and recording safety

2026-11-03, Asia/Manila. Developer B / Yzhekiel. Bounded frontend implementation; no commit or authenticated acceptance.

## A. Repository isolation

Original QA workspace: `C:/Users/Yzhe Yu/Documents/dental-clinic-b-qa-20261102`, branch `qa/yzhekiel-ui-20261102`, HEAD `e708be43af685a31d7cee2ce651981f7e2a900ae`. Its tracked tree and index were clean; all 63 excluded untracked files were present with their reviewed hashes. Proposed folder and feature branch did not exist. The baseline commit was available locally.

Created only the requested worktree:
`C:/Users/Yzhe Yu/Documents/dental-clinic-odontogram-identity-20261103`,
branch `feature/yzhekiel-odontogram-identity-20261103`,
HEAD `a6a0de5bf36c77a43d948b98f821940bac41df3d`.
The new tree and index were clean before adding tests. QA-02's local commit was not used as the base or cherry-picked. No Developer A workspace was accessed.

Dependencies are reused through a new, ignored node_modules junction to the existing QA installation. No package installation, manifest or lockfile change occurred. Vite servers use configFile:false and Windows Temp caches. Build used the runner config loader; OCR assets/dist are ignored outputs in this worktree. No cache was intentionally written through the junction into QA-02.

## B. Source investigation and confirmed defects

Reviewed Odontogram, ToothTimeline, SurfaceDiagram, ChartSummary, DentalChart, Patient Teeth, API client helpers, M10 unit/motion tests and existing clinical fixtures.

### H1 - Confirmed P1: tooth draft leakage and unprotected discard

Baseline Odontogram keeps one ToothTimeline mounted while changing its tooth prop. Its useState initializer is not rerun. Select 18, choose Caries, branch 2, surface M, date 2020-01-02 and note "Synthetic A note", then select 17. The new tooth visibly inherits the clinical form, including the note; no confirmation appears. The baseline payload builder would combine the newly displayed tooth with that retained form. This is a wrong-tooth documentation risk, not a demonstrated backend authorization defect.

Back to all findings unmounts the editor without protecting unsaved work. Change patient likewise drops unfinished work without confirmation. A dentition change can hide tooth 18 on the canvas while leaving its editable detail open. A primary-tooth summary chip can open a primary detail while retaining the adult canvas.

Expected: no inherited form under a new tooth, no silent loss of unfinished work, and an editable selection visible in the current dentition.

### H2 - Confirmed P1: late tooth completion owns another editor

Hold POST for pA/tooth 18; switch to 17 and type B's fields. Baseline success performs an unconditional form reset and parent success toast; failure puts "Synthetic A refused" in the active editor. Returning 18 -> 17 -> 18 does not invalidate the old completion. The request itself retains its original patient/tooth/payload; the defect is completion ownership.

Same-tick duplicate native form submissions already result in only one network POST because ChartRecord has a synchronous lock. However, the second form submission consumes the "already in progress" response and prematurely releases the first editor's loading state. This was reproduced separately.

### H3 - Confirmed P2: unexpected rejection strands the chart lock

ChartRecord sets recording.current=true and clears it only after a fulfilled await. A recording API promise that unexpectedly rejects bypasses that clear. ToothTimeline catches it and enables its own button, but subsequent authorized attempts are refused by the still-locked parent.

The regression injects a rejected recordChartEntry promise at the frontend module boundary while retaining the actual ChartRecord/ToothTimeline implementation. This is deliberately an unexpected-exception test. Ordinary fetch network abortion is normalized by the existing API client and already recovered on the baseline; it was not falsely classified as an always-locking network bug.

### Already-correct baseline controls

Patient A's late success/failure after using Change patient to select B was already suppressed by ChartView's patient/session key and mount guard. Normal current-editor Save, read-only Staff/Patient, view-only draft continuity, clean selection, and geometry invariance also passed. Those safeguards were retained.

## C. Test-first reproduction evidence

Only synthetic tests/fixtures were added before production edits. First matrix on untouched baseline production: 7 passed / 12 failed at 390px. An expanded, final replay serves the three production modules directly from the immutable a6a0de5 Git objects through Vite: **10 passed / 13 failed at 390px**. Corrected working source: **92 passed / 0 failed** (23 cases x 390/768/1024/1440).

| Deterministic case | Baseline | Corrected |
| --- | --- | --- |
| `clean-navigation` | PASS | PASS at all four widths |
| `reverted-clean` | PASS | PASS at all four widths |
| `keyboard-selection` | FAIL | PASS at all four widths |
| `motion-invariance` | PASS | PASS at all four widths |
| `unsaved-fields` | FAIL | PASS at all four widths |
| `unsaved-isolation` | FAIL | PASS at all four widths |
| `save-success` | FAIL | PASS at all four widths |
| `save-failure` | FAIL | PASS at all four widths |
| `rapid-success` | FAIL | PASS at all four widths |
| `rapid-failure` | FAIL | PASS at all four widths |
| `patient-success` | PASS | PASS at all four widths |
| `patient-failure` | PASS | PASS at all four widths |
| `duplicate-submit` | FAIL | PASS at all four widths |
| `network-retry` | PASS | PASS at all four widths |
| `thrown-retry` | FAIL | PASS at all four widths |
| `view-continuity` | PASS | PASS at all four widths |
| `dentition-isolation` | FAIL | PASS at all four widths |
| `summary-dentition` | FAIL | PASS at all four widths |
| `staff-read-only` | PASS | PASS at all four widths |
| `patient-read-only` | PASS | PASS at all four widths |
| `back-pending-success` | FAIL | PASS at all four widths |
| `active-save` | PASS | PASS at all four widths |
| `patient-unsaved` | FAIL | PASS at all four widths |

The eight requested scenarios are represented by: unsaved-fields/isolation; save-success; save-failure; rapid-success/failure; patient-success/failure/unsaved; duplicate-submit/network-retry/thrown-retry/active-save; keyboard-selection/view-continuity/dentition-isolation/summary-dentition/motion-invariance; Staff/Patient read-only.

All reads and writes are intercepted. Each case uses a fresh browser context. Deferred mutation responses are explicitly released; request completion and browser frames are awaited. Race ordering uses no arbitrary sleep. The existing geometry helper has its original short rendering waits and is not used as mutation timing evidence.

Original captured request:
```json
{"patient":"pA","body":{"tooth":"18","status":"Caries","surfaces":["M"],"note":"Synthetic A note","recorded_on":"2020-01-02","branch_id":2}}
```

Tests verify B's complete visible draft, absence of A feedback/toast, selected tooth, original payload, enabled retry after completion and B's subsequent explicit Save with its own patient/tooth/body. A successful old tooth request must visibly change tooth 18 from Healthy to Caries while its patient remains active; suppressing authoritative data updates cannot make that assertion pass. Patient changes must instead isolate the new chart. Pointer, Enter, Space, safe default dialog focus and Stay focus restoration are covered.

No test assertion was removed or weakened. Existing M10 tests remain unchanged; their old source-pattern "fresh tooth" assertion alone had not proved lifecycle isolation.

## D. Implemented corrections and exact scope

- `src/components/odontogram/Odontogram.jsx`: all pointer/keyboard/summary/back/dentition selection paths use one selection boundary. Dirty changes require the existing accessible ConfirmDialog, with Stay first and explicit discard. A synchronous monotonic generation invalidates old ownership, including rapid return. ToothTimeline is keyed by tooth and selection lifetime. Dentition changes clear the selected detail; summary selection adopts the tooth's dentition.
- `src/components/odontogram/ToothTimeline.jsx`: synchronous form snapshots/dirty reporting protect every existing clinical field. Branch comparison normalizes number/string representation so fully reverted forms are clean. A synchronous submission latch protects same-tick submits. Payload captures its original tooth and cloned surfaces. Mount, selection lifetime and edit revision guard completion effects. Finally releases local state safely. Same-tooth edits made during a request are not cleared by the earlier result. Existing form defaults and status catalogs remain unchanged.
- `src/pages/DentalChart.jsx`: patient-bound authoritative chart updates remain allowed after a tooth switch, but toast requires the submitting editor's ownership. Try/catch/finally releases the chart lock on every outcome. The existing chart-wide single-flight rule is reflected in the submit disabled state with a status message; another tooth remains editable. Patient switching gains dirty-form confirmation while existing session/patient keys remain intact.
- New `tests/fixtures/yzh-clin-03.html`, `tests/fixtures/yzh-clin-03.jsx`, `tests/yzh-clin-03.browser.mjs`, `tests/yzh-clin-03-server.mjs`.
- This task-specific report only. No CSS, geometry, SurfaceDiagram, ChartSummary, API contract, backend file, booking/prescription source or existing QA tracker/report was edited.

Dirty navigation semantics: Stay retains the current draft. Explicit discard changes context and starts blank; returning does not resurrect discarded text. Clean/reverted forms do not prompt. Top/front view changes retain the same tooth and draft. Clinical drafts remain memory-only.

## E. Clinical safety and authority

Patient/tooth/body are captured before awaiting and never retargeted by selection. Stale completion cannot clear the current draft, inject its error, re-enable a different request's local loading state or show its parent toast. ChartRecord's patient/session lifetime remains independent from tooth selection. Successful updates for the still-current patient are retained even when the originating tooth editor has been discarded.

Backend save authority, validation, branch permissions and append-only records are unchanged. No browser clinical persistence, diagnoses, medication decisions, findings catalog, treatment recommendation or clinic policy was added.

## F. Verification commands and results

| Command/check | Executed result |
| --- | --- |
| `node --test tests/m10-dental-chart.test.js tests/m10-odontogram-motion.test.js` | 4 passed / 0 failed |
| `node tests/yzh-clin-03.browser.mjs --before` on untouched baseline production | Initial 7 pass / 12 fail |
| Same final harness against baseline-replay server | 10 pass / 13 expected fail at 390px |
| `node tests/yzh-clin-03.browser.mjs` on working source | 92 passed / 0 failed, four widths |
| `npm.cmd test` | 1025 passed / 0 failed / 5 existing skips, 1030 total |
| `npm.cmd run test:smoke` | PASS, existing Table key warning retained; logo hashes pass |
| `npm.cmd run build -- --configLoader runner` | PASS, existing >500 kB chunk warning retained |
| `git diff --check` | PASS |

The baseline is intentionally a6a0de5, so QA-02's three new Node unit tests are not present here; 1025 is not a regression against QA-02's 1028 count. Browser cases are separate from the Node suite.

Visual-capture replays of the unchanged isolation/Save assertions passed 4/4 each and produced dialog/pending-editor images at all four widths. The 390px dialog and 1440px pending editor were inspected visually. They retain shared design, visible identity, safe focus and existing contained scrolling. No new full accessibility or real-device conformance claim is made.

Result JSON and screenshots are isolated in Windows Temp, not QA-02 evidence:
- `yzh-clin-03-before-20261103/results.json` (initial red run)
- `yzh-clin-03-final-before-20261103/results.json` (final baseline replay)
- `yzh-clin-03-final-after-20261103/results.json` (92 final cases)
- `yzh-clin-03-visual-dialog/`, `yzh-clin-03-visual-pending/`
- `yzh-clin-03-full-test-20261103.log`, `yzh-clin-03-smoke-20261103.log`, `yzh-clin-03-build-20261103.log`

Each matrix JSON contains production-source SHA-256 hashes; baseline replay hashes Git object bytes, working replay hashes working-tree bytes. Git line-ending normalization can change raw hashes across those representations. Final working-source hashes:
- `src/components/odontogram/Odontogram.jsx`: `69d0bb197abff32bef7388c6e0d3dbb5926c8233534d9752dc4f0067a767609d`
- `src/components/odontogram/ToothTimeline.jsx`: `14677d96d982b883fd265576c12ef60145c910c05136c736c0fabeea3108b20c`
- `src/pages/DentalChart.jsx`: `7f2b3ae08351b6fcb46ed7abbf5b91b0636d7c31f74767fdf62e58eba15b3b96`

Replay setup (existing Playwright/Chrome required; no dependency installation was performed):
```powershell
node tests/yzh-clin-03-server.mjs
# Separate shell, same worktree:
$env:CLIN03_EVIDENCE_DIR = Join-Path $env:TEMP 'clin03-independent-after'
node tests/yzh-clin-03.browser.mjs
# For the immutable baseline, a separate server:
$env:CLIN03_PORT = '5189'
node tests/yzh-clin-03-server.mjs --baseline
# Separate shell:
$env:CLIN03_URL = 'http://127.0.0.1:5189/tests/fixtures/yzh-clin-03.html'
$env:CLIN03_BASELINE_REPLAY = '1'
$env:CLIN03_EVIDENCE_DIR = Join-Path $env:TEMP 'clin03-independent-before'
node tests/yzh-clin-03.browser.mjs --before
```

Both task fixture servers were stopped after verification. No authenticated account, Laravel mutation, backend suite, real provider or database was used. Predefense/hosting acceptance is not established by these frontend checks; the known baseline predefense CRLF issue remains outside this assignment.

## G. Preservation and inventory

Verified final Git inventory: 3 modified tracked files, 5 untracked task files, zero staged paths. Complete task inventory:
```text
 M src/components/odontogram/Odontogram.jsx
 M src/components/odontogram/ToothTimeline.jsx
 M src/pages/DentalChart.jsx
?? docs/YZH_CLIN_03_REPORT.md
?? tests/fixtures/yzh-clin-03.html
?? tests/fixtures/yzh-clin-03.jsx
?? tests/yzh-clin-03-server.mjs
?? tests/yzh-clin-03.browser.mjs
```

The original QA workspace must remain on e708be4 with zero staged/unstaged tracked changes and the same 63 excluded paths/hashes. No Developer A files/workspace, QA-JOEVAN, FINALS-QA-REVISIONS, QA-YZHEKIEL, existing integration reports, dependency manifests or lockfiles were changed. Final preservation verifies all 137 original QA-02 file hashes are unchanged, its index/tracked tree are clean and the same 63 exclusions remain untracked. All eight task text files were scanned without secret-pattern matches.

## H. Remaining limitations

Synthetic store/API fixtures establish frontend lifecycle behavior, not authenticated cross-role/server authorization, durable append-only persistence or backend concurrency. Unexpected rejection is injected at the existing API-module boundary; ordinary network abort is tested separately.

The chart API's server-side idempotency/unknown-outcome guarantees are not changed or claimed. No automatic retry is introduced. Unconfirmed responses retain the draft. Unexpected-rejection feedback asks the clinician to check the chart before deliberately retrying; normalized API failures retain their existing messages. Exact-once writes across transport loss require backend-owner evidence; clinical correction/duplicate-entry policy is not invented.

Draft protection covers the supported tooth, summary, back, dentition and patient-picker transitions exercised here. No new browser-reload recovery, persistence or application-wide route guard is added. Clinic field/status approval, anatomical review, real touch/assistive-technology acceptance and authenticated integration remain separate requirements.

Existing module classifications are unchanged. Runtime M10 / paper M13 chart implementation status should retain its classification with this bounded note: tooth/patient draft isolation and recording completion safeguards implemented and synthetic-browser verified; authenticated acceptance and clinic-specific field/policy approval pending. No canonical module document or academic document was edited.

## I. Disposition

**READY FOR INDEPENDENT READ-ONLY AUDIT.** No commit, staging, merge, push or deployment is authorized or performed.
