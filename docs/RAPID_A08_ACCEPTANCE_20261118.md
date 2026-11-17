# A08 — Financial reporting and combined acceptance

Executed November17–18,2026, Asia/Manila. Started clean on `integration/dentalops-fullstack-20261117` at `a3136a3a26c8be9995388e5d3833ce773cb3997d`. Guarded backup preceded changes; the existing port5198 demo was not restarted, reset or migrated.

| Delta | Local integration commit | Verified patch SHA-256 |
| --- | --- | --- |
| B09 | `419324529f2db0b981736cf5c1e7acf86cc5bc14` | `a0fd4e30899d4b9ec4e8c979085dab013d2e608cc0e5ea0ddb04b00d5adcdb23` |
| B10 | `2c55ed8d5acb3720ae02499a4592f9111b1ee906` | `64adaa522b5430afdc532a692e26cb3b119467462042e56cb243f9f1d6f6dab2` |
| B11 | `650b775308c21f7009637143a232a15073822e59` | `94369c65b714877c1732de3cbc0704b0a2233e3759cfb1c54867fca5c1138250` |

Each frozen directory's three SHA256SUMS entries, dependency chain and changed-file inventory were checked. B09's base was65a1088 plus already-present B07/B08; B10's committed base905c7de received only B09; B11's committed base6ffe0ac received B09/B10. Indexed applicability was rechecked against each actual receiving HEAD, then focused tests passed before its separate commit. No conflicts; B06/B07/B08 were not reapplied. Inventories:8 B09 paths,6 B10 paths,7 B11 paths.

B09 supplies dated cash flow in the existing authorized CSV and refuses an empty download with scoped retry. B10 resolves a relative export period once across Manila midnight, identifies branch/dates in the filename, escapes spreadsheet text and exposes one truthful Print current view action. B11 refuses wrong requested chart windows/weeks and missing days, preserves retry scope, and labels invoice-creation metrics separately from payment/refund-date cash flow. Existing calculations, authorization and financial authority remain.

**Additional correction:** `2cab6e3b7a2a5c0e30e407f148fcb0f8f0c5c65f`. The actual Owner dashboard selected the first record for duplicate branch names, unlike the already-strict Analytics page. A before-fix browser regression reproduced missing refusal. `Dashboards.jsx` now rejects ambiguous/unavailable selections before showing dashboard figures or issuing financial reads. The same browser proves zero new reads, clear unavailable feedback and recovery to All Branches. No global style, font or button system changed. Applied cautious Postel(identity validation), Nielsen(visible failure), Hick(one output choice) and Tesler(shared date/aggregate handling through B09–B11).

| Verification | Actual result |
| --- | --- |
| B09 focused |27 frontend passed;27 affected PostgreSQL tests/381 assertions; six-width CSV/retry browser passed |
| B10 focused |27 frontend passed;28 affected PostgreSQL tests/391 assertions; six-width filename/print browser passed |
| B11 focused |40 frontend passed;29 affected PostgreSQL tests/462 assertions; six-width wrong-window/weekly-scope refusal/retry/hover browser passed |
| Additional OWN-01 evidence |1 PostgreSQL case/103 assertions, plus separate existing dashboard capture1 case/44 assertions. Real persisted payment/refund sums independently reconcile the API/chart/CSV. These groups overlap existing cases and are not added as unique totals. |
| OWN-01 browser |Captured actual PostgreSQL aggregates render in the real shared chart components at375/390/430/768/1024/1440. Both hover and keyboard expose exact date/gross/refunds/net, with branch switching, negative refunds, honest empty/loading/error recovery, Saturday visibility and Sunday finalization. Dashboard ambiguity is refused without reads. |
| Full frontend |2023 passed/8 existing skips/0 failures;2031 total |
| Reviewed backend |1309 tests/15341 assertions:1279 passed,26 inherited failures,1 inherited error,3 skips. All27 failed/erroring identities exactly match S03/A07; no new failed case. |
| Unit/Python |252 tests/1193 assertions passed,30 existing PHPUnit notices;53 Python tests passed with existing negative-guard ResourceWarnings |
| Live finance |Real synthetic Cash commit-response loss/replay returns one exact Payment/Receipt and unchanged Invoice/Visit/Patient identity. Scoped chart/CSV, three non-Owner report denials and Patient receipt PDF pass at six widths. |
| Combined application |Four-role login/reload/archive/logout; Staff admission/ID/Check-In and FIFO; STF-17 Call/Message exact replay and two-session CAS; Owner separate workforce approval/publication/fresh duty; Dentist start/save/reload/explicit completion; J02 Patient booking/Home/Family, prescriptions and protected PDFs pass. Patient document upload/read/download preserves exact bytes and denies foreign Patient metadata/file access. No J03/J04 source or document API/CORS change. |
| Restart |Complete disposable supervisor/cluster stop/start retains Paid invoice/receipt/Visit, scoped cash totals, protected document, Call/history/reply, completed encounter, issued prescription, workforce duty and all four archived notifications |
| Smoke/build/diff |Passed, retaining existing React Table key and Vite chunk warnings. Staged bounded secret/credential-URL checks passed. |
| Predefense |Accepted port5198 target:0 FAIL/4 WARN. Disposable browser target:1 deliberate fixture-contact FAIL/5 WARN; all service checks pass. Its branch explicitly says Synthetic—not clinic hours; no clinic facts were invented to silence that diagnostic. |

**Financial evidence is not interchangeable.** The rolled-back PostgreSQL scenario proves Saturday gross121.40, refunds5.02 and net116.38; Sunday daily gross40.07, refunds3.04 and net37.03. Weekly Monday–Saturday excludes Sunday's transactions. Saturday-created Paid invoices total61.16, while an Issued/unpaid invoice contributes75.11 outstanding. Those are controlled fixture values, not substitutions into the presentation database. The actual NEW presentation database instead recorded an1800.00 Cash payment on November18 against its November17 invoice. Payment-date cash flow increased on November18; invoice-creation metrics retained November17 attribution. Its real scoped CSV and receipt were checked against those actual records.

**OWN-01 passes:** all original tasks/acceptance/owner remain unchanged. The existing [A4 Saturday contract](OWN01_A4_ACCEPTANCE.md) is a read-only/on-demand Saturday summary, in progress on Saturday and finalized after the reporting day; no scheduled immutable closing artifact is claimed or introduced. Current totals: **29 locally Complete/28 Partial/11 Blocked;15 integrated Pass/53 Pending,68 total**. No other original QA or presentation-wide QA is promoted. GEN-09 remains Partial and its cross-role efficiency benchmark remains Codex B's assignment.

**Preserved:** exact87 approved migration names/hashes, all four held migrations, absent conversation grants/GEN-07 proposal columns, original19 protected jobs, clinical history/identity, FIFO, CAS/idempotency and Served=treatment START. No unapproved migrations, historical-job processing, external delivery, real clinic database, push, main merge or deployment. J03/J04 remain unpublished and were not reconstructed.

Private evidence: `../dentalops-a08-evidence-20261118`. Regular test clone `/private/contention-9c1f06ad`; NEW browser target `/private/contention-83d4d563` on API8129/frontend5209, separate from accepted API8124/frontend5198. Test resources are backed up/stopped and private files retained. The accepted demo remains running. Next: receive Codex B's frozen GEN-09 handoff, integrate only exact authorized Clinical checkpoints when published, and rehearse the final presentation against the retained demo.
