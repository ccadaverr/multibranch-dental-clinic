# Sprint10 final Clinical grant and runtime acceptance

Sprint evidence 2026-11-16; report finalized 2026-11-17 Asia/Manila. Sprint start `a60f7816af4e45ccdf811204de7e692e05e91c9e`; preserved Clinical branch `feature/jaztin-qa-20261115`. Runtime/intake checkpoint commit `c4fe3f7cfba10235adb40ec97899cb61fa88d62c`. This report qualifies the later grant batch and supersedes the initial Sprint10 snapshot where results differ. No push, PR modification, Operations import/merge, main merge or deployment.

## Exact requirement and new authority

DEN-14 (`FINALS-QA-REVISIONS.md:906`): “Apply all STF-21 to STF-24 changes to the Dentist messages through shared components”; acceptance **“Dentist messages match staff messages.”** STF-21 (`:873`) requires renaming Add dentist to Switch dentist and matching the behavior to the label, with acceptance **“Label reads \"Switch dentist\" and switching works.”** STF-22/23/24 readability, search/highlights and scroll evidence remains in Batch07/Sprint09; none was rebuilt.

The owner resolved the missing switching/history/access policy and approved explicit grants; see [decision record](CLINICAL_OWNER_POLICY_DECISIONS_20261116.md). The additional schema was reviewed separately and authorized for **NEW disposable synthetic cluster testing only**. Existing-service migration or rollout was not authorized. The proposal remains outside automatic migration discovery.

## Implemented and exercised

* Append-only `conversation_dentist_grants` records exact conversation/Patient/branch/Dentist, previous active Dentist, authorizing Staff, encrypted reason, revision and database timestamp. A composite foreign key prevents activating a grant for another conversation/Patient/branch. No legacy grant/backfill is inferred.
* Staff reassignment requires current role/account/branch authority, an active Dentist permitted at that branch, current conversation revision, explicit reason and original Idempotency-Key. Conversation, Staff authority, grant activation, previous-grant revocation, participant preservation and structural branch audit commit together. Audit failure rolls the command back. No clinical-care state changes occur.
* Current grants control normal Dentist reads/writes/history and contact summaries. Old message authorship/content remains immutable. The new Dentist reads existing history after explicit authorization; the former Dentist loses ordinary access, including original-key message receipt recovery. Reassignment and message commands protect replay authorization under the conversation lock, not only in the controller.
* On an unmigrated or unavailable service, **new reassignment fails closed**. The obsolete participant mutation cannot bypass the grant command. Existing pre-cutover histories retain their existing authorization until a separately approved schema cutover; after installation all Dentist access requires explicit grants. Disabling new grant creation never revives former-Dentist access.
* Actual new-message notifications use the established `message_received` kind, routed to the active authorized Dentist only, with no message text. Existing Patient notifications continue. Historical notifications remain, but their revoked targets return 403. A distinct durable assignment-notification kind was not invented; that remains a B-contract comparison.
* Strict-profile future message/change signals avoid the conversation-wide channel retained by old subscribers and revalidate personal recipients at broadcast time. The former Dentist receives only the content-free reassignment/revocation signal. Actual Reverb delivery was not exercised; channel filtering and delayed-recipient decisions were exercised in PHP, and browser fallback/revocation was exercised with real HTTP.
* Shared React controls bind exact conversation/Patient/branch/Dentist identity, reason, revision and key. Missing/unverified legacy grant contracts cannot authorize a request. A lost response freezes the original selection/reason; keyboard retry recovers the original saved receipt. Wrong identity/revision/malformed receipts remain unconfirmed. Stale-CSRF context still prevents dispatch.
* Conversation access does not confer Visit responsibility or document rights: a granted Dentist can read the conversation but is denied a document linked to another responsible Dentist's Visit. No chart, prescription, admission, encounter completion, settlement or receipt authority is added.

The grant creation flag is `DENTALOPS_CONVERSATION_GRANTS_ENABLED`; it is not enabled on the existing demo/test services. Installing the schema is a one-way authorization cutover even when creation is later paused. Do not copy the proposal into executable migrations or migrate existing services without separate review.

## Actual PostgreSQL and browser evidence

Final reviewed grant run:

```sh
PLAYWRIGHT_MODULE=/path/to/installed/playwright PYTHONDONTWRITEBYTECODE=1 \
python3 scripts/clinical-grants-lab.py \
  --target /private/tmp/jaztin-clinical-20261115c/target.json --browser
```

