# Same-day controlled integration — source-waiting checkpoint

2026-11-16 Asia/Manila. Starting Clinical HEAD `4cbb1386dbc4fd959b74882a95d370320d2a63e6`, clean `feature/jaztin-qa-20261115`, `/private/tmp/dentalops-jaztin-qa-20261115`. Original Clinical history and Draft PR #9 are preserved. Local test/documentation work only; no push, Operations fetch/import, integration branch, merge or deployment.

## Owner decisions received

* Historical PostgreSQL URL classification accepted as an apparent configuration template, subject to recorded scan limitations; not a new assertion that all history is secret-free.
* Jaztin approved as source recipient. Expected Operations full HEAD: `54a727274901b9db2256fb8c6b1bef64eaa1c0d2`.
* Bundle `joevan-qa-20261116-182348.bundle` remains on Joevan's Windows computer. Its independent SHA-256 is **not supplied**; source is **not delivered** to this Mac. No Windows filesystem access is assumed.
* GitHub is the preferred delivery/integration route, but source publication is gated on deployment-trigger safety. No fallback private delivery method is finalized.
* Local isolated integration is conditionally authorized after authentic source receipt, independent SHA-256/ancestry verification and safe database/migration isolation. Owner explicitly says **no merging now**. When conditions pass, do not wait for all independent QAs to close before constructing the candidate. No integration publication, main merge or deployment.
* Approved QA communication: this existing ChatGPT conversation, for the owner to copy the bounded handoff to **Joevan, Codex A on Windows**. No automated messaging; prepared final output is not a claim of recipient delivery or acknowledgement.

## Bounded 21-row handoff

Extracted directly from `docs/QA_RECONCILIATION_20261116.md`: **19 Partial + 2 Blocked = 21**. IDs: GEN-01, GEN-10, GEN-11, STF-07, STF-08, STF-09, STF-20, STF-25, DEN-12, DEN-13, DEN-16, OWN-01, OWN-02, OWN-03, OWN-07, OWN-08, OWN-09, OWN-10, OWN-11, OWN-12, OWN-13.

Original acceptance/task wording and attribution, current responsible domain, implementation/test evidence, local completeness, blocker, next action and integration dependency are preserved. This is a reconciliation request, not a claim that Joevan's current implementation lacks the listed behavior. His evidence remains provisional until inspected source arrives. Private Markdown/JSON copies and source gate/migration-hash checkpoint are at `/private/tmp/dentalops-integration-intake-20261116`; the final ChatGPT response supplies the copyable original-criterion/status/remaining-dependency table.

## Independent correction while waiting

Demonstrated defect is in a **test fixture**, not the accepted messaging runtime: `STF-23 genuine empty history and exact encoded search cursor stay supported` failed at the starting HEAD because its positive response omitted mandatory Batch07 `meta.context`. Existing fail-closed runtime correctly rejected that response.

The one changed test file now supplies exact conversation/Patient/branch response proof and selected expected context. The original successful-empty result assertion is retained. Malformed-row cases also include valid proof, ensuring they exercise malformed-row refusal rather than unrelated missing-context refusal. New checks assert the actual encoded query/cursor/page size and reject empty results with missing or foreign conversation/Patient/branch context. No success/refusal expectation was weakened, no runtime guard bypassed, and no clinical/permission/switching behavior changed. No route, API client, migration or production configuration edit.

## Actual verification

* Before: exact positive empty-history test **failed**, exit 1, against starting HEAD; private `message-fixture-before.log`.
* Focused `node --test tests/qa-batch08-workflows.test.js tests/message-read-context.test.js tests/m17-message-search.test.js`: **39 passed**, zero failures.
* Full frontend: **1952 tests: 1941 passed, 3 failed, 8 skipped**. Compared with Batch08's 1951/1939/4/8: one fixture failure is corrected and one new denial test passes. Suite remains red. Remaining failures are unchanged: walk-in queue-policy text assertion (`batch4b-operations.test.js`), historical OWN-11 Staff schedule (`staffing.test.js`), prior chart-recovery wording assertion (`yzh-clin-09-branch-identity.test.js`). They are not classified as newly discovered Operations implementation defects without delivered source inspection.
* Smoke and production build **passed**; existing React list-key/bundle-size warnings retained. These are Clinical-source checks, not integrated browser acceptance.
* Owned loopback demo identity and migration-source hashes verified using the existing private runner target. Read-only `scripts/predefense-check.sh --local-only`: **exit 1, 5 FAIL / 6 WARN** (worker down, scheduler down, no unpaid invoice, synthetic branch contact/hours, 13 aged unsent outbox items). External email/payment/tunnel omitted. No service started to hide failures.
* No PHP/runtime/database changes; no new backend suite, contention, four-role or integrated browser acceptance is claimed. Prior focused Clinical evidence remains dated; receipt-email and Intake failures remain unresolved.
* Exact-source validator passes: **68 IDs, original acceptance/tasks/owners and populated evidence columns**, counts **21 Complete / 36 Partial / 11 Blocked** unchanged. All 68 still need integrated acceptance; no new original criterion accepted by this fixture correction.

Private logs are in the intake directory and contain synthetic-only execution evidence. Final changed-file/diff/credential scan is required before the local logical commit. This checkpoint is not an integration candidate or presentation readiness certificate.

## Next execution boundary

Obtain deployment-trigger clearance for the preferred GitHub source publication and authentic approved source plus independently supplied digest; verify expected Operations HEAD, complete history/common baseline and safe migration profile. Then use the owner's existing conditional authorization for an isolated local candidate, inspect shared conflicts and run the prepared cross-role acceptance runbook. Do not push, merge now, reconstruct Operations code, execute held migrations or use real payment systems. Owner admission/cancellation/handover/archive privacy decisions and missing GEN-06/DEN-03 reproductions remain unfulfilled rather than invented.
