# Full-stack integration acceptance — 2026-11-17, Asia/Manila

## Decision

A clean, history-preserving LOCAL integration candidate exists on `integration/dentalops-fullstack-20261117`. The populated clinical/Cash, workforce, receipt/history and four-role session workflows below passed against a newly provisioned synthetic PostgreSQL cluster. **Whole-system acceptance remains open: the broad backend cohort and local predefense are red.** Four complete original QA criteria advanced;64 remain without full integrated acceptance. No integrated publication, main merge or deployment is authorized or performed.

Application merge checkpoint: `96b55aca7d6ba03e57724980dd247b1225a1aecd`. Reviewed contract-test/runner checkpoint: `cb4a8ee7bf462e5605b59da10e4fcc9904844e66`. Final history/receipt harness checkpoint: `e86389245fa3755d67dfc7003a3fd445fcfb364f`. Later commits contain this report/ledger; obtain their exact candidate HEAD with `git rev-parse integration/dentalops-fullstack-20261117`. These hashes are not a claim that a report can contain its own commit hash.

## Sources, branch preservation and conflicts

- Operations: `9409b59e769de29ec0e58ab238b11d40fee29b45`; already includes accepted Codex A and B. No separate B branch was integrated.
- Clinical: `407f0c6b74ce44a7d955d4b897e6100e2bd80a51`.
- Independently read both live refs using `git ls-remote`, verified exact equality, fetched both explicit refs without tags, and verified the exact merge base `a0725e645df6f8266c2bc4bebacc9d62dd18e7c1`.
- Origin remains `https://github.com/ccadaverr/multibranch-dental-clinic.git`.
- Original Windows checkout remains on Operations at9409b59, clean. New sibling worktree: `C:/Users/Joevan Delos Santos/Downloads/proj/dentalops-integration-20261117`. Local Clinical feature ref was also preserved at407f0c6. Neither feature history was rewritten.
- Plan was committed first as `cd435eb5cf222f2fb2d1a53e24160120f03c2f46`; merge commit96b55ac has that plan and Clinical407f0c6 as parents.
-219 Operations and218 Clinical changed paths were inventoried. Nine overlaps; four actual textual conflicts. See [conflict decisions](INTEGRATION_CONFLICTS_20261117.md) and both path manifests.

| Conflict | Final behavior |
|---|---|
| LocalMigrationProfile.php | Ordered Operations extension allowlist plus Clinical exact proposal/hash/disposable-test guard. Actual profile selects no proposal. Realpath event comparison retained. |
| local-system.py | Both explicit contention/lock/flag families and opt-in suite-mail defaults retained. Removed duplicate cache/test mkdir from an otherwise automatic merge. |
| test_local_system.py | Both complete safety-test families retained. |
| Patient Archives.jsx | Clinical current-session/Patient/dependent identity, bounded reads, receipt navigation and guarded PDFs retained. Operations exact last-public-ID/nonrepeating cursor validation moved into the shared archive reader. |

Other overlaps were reviewed: routes, Intake tests, migration-profile Unit tests, API client and its tests. Direct Visit GET keeps the scoped404 correction; Operations direct Appointment/receipt/availability/calendar corrections remain. No blanket ours/theirs resolution. Queue SQL was not changed; its misleading priority-order comment now states the actual arrival FIFO/per-Dentist partition and Served-as-start behavior.

## Database and runtime boundary

NEW container `dentalops-integration-20261117`; NEW volumes `dentalops-integration-source-20261117` and `dentalops-integration-private-20261117`. Source `/workspace`; private manifest `/private/integration/target.json`; PostgreSQL18.7 on container loopback55527. Only `dental_clinic_demo` and `dental_clinic_test` exist in this owned target. No5432 adoption or developer/real-clinic database was read or changed.