The script verifies the owned source/cluster/schema, acquires the normal **dental_clinic_test.lock**, rechecks empty fixtures under that lock and restores into a NEW cluster. Only the exact pinned proposal is newly migrated, after verifying the complete pre-migration ledger; all 83 existing reviewed migrations are already applied and skipped. The four held files never enter the selection. The runtime role receives SELECT/INSERT on the grant table and sequence usage, not UPDATE/DELETE. No default migration/reset/rollback chain runs.

Evidence: `/private/tmp/contention-f622c61c/`:

| Check | Actual result |
|---|---|
| Focused HTTP/database lifecycle | **10 tests / 104 assertions pass**. Exact identities, Staff authorization, CAS, receipt replay, immutable/encrypted grants, scope FK denial, clinical-document boundary, paused-creation safety, legacy-command denial and revoked shared-receipt denial. |
| Deliberately committed race fixture | **1 test / 2 assertions pass** in this disposable target only. |
| Competing reassignment | Two independent PHP processes observed waiting on the same PostgreSQL row lock; **201 + 409**, one grant. |
| Pending former-Dentist write | Reassignment commits ahead of the blocked sender; **403**, no extra message. |
| Simultaneous original-key retry | **201 + 201**, one persisted grant/receipt, exactly one replay; later lost-response retry returns the same body. |
| Database immutability | The migrator's UPDATE is rejected by the append-only trigger (P0001); this is separate from runtime-role privilege denial. |
| Real browser | Staff, old/new Dentist and Patient Sanctum sessions; Owner denied. Actual committed-response loss and original-key recovery; delayed authorized response cannot restore the revoked view; historical readback and recipient notification; keyboard and **375/390/430/768/1024/1440** widths. |
| Browser-only failure fixture | Real React/API client with synthetic HTTP loss, malformed/unavailable service boundary, frozen original command, keyboard recovery/cancel and six widths. `/private/tmp/jaztin-clinical-sprint10-browser-final/`. This is not another server/database test. |

The server/Vite and disposable PostgreSQL process groups stop after the checks. Private evidence is retained; no destructive cleanup. The reviewed proposal/profile is not accepted by an unrelated default/reset runner.

## Runtime recovery and inherited failures

The final runtime/restore run is `/private/tmp/contention-d77b1dc4/result.json`, with fresh restored target `/private/tmp/contention-460f651d`. **2 tests / 36 assertions** plus explicit queue, clock, crash, two-connection contention, capture and restore assertions pass. It uses its own SMTP port/private documents, verifies byte SHA-256/key/identities/access boundaries, never claims external delivery, and stops both clusters. See [initial runtime report](JAZTIN_CLINICAL_SPRINT10_20261116.md) for the precise at-least-once and mail-only scheduler scope.

The source-snapshot lock was corrected to match the ordinary runner's per-database lock; a negative test now proves both labs refuse a concurrent normal test-profile operation before cloning. Source emptiness is checked again under the lock. This corrects a harness exclusion gap; it is not a clinical behavior change.

All **31 Python guard/provision tests pass**: existing runner/provision 21, runtime/grant labs 10. Read-only PHP schema/identity guards **21 tests / 26 assertions pass**. The generic runner intentionally refused the unit file containing literal destructive-command test cases; the reviewed read-only unit cases were run directly with the same isolated bootstrap, not by weakening that guard.

Default queued/capture/arrival checks: **6 tests / 68 assertions pass**. Existing messaging regressions: **39 tests / 606 assertions pass** using the explicit PHPUnit-compatible array/sync profile. This is separate from the real queued/local SMTP acceptance and does not claim third-party delivery.

Initial new-lab failures were retained and resolved: missing runtime privileges on the new table; the rejected unsupported notification kinds; absent Staff fixture profiles; synthetic Dentist references colliding with frontend demo identity references; and a Patient-row test selector incorrectly assuming a Staff-visible Patient code. Authentication/identity bridge enforcement was preserved. The new grants were not fabricated from those failed setups.