Both profiles:87 selected/applied entries =82 original migrations +1 queue-vocabulary preservation migration +4 reviewed Operations extensions. All source hashes and paths are in [the exact inventory](INTEGRATION_SCHEMA_20261117.json). The four historical holds remain genuinely pending, with unchanged source bytes:

1. 2026_11_10_000100_remove_patient_feedback_table.php
2. 2026_11_15_000400_backfill_tooth_chart_branch.php
3. 2026_11_15_000500_add_critical_foreign_key_and_analytics_indexes.php
4. 2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php

The initial source archive used Windows CRLF conversion and correctly failed Clinical's proposal digest guard. Re-exported with `git -c core.autocrlf=false archive`; no migration or digest was edited to bypass it. Provisioning/status checks preceded explicit selected-path migration execution. No default chain, reset, AUTO_MIGRATE, held migration or proposed grant migration ran.

Grant schema is **absent**. The88-entry proposal design is not installed or accepted here. Accepted grant code/tests remain; new/reassigned Dentist access fails closed without the schema. Message search/Realtime tests verify unavailable capability/refusal and existing role/branch contracts. Existing Patient/Staff messaging works. Positive grant lifecycle/races on the integrated candidate are NOT claimed; prior Clinical disposable-profile evidence is not a cutover. No implicit historical grant or new Owner transcript authority was added.

Guard checks passed: schema1test/9assertions; migration/privilege1/14. Runtime application role is not schema owner. Four legacy test classes were initially missed by inventory text scanning and attempted rollback/backfill DDL; PostgreSQL refused each through ownership privileges. No trigger/column/schema was removed or disabled. They are explicitly separated in the final inventory and **must not be rerun with elevated DB privileges** to make them green. A final-run manifest copy initially failed; its exact new test process tree was stopped and the132-file inventory was verified before restart. These are recorded execution mistakes, not passed migration acceptance.

All old developer containers remained stopped, including the existing14 pending intents/jobs; none were replayed. The only worker/scheduler execution was against new fixture clones. Main demo worker and full clinical scheduler were deliberately not started.

## Functional acceptance and actual readback

| Workflow | Executed evidence and limits |
|---|---|
| A: care, chart/history, prescription, billing/Cash | Real React Staff appointment → ID confirmation → Check-In → exact Visit/queue → Dentist Call/open → explicit treatment start → documentation → completion → Staff draft/review/issue → Cash → Patient receipt/PDF/reload. Dropped Cash response recovered with same body/key to the same receipt. Scheduled and walk-in invoices preserve their distinct appointment/null-appointment relationships. Patient auto-assignment/leave/schedule API regressions pass; a real Patient online gateway checkout was not executed. |
| Clinical history/chart | Real completed encounter/revision-history/current-chart read-only UI, six widths; legacy write without revision/key refused; chart/encounter unchanged. Delayed previous-Patient data and wrong-Patient payload refused; explicit retry succeeds. Real PostgreSQL chart CAS/immutable history/revocation and actual lock contention pass. No browser chart-finding write or invented clinical fields are claimed. |
| Prescription | Real draft/validation/duplicate-save/reload; Patient cannot read Draft. Same-Dentist cross-tab logout/login rejects stale issue confirmation. Lost issue response recovers exact number. Patient PDF/reload, authorized Void, immutable original identity and distinct replacement prescription pass. All medication text is explicitly synthetic test input. |
| B: workforce | Real Staff request → Owner review → approval → separate publication → effective duty, committed response-loss recovery, fresh-session readback, exception/period boundaries/history/keyboard and375/390/430/768/1024/1440. Doctor weekly/branch schedule APIs and Staff publication:27tests/300assertions. Preserve the separate existing Doctor lifecycle; no invented symmetric Doctor request/approval/publication policy. |
| C: notifications/messages/archives | Recipient-only history/unread/archive and atomic readback/revocation pass in real PostgreSQL. Messaging search/Realtime and missing-grant refusal pass. Actual Patient receipt archive tests expose later-page failure, recover both real receipts, navigate to exact Billing identity and perform zero financial writes. Blanket restoration/Owner-all access remains blocked. Full grant/Reverb service acceptance is not claimed. |
| D: reporting | Real PostgreSQL OwnerDashboardEvidenceTest/AnalyticsCorrectionsTest in the84-test targeted batch pass: billing-derived exact amounts, branch/period/Owner scope and documented on-demand Saturday histogram. Actual Owner dashboard screenshot shows the real synthetic collection. No Saturday scheduler was introduced. |

Final secret-free database counts, all nine contention targets/logs and final failing test names: [outcomes](INTEGRATION_OUTCOMES_20261117.json). There are2 completed treatments,2 paid invoices,2 payments and2 receipts for two independent care paths; retries did not duplicate settlement. A separate future synthetic appointment establishes the second Patient used in history-isolation testing. Synthetic price125.50 is test data, not a clinic-confirmed fee.

## Test results

Counts overlap across focused and broad runs; do not sum them as unique acceptance.

| Check | Actual result |
|---|---|
| Final full frontend |2003 total;1995 PASS,8 optional skips,0 failures |
| Smoke / production build |PASS; existing chunk-size warning remains; branding hash guards pass |
| Python safety tests |45/45 PASS after exact LF source export; existing ResourceWarnings retained |
| Database-free Unit |252tests/1193assertions, no failures;30 PHPUnit notices retained |
| Core integrated PostgreSQL |95tests/1598assertions PASS (initial2 PDF failures were missing GD in cached toolchain; declared GD dependency installed only in new container) |
| Contract reconciliation |24tests/160assertions PASS: observed leave command preconditions, Staff directory revision DTO, generic appointment404 parity in selected-follow-up readback |
| Operations/reporting/messaging |84tests/1387assertions PASS |
| Worker capture tests |5tests/52assertions PASS with actual private SMTP capture |
| Doctor/Staff schedules |27tests/300assertions PASS |
| Nine real contention lanes |9/9 PASS, each on a new clone; branch115, inquiry89, roster218, leave264, arrival283, encounter280, chart203, prescription546, Cash168 assertions |
| Six populated browser lanes |visit, prescription, workforce, operations, receipts, history: final exit0 for each. Initial harness selector/missing-prerequisite errors retained privately; no application security was relaxed. |
| Final broad reviewed backend |132 explicit files;1260tests/14435assertions;1219 passing,37 failures,1 error,3 skips. **RED**. All names retained in outcomes JSON. Separate migration/reset/contention files were not silently counted as passing. |
| Fake-provider qualification |Test-process-only ASSISTANT_MODE=auto and mocked HTTP:21tests/128assertions,20pass/1 Gemini throttle failure. Application runtime stays knowledge-only. |
| Syntax/source safety |Merged appointment/Visit/controllers/routes syntax, Node harness syntax, git diff --check and tracked/staged credential-URL guards PASS. These are bounded scans, not universal secret absence. |

### Remaining broad backend failures

| Category | Final count / interpretation |
|---|---|
| Retired singular automation monitor routes |15 failures,404s. No insecure executor/retired route was restored; all original substantive assertions retained. |
| Feedback unavailable/conflicting contracts |11failures+1error. Preserved source has no working feedback route in this cohort; some tests demand Owner access/automation that conflicts with retained privacy/scope. Do not restore that authority or execute the held removal migration as a shortcut. |
| Assistant target configuration |7 failures under deliberately knowledge-only target. Those cases pass under explicit test-only mocked-provider qualification; no runtime/provider activation. |
| Gemini throttle fixture |1 failure remains: first expected422 is429. Not declared resolved or hidden. |
| Audit append-only diagnostic |1 failure expects trigger wording for TRUNCATE; restricted role instead refuses at privileges. Refusal remains enforced; assertion reconciliation still pending. |
| Prior late-order expectation |1 failure expects on-time arrival to jump an earlier late arrival. Conflicts with approved FIFO. Broader branch-wide/reorder/history acceptance remains open; changing text alone is insufficient. |
| Queue backfill timestamp |1 failure: expected09:20+08 versus17:20+08. Requires exact serialization/timezone investigation without rebasing saved history. Not declared harmless or fixed. |