Two legacy backend invitation/history tests now assert fail-closed behavior on an unmigrated service. Their former contract allowed a former Dentist to read history; the owner explicitly superseded that policy. Positive switching/history/revocation remains exercised by the reviewed-profile tests and real browser, not replaced by denial alone. The frontend switch fixtures now include required grant details and preserve all exact-receipt, CSRF/stale-context and no-request checks. An intermediate full run had **1934 pass / 2 fail / 10 cancelled / 8 skip** from those stale fixtures; the focused corrected set is **69 pass / 0 fail / 0 cancelled**. Final full-suite counts: **1945 pass / 1 fail / 0 cancelled / 8 skip = 1954**. The only remaining failure is inherited OWN-11 at `tests/staffing.test.js:106` (`/Staff work schedules/`). Before Sprint10: 1942 pass / 2 fail / 8 skip = 1952. Two new strict-grant client tests pass and the owner-authorized walk-in assertion is reconciled; no other failure is hidden. The build passes and all **17 smoke groups pass**, with inherited bundle-size/React-key warnings retained. The full final log is `/private/tmp/jaztin-clinical-sprint10-frontend-final-proof.log`; build/smoke logs end in `-accepted.log`.

Walk-in copy reconciliation is supported by a real PostgreSQL ClinicalArrivalOrderingTest (**1 / 16**, included in the default six-test count): equal-time walk-in first, scheduled identity/reservation preserved, stable queue-number ordering, original-key replay, branch isolation and immutable arrival history. The obsolete scheduled-first sentence was replaced with arrival/advisory and no-reservation assertions under the owner's decision. No QueueService, PatientFlow or workforce implementation changed; branch-wide reorder semantics/history remain A-owned.

Local-only predefense remains **5 FAIL / 6 WARN**: global worker, global scheduler, unpaid-invoice fixture, synthetic branch contact/hours and 14 aged intents. Default predefense also checks external mail/PayMongo/tunnel and reports **8 FAIL / 6 WARN**. The original demo's **14 pending intents / 14 jobs** remain unreplayed and unchanged. No red suite is called green; no demo, hosted or production readiness is established.

## QA and integration decision

All original 68 rows/tasks/criteria/owners are preserved and validated. Before/after **21 locally Complete / 36 Partial / 11 Blocked = 68**, all 68 integrated acceptance pending. DEN-14/STF-21 gain substantial isolated-profile evidence but remain Partial because existing-service cutover is unapproved and integrated parity/contracts are unverified. GEN-07 still needs compatible category/detail persistence and full cross-role inventory; GEN-09 still needs complete comparable workflow benchmarks. No original full criterion is promoted from a subset.

Expected Operations `8de2cf3f37e8ae253ec8d918e3690bdde3a1b1cb`; reported bundle/digest remain recorded but source received NO, receiver digest verified NO, ancestry verified NO. Conditional integration authorization YES; conditions met NO; import/merge now NO; candidate NONE. Grant schema test approval is not integration/publication/deployment approval. Shared contract comparison, Archives side-by-side and all 68 integrated tests remain pending authentic source.

The [owner-mediated Joevan handoff](JAZTIN_SPRINT10_JOEVAN_HANDOFF_20261116.md) contains the current exact **21 source rows (19 Partial / 2 Blocked)**, portable OWN-11 source-only reproduction, the approved FIFO boundary, notification-kind findings and shared-file comparison manifest. Preparing it does not claim delivery/acknowledgement.

## Final postflight and retained limitations

Both existing owned databases still have **83** applied migrations and **no conversation grant table**. Existing demo: **14 pending intents / 14 jobs**; existing test: **0 / 0**. All four held migration hashes and the unchanged Patient Archives hash match the intake manifest, and none of the held migrations is in either ledger. Source received/digest verification/ancestry/integration remain false. All disposable runtime/grant clusters and their temporary application process groups are stopped. Private snapshots/MIME/documents/logs are retained outside Git.

Logs include `runtime-accepted.log`, `grants-final-proof.log`, `messaging-backend-accepted.log`, `default-backend-final.log`, `schema-guards-direct.log`, `python-accepted.log`, `workflow-fixtures-final.log`, `browser-final.log`, `frontend-final-proof.log`, `build-accepted.log`, `smoke-accepted.log` and `predefense-final.log` under `/private/tmp/jaztin-clinical-sprint10-`. The corrected focused frontend set is **69 passed**, and the Python guard/provision set is **31 passed**. Backend coverage is focused, not the entire projectwide backend suite.

Integration is blocked on authentic source delivery and its gates. Presentation/demo readiness is **not established** while OWN-11 and local predefense remain red and reviewed grant cutover is pending. Production readiness is **not established**. Highest-value next work is authentic Operations intake/contract comparison and owner review of the already tested schema/cutover, followed by exact cross-role acceptance at the isolated candidate HEAD. GEN-07 representation and GEN-09 complete benchmarks remain explicit unfinished work.