The prior OWN-11 static failure is resolved by actual Operations source without changing its assertion. Original four-role/Staff/Dentist functionality was then verified as above. Clinical's prior predefense5fail/6warn and default8fail/6warn are historical, not replaced by a green Operations claim.

## Predefense and runtime qualification

`scripts/predefense-check.sh --local-only` ran with the verified new profile: **7 FAIL /6 WARN**. Failures: container-to-host Vite probe403 (browser loopback UI works); main demo worker down; full scheduler down; only2 synthetic Patients; no unpaid invoice (tested ones settled); synthetic branch lacks clinic contact data; old synthetic outbox item remains pending. Warnings include local-only providers, missing emails, no active assistant answers and queued synthetic work. No fake clinic contacts/Patients/invoices/wording were added merely to satisfy the checklist.

The separate Clinical runtime lab passed on NEW clones `/private/contention-3661c92e` and restore `/private/contention-6ca192b5`: actual worker transport failure/backoff, interruption before acknowledgement, fresh/stale claim handling, two processors observed waiting on PostgreSQL locks, one local capture, duplicate terminal suppression, restored private document/key/access. No migrations executed in that lab. Scheduler scope was the source due-mail frequency only; full clinical automations did not run. Local capture is not internet delivery and at-least-once SMTP crash ambiguity remains.

PHP8.3.6/PostgreSQL18.7 were used. Cached local runtime image lacked the GD already declared in its versioned Dockerfile; installed php8.3-gd in the new container. Existing capture script needs removed stdlib modules on Python3.12. For this isolated toolchain only, downloaded unchanged modules from official `https://raw.githubusercontent.com/python/cpython/v3.10.14/Lib/` into `/usr/local/lib/python3.12/dist-packages`:

| File | SHA-256 |
|---|---|
| asynchat.py |375c501c0dc3138c5f75fa80ce624c8f1a5bfd388c7855c3b03982751faf30e5 |
| asyncore.py |a16d3244eb6d29870811bf9bf28227f005200e1498405f0adfac972f55220110 |
| smtpd.py |1789da8d39e12e65a29677f5cb1c08e03373a483a0547775c86ae9a51230c3c8 |

The3.11 copies first tried were incompatible with3.12's removal guard; no source hash was repinned. This is an explicit non-production compatibility dependency, not a maintained production SMTP service. Credentials, APP_KEYs, mail contents, logs and snapshots remain private and untracked.

## Original68 QA reconciliation

[Current reconciliation](QA_RECONCILIATION_20261116.md) preserves all68 exact criteria/tasks and original owners; its validator passes. [Machine-readable full68 ledger](INTEGRATION_QA_LEDGER_20261117.json) records source evidence, focused tests, remaining requirements, local and integrated acceptance and blockers per ID.

**25 locally Complete (21 inherited provisional +4 newly integrated);32 Partial;11 Blocked. Integrated passes4; pending64.** Only OWN-02,STF-09,STF-20,OWN-11 advanced. DEN-14/STF-21 remain Partial because grants are unavailable on this candidate. GEN-07 has no all-form audit, GEN-09 has only bounded click/navigation improvements, GEN-10 still lacks complete integrated all-role UI acceptance and GEN-11 lacks entity-specific restoration/retention authority. No whole criterion was promoted from a subcriterion pass.

Private Operations Round9 source-freeze/bundle handoff was available and inspected. Clinical handoffs/reconciliation/runbooks arrived with the exact fetched source. Older raw B Round10 evidence was not located and is not claimed inspected; the private Round11 evidence was not a basis for new acceptance. Existing verified Operations bundle and handoff files were preserved unchanged.

## Reproduce and resume safely

The isolated runtime was backed up and stopped after testing. Final private snapshots: `dental_clinic_demo-20261117T033610931196Z.dump` and `dental_clinic_test-20261117T033611289886Z.dump`; all9 contention clones and runtime/restore clones are stopped. Source/private volumes and keys remain. Host Vite was stopped. No container/volume/file cleanup was performed.

Resume only this owned container, then its existing cluster; do not reprovision or repin the manifest:

```text
docker start dentalops-integration-20261117
docker exec dentalops-integration-20261117 python3 scripts/local-system.py --target /private/integration/target.json --profile demo start
docker exec dentalops-integration-20261117 python3 scripts/local-system.py --target /private/integration/target.json --profile demo status
docker exec dentalops-integration-20261117 python3 scripts/local-system.py --target /private/integration/target.json --profile test status
```

Start API using runner `serve`, then a new owned socat8105→8104 bridge if absent. Docker publishes host127.0.0.1:8124 only. In the integration worktree, run Vite on127.0.0.1:5198 with VITE_API_BASE_URL=http://127.0.0.1:8124. Start private capture only in the new container as needed. Do not automatically start the whole clinical scheduler or process unreviewed queued work.

`node scripts/run-integration-browser.mjs <lane>` accepts visit/prescription/workforce/operations/receipts/history; set PLAYWRIGHT_MODULE to the already installed index.mjs. Receipts/history use only observed earlier persisted journey artifacts; history establishes its second synthetic Patient appointment through the real Staff API, not implicit clinical permission. Browser adapter changes host origins/private paths and keeps generated passwords in memory. Detailed evidence stays under the host Temp `dentalops-integration-browser-20261117` directory, not Git.

`scripts/integration-contention.py --target /private/integration/target.json` requires an empty verified test source and creates new clones. Use explicit regular paths in INTEGRATION_REGRESSION_PATHS_20261117.json with the guarded test runner. Do not replace this with default migrations or blanket reset-based Feature runs. Re-export reviewed source with core.autocrlf=false and verify source/manifest hashes before any new execution copy.

## Next bounded batch and owner decisions

Highest-priority next batch: reproduce the exact queue/backfill timestamp discrepancy, reconcile approved FIFO against per-Dentist projection and manual reorder history, and add immutable synthetic readback/revocation tests before changing behavior. Preserve Served=treatment START and every held file. Do not rebase saved timestamps. Then reconcile the retained legacy test contracts and complete all-role notification UI/Patient archive interruption evidence; do not begin unrelated cosmetic modules while safety diagnostics remain unresolved.

Owner decisions still needed: separately reviewed grant installation/profile and historical reauthorization cutover; entity-specific archive/restore/retention rights with Owner/DPO; exact GEN-06/DEN-03 reproductions. Source delivery is resolved and must not be requested again. Existing approved FIFO/conversation policies remain authoritative.

Recommended next Codex prompt:

```xml
<task>Continue locally from integration/dentalops-fullstack-20261117 at its verified report HEAD. Read INTEGRATION_ACCEPTANCE_20261117.md and all68 ledger rows. First reproduce and resolve the QueueTest timestamp discrepancy and approved FIFO/reorder/history contract using NEW synthetic targets and exact persisted identities. Preserve immutable history, Served-as-start, all four migration holds, current role/branch/session protections and grant-unavailable fail-closed behavior. Run focused regressions then the recorded consolidated gates; make logical local commits. No publication, main merge, deployment, existing-database mutation, grant installation, historical job replay or unapproved clinical-access cutover.</task>
```

No push, main merge, force/history rewrite, hosting setting change, external messaging, held/grant migration or production access occurred. Earlier known GitHub hosting trigger risks remain relevant to any future separately authorized publication. This report does not authorize that action.
