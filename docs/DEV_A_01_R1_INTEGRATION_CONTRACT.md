# DEV-A-01-R1 integration contract (local review only)

Developer A, Joevan Delos Santos. Asia/Manila, 2026-11-01. This supplements and supersedes the payment-capability/dependent-search limitations in DEV_A_01_BACKEND_HANDOFF.md. No deployment, integration approval or clinic-policy approval is claimed.

## A. Repository state

Workspace `C:\Users\Joevan Delos Santos\Documents\dental-clinic-dev-a01-20261031`; branch `feature/joevan-dev-a01-backend-integrity-20261031`; HEAD `2b9c891b0195198c970169fc6b752cdc038176b0`. Began with six modified tracked files and three new files from DEV-A-01, all unstaged. Preserved all of them. No Developer B directory, frontend file or shared branch was altered. No commit, merge, push, rebase, reset, stash or clean.

## B. Failure reconciliation and clinical contract

See [the exact 43-test comparison](DEV_A_01_R1_FAILURE_COMPARISON.md). Paired serial runs against current and untouched baseline each returned 40 failures, one error, two passes, with identical assertion/error text for every paired failure. No current-only failure reproduced. The original account-recovery and concurrent-queue-number failures remain **not conclusively classified**, rather than being called proven baseline failures. Reproduce under original suite order/Manila clock before changing those paths.

The Waiting-start assertion is not an obsolete fixture under the frozen contract: `docs/architecture/CONTRACTS.md` queue/treatment tables require Called/Treatment Ready before Served/In Treatment. Existing QueueService comments and refusal text agree. Commit `f4b04f62da2a6dd40655692b75a5f7c13b2ba373` expanded serve to In Queue/Waiting and changed priority ordering to FIFO without revising that frozen contract. This is an independently identified **pre-existing production/contract discrepancy**, not caused by booking/payment changes. R1 restores only the treatment-start guard to Called/Treatment Ready, preserving atomic admission and exact encounter checks. Existing assertions remain unchanged. The separate priority/FIFO conflict remains deferred for coordinator reconciliation. Waiting is not completed care; Served is still treatment start, not completion.

## C. Focused R1 corrections and files

- `backend/app/Http/Controllers/AppointmentController.php`: dependent-aware availability, calendar, recommendation and branch-option searches; rescheduling uses the authorized appointment's own patient. Adds a read-only booking capability/fee snapshot.
- `backend/app/Http/Requests/Appointment/AvailabilityRequest.php`: optional Patient `for_patient_id`, prohibited for operational roles using this request.
- `backend/app/Http/Requests/Appointment/RecommendationRequest.php`: optional dependent public ID, resolved through guardian authorization.
- `backend/app/Services/Appointments/AppointmentService.php`: an explicit `pay_at_clinic:false` choice now refuses unavailable online payment rather than silently creating an unpaid booking. Existing omitted/null legacy choices preserve compatibility.
- `backend/app/Services/Payment/PayMongoService.php`: configured capability also requires the webhook secret; this affects invoice method visibility consistently, not only booking.
- `backend/app/Services/Queue/QueueService.php`: one-line correction restores the frozen Called/Treatment Ready prerequisite for clinical start; no priority/order change or contract rewrite.

Legacy/noncanonical `In Queue` rows are not silently promoted to clinical care by this fix. Any existing such records need the queue owner's reconciliation with allowed transitions; no database normalization or historical repair was performed.
- `backend/routes/api.php`: Patient-only GET `/appointments/booking-options`, placed before dynamic appointment binding, inside existing authenticated/active-account middleware.
- New `backend/tests/Feature/Appointments/BookingIntegrationContractTest.php`: five tests for quotation, fail-closed explicit online payment, rollback/retry, dependent-vs-guardian conflicts and enumeration-safe unauthorized/revoked dependent refusals.
- `backend/tests/Feature/Reference/PublicContentPublicationTest.php`: one additional Owner verification/active HMO publication test.
- New `docs/DEV_A_01_R1_FAILURE_COMPARISON.md` and this document; original handoff amended to point here. Prior DEV-A-01 changes remain intact.

## D. Exact Developer B contract

### Booking and automatic assignment — Corrected / Verified with isolated fixtures

Authenticated Patient POST `/api/appointments` retains required `branch_ref`, `service_ref`, `date` (`YYYY-MM-DD`), `start_time` (`HH:mm`). Optional `dentist_ref` omitted or null means deterministic assignment. Optional notes, dependent `for_patient_id`, and boolean `pay_at_clinic` remain. Identity/status/amount are server-owned. Existing branch/service/availability, approved leave, schedules/breaks, Patient window/hour grid and concurrent exclusion protection remain; 422 observed schedule invalidation and 409 race/stale revision require refreshing, not success.

**New UI must always send an explicit payment choice:** `pay_at_clinic:false` for online, true for clinic. False with unavailable configuration returns **422 `payment_not_configured`**, with no booking. Omitted or null retains the old configured-online/unconfigured-unpaid behavior for existing consumers; it is not an explicit online selection. Do not use omission to implement the online button. Both Laravel boolean false and its accepted `0` representations follow the explicit-online path.

Pay at clinic is available in current implementation to eligible Patient bookings, including dependents, subject to all scheduling and attendance checks. It bypasses checkout, not fees or authorization. Clinic policy endorsement of that broad option remains separate from source behavior; no new eligibility policy is invented. A flagged Patient can be Pending/unpaid, rather than immediately Confirmed.

### Capability and fee quotation — Corrected (configuration truth, not provider uptime)

GET `/api/appointments/booking-options?branch_ref=b1&service_ref=svc1&date=2026-11-02`, optional `for_patient_id`. Sanctum Patient only. Required references/date have the same validation as availability. No secret/provider identifiers, clinical data, HTTP provider call, appointment, hold or audit mutation. Only existing PriceResolver confirmed/effective-dated price is used; reference/demo metadata is not authority. This is a snapshot; final create revalidates/reprices. A valid date is a pricing date, not a promise that scheduling permits it. Quote is not a price lock.

Sanitized illustrative response (fictional references/amount):

```json
{"data":{"branch_ref":"b1","service_ref":"svc1","date":"2026-11-02","currency":"PHP","booking_fee_php":"600.00","online_payment_available":true,"online_payment_unavailable_reason":null,"payment_methods":["GCash","Card"],"pay_at_clinic_available":true,"hold_minutes":15,"reserves_slot":false}}
```

Method labels are display strings from the existing Brand mapping, not tokens to submit. `booking_fee_php` is a decimal string or null. If unavailable, `online_payment_available:false`, methods `[]`, reason is `service_not_bookable_online`, `payment_not_configured`, `booking_price_unavailable`, or `amount_too_small`. An unpriced service may still support pay-at-clinic; never show a guessed fee. Service restrictions suppress both options. Capability validates local credentials/mode/methods/webhook configuration; it cannot prove account entitlements, provider uptime or deployment reachability.

Errors: 401 unauthenticated, 403 role/branch/dependent denial, 422 invalid/missing fields. Final explicit-online creation may return 422 `payment_not_configured`/`booking_price_unavailable`; provider failures 502/503 never mean an unpaid success. Handle the structured code, not a browser redirect. A config change between quote/create can invalidate the snapshot.

### Dependent availability — Corrected

Send the **same** optional public `for_patient_id` on `/api/appointments/availability`, `/recommendation`, `/branch-options`, `/calendar`, `/booking-options` and POST creation. Omit for self. Unknown, unrelated and ended guardian relationships return the same 403, without exposing existence or patient details. No `exists:patients` validator reveals whether that optional ID exists. Operational role availability still uses its existing authorized `patient_id`; Patient `patient_id` remains prohibited.

Scheduling searches now evaluate dependent overlaps, not guardian overlaps. Regression places a dependent and guardian in different cross-branch appointments and verifies each receives the appropriate slots. Calendar busy prefetch uses that selected patient; recommendation/branch ranking use the same context. On reschedule, authorized appointment context supplies patient identity and its existing Dentist; Patient cannot change its branch/service/Dentist through the reschedule write. Availability is a snapshot, and creation checks active guardianship again. Dentist-options is a provider eligibility list and does not apply patient conflict filtering.

### Payment, retry, statuses, invoice credit — Partially Verified

Configured online creation returns 201 Pending/held, checkout URL/session and server hold expiry (15 minutes). Pending can also be an attendance hold; Confirmed can be unpaid at clinic. Neither status means completed. Only verified server-to-provider settlement marks paid/Confirms online payment; redirect parameters are hints. Existing replay protection preserves terminal clinical state and routes late captured payments for review. Paid settlement's interaction with attendance-confirmation flags still needs policy reconciliation.

Provider checkout failure rolls the transaction back; tested retry with the same Idempotency-Key can create one Pending/held booking. After successful creation, reopen the returned checkout URL while held; refetch authorized appointment status. The current API does not expose a new failed-card event/retry command. A declined/abandoned checkout leaves a hold until expiry unless provider reconciliation proves payment. Scheduled `appointments:release-expired-holds` cancels expired held appointments and marks unpaid; actual release needs a running scheduler. After expiry refresh availability and create a new booking; never revive one from a return URL.

Existing cancellation: online Patient cancellation before start and check-in; paid cancellation at least 24 hours before start attempts full refund; later/no-show is forfeited/manual review. Refund submission is not completion. Pending/processing/failed provider responses retain payment state/reference; only succeeded marks refunded. Acknowledged refund reference is retrieved on reconciliation rather than another POST. No new refund worker/UI detail endpoint. Unknown transport outcomes need operator review; stable idempotency has finite retention. Existing invoice deposit credit is capped at Patient responsibility; excess/partial refund and post-credit cancellation policy need clinic decisions. No promise that a refund automatically reverses an already issued invoice/payment receipt. No live provider acceptance or refunds were tested.

### Patient treatment history — Verified with isolated fixtures

GET `/api/treatments/mine` remains authenticated-own-patient, Completed only, stable public treatment IDs, ordered keyset `(completed_at DESC,id DESC)`, `cursor` last public treatment ID, per_page default50/max100, `meta.next_cursor`. Unknown/foreign cursor empty equally. Same-day/equal-time rows remain distinct. Exact safe subset unchanged: `{id,date,procedure_summary,services:[{name}],dentist:{name}}`. Booking guardianship does not grant dependent clinical-history access. No Visit/appointment IDs or private clinical notes added. Frontend must keep separate record kinds keyed by IDs, follow cursors, avoid date joins/fabricated times/branch names and use actual appointment status.

## E. Public content — publication paths Verified; actual content Blocked

Owner-only FAQ/closure publication and active/non-draft filtering remain as previously documented. Accepted HMO writes are Owner-only `/api/accepted-hmos`; public `/api/public/hmos` and FAQ metadata expose only active `verified_by_clinic` rows. Verification requires an Owner PATCH with expected_revision; retained verification actor/time plus audit. Synthetic route tests cover hidden-unverified, visible-verified, withdrawn-inactive and non-Owner refusal.

FAQ/Owner closures have no independent second-reviewer gate. That is a missing independent review control, not a reproduced unauthorized publish exploit. HMO has an explicit clinic-verification flag, but Owner assertion is not independent factual proof. Wrong Owner-published text is stored-content integrity; React rendering it does not itself create publication authority. No authorization bypass was reproduced. No blacklist, bulk deletion or database cleanup was added.

Read-only verification against a coordinator-supplied approved QA API URL:

```powershell
$qaApi = 'https://APPROVED-QA-HOST/api'
Invoke-RestMethod "$qaApi/public/faq" | ConvertTo-Json -Depth 10
Invoke-RestMethod "$qaApi/public/closures" | ConvertTo-Json -Depth 10
Invoke-RestMethod "$qaApi/public/hmos" | ConvertTo-Json -Depth 10
```

Do not substitute localhost/shared DB credentials or run seeders. Record response time, public ID where available, branch/date/name/note, exact offending text and publication state; HMO public rows lack public IDs, so Owner maps name/branch to the administrative public ID using read-only authorized GET. Compare raw API output with browser render to isolate presentation errors. Obtain approval for exact corrections. FAQ: revision-checked deactivate/draft/review/publish; HMO: unverify/deactivate then review/verify with revision; closure: remove only if closure itself is invalid (changes booking availability); legitimate closure with bad reason needs a separately approved audited edit path. Preserve records/audit. Recheck corrected unauthenticated output and calendar behavior. **Reported inappropriate real content is not resolved or verified** without the approved URL, records and corrected response evidence.

## F. AttendancePolicy shared-file reconciliation — Blocked pending Developer B diff

Developer A changed only the class comment and `summary()` text. Eligibility, strikes, settings, limit/window, flags, clear command and stored records are unchanged. Summary now limits online cancellation to before scheduled start/check-in, describes Pending/Confirmed rescheduling, retains configured late_hours/limit/window_months, removes “anytime”/“no fees” and explicitly separates booking refunds. This serves public FAQ and booking/email copy, not financial enforcement. Regression checks the public API text when attendance policy is enabled.

Developer B's worktree/diff was not supplied or present in `git worktree list`; no B version was read or incorporated, so conflict compatibility is **Unverified**. Recommended resolution after reviewing B's exact diff: preserve their intended behavioral changes only if separately authorized/tested; keep all dynamic attendance values; avoid unlimited-cancellation/no-charge/refund guarantees; keep enabled=false summary null. If B also changed summary, combine the truthful semantics once instead of taking a whole-file “ours/theirs.” Run public-content and attendance/payment lifecycle suites against the proposed combined version. Do not merge here. Coordinator must resolve flagged-paid-online confirmation separately; wording must not claim that policy is already approved.

## G. Validation and safety

Restarted only the previously inspected `dental-dev-a01-scratch-20261031` container. tmpfs data, no persistent mounts, loopback port5432, actual IP172.17.0.2. Existing unmodified ScratchDatabaseGuard validates environment/config before connection and actual database/server identity before RefreshDatabase. Ignored synthetic test settings/provider keys only; no clinic `.env`, database, live provider/email or clinical records used. Baseline and current tests ran serially. The baseline worktree stayed tracked-clean.

Paired replay commands selected the exact original 43 failing/error names with an escaped PHPUnit --filter; baseline used the previously reflection-checked remapping bootstrap and exact detached HEAD. Logs: `%TEMP%/dev-a01-r1-current-replay.txt`, `dev-a01-r1-baseline-replay.txt`. New five-test suite passed 5/5, 50 assertions. Broader and final validation results follow below.

Executed checks (backend commands from `backend/`, serial guarded database runs):

```powershell
$env:TEST_SCRATCH_SERVER_ADDRESS = '172.17.0.2' # reinspect before reuse
# Build the same 43-name filter from the durable comparison document:
$names = Select-String ../docs/DEV_A_01_R1_FAILURE_COMPARISON.md -Pattern '^## Tests' | ForEach-Object { $_.Line.Substring(3) }
$filter = '(' + (($names | ForEach-Object { [Regex]::Escape($_) }) -join '|') + ')'
php vendor/bin/phpunit --filter $filter --colors=never
# In the untouched baseline worktree, same filter and synthetic environment:
php vendor/bin/phpunit --bootstrap "$env:TEMP/dev-a01-baseline-bootstrap.php" --filter $filter --colors=never
# In development worktree:
php vendor/bin/phpunit tests/Feature/Appointments/BookingIntegrationContractTest.php --colors=never
php vendor/bin/phpunit tests/Feature/Appointments tests/Feature/Payment tests/Feature/Visits tests/Feature/Staffing tests/Feature/Reference tests/Feature/Treatments tests/Unit/GeminiScratchGuardTest.php --colors=never
php vendor/bin/phpunit --colors=never
```

The baseline bootstrap reuses installed lockfile dependencies but remaps App/Tests/Database prefixes and optimized classmap entries to the baseline worktree, sets APP_BASE_PATH, and rejects unexpected class source paths by reflection. It does not replace baseline production source. Do not run the baseline through the development classmap without this source-path verification. Container identity, guarded settings and synthetic configuration must be independently checked first; the snippet is not permission to run against another database.

Frontend quality gate (repository root): `npm test`, `npm run test:smoke`, `npm run build`; passed 983/988 with five optional skips, 16 smoke scenarios and production build respectively. Existing React list-key/large-chunk warnings remain. `scripts/predefense-check.sh` with APP_ENV=testing and DEMO_DB=dental_clinic_scratch, without --send, returned nine failures/three warnings: intentionally absent running API/frontend/worker/scheduler, mail transport, provider credentials/tunnel and demo records. It is not a successful deployment gate, and its read-only content probes during the test run are not stable clinic-data evidence. PHP parser passed all 442 application/route/test files; whitespace and secret-pattern checks passed over seventeen changed/new files. No test guard or existing assertion was weakened.

## H. Readiness

No production/integration readiness claim. Booking/dependent/capability corrections require coordinator review. Exact live-content correction, B shared-file reconciliation, queue contract decision, financial-policy approvals, deployment/scheduler/provider verification remain outstanding. Original DEV-A-01 handoff retains its detailed invoice/refund and historical limitations; this R1 supplement supersedes its former dependent-search limitation and documents explicit-online behavior precisely.

| Contract / acceptance item | Classification | Limit |
| --- | --- | --- |
| Automatic assignment and conflict/leave enforcement | Verified | Isolated production-route fixtures, not deployment smoke |
| Dependent availability and authorization | Corrected | Same public dependent ID on all search/create calls |
| Explicit online capability and confirmed-price quote | Corrected | Configuration snapshot, no live account/uptime guarantee; omitted legacy choice remains compatible |
| Called/Treatment Ready clinical admission | Corrected | Restores frozen requirement; priority vocabulary/FIFO remains separate |
| Payment/refund/invoice financial lifecycle | Partially Verified | Mock provider checks; clinic decisions, live settlement, unknown refunds and post-credit policy unresolved |
| Patient completed-treatment privacy/identity/cursor | Verified | Own patient only; frontend must preserve distinct IDs |
| Public publication authorization/filtering | Verified | Owner-as-publisher; no independent FAQ/closure second-reviewer gate |
| Actual reported inappropriate public records | Blocked | Approved QA URL/current records/corrected unauthenticated output absent |
| Developer B AttendancePolicy combination | Unverified | Exact B diff/SHA unavailable; no merge performed |
| Production/integration approval | Blocked | Suite discrepancies, policies and deployment gates outstanding |

Final repository inventory is eleven modified tracked files and six new untracked files (seventeen total), no staged changes. In addition to the R1 file list in section C, preserved earlier changes include SchedulingService, AttendancePolicy, AppointmentBookingPaymentTest, TreatmentTest, PatientBookingContractTest and the original handoff.

### Final validation disposition

- Final full backend: **963 tests, 922 passed, 40 failed, one error; 10,491 assertions; 18m29s**. All 24 tests added across both batches passed. Both unchanged Waiting-start tests now pass after the one-line frozen-contract correction.
- Of the final 40 failures, **39 have an untouched-baseline reproduction**; the one missing-table error also reproduced on baseline. AccountRecovery's superseded-mail-job assertion recurs only under the full run and remains **not conclusively classified**. No confirmed R1 regression is being hidden in a generic “all baseline” count. Selected paired replay passed that test on both sources; the full baseline AccountRecovery class also passed 23/23 (195 assertions). It needs suite-order/worker-state investigation outside booking, with mail safety intact.
- Newly observed AuditQuery date-filter failure: current full run and current seven-test AuditQuery class fail identically; untouched baseline exact-test replay also fails identically. It is pre-existing, outside booking changes. The new full run occurred after Manila midnight, on the next clinic day compared with the earlier full run; offset-free query date binding is the implicated boundary path. Precise test/message and action are included in the comparison report. No audit record or historical timestamp was changed.
- Broad contract run before the clinical guard was reloaded: **311 tests, 310 passed, one failed, 2,732 assertions**; sole failure was the now-corrected Waiting refusal. Final full run verifies the correction and all new tests together; no assertions were weakened.
- Frontend: 983 passed, five optional skips, zero failures; smoke 16 PASS; production build passed. Deployment/predefense gate remains nine failures/three warnings against synthetic scratch state. PHP parser 442 passed; diff/secret-pattern checks passed.
- Logs outside Git: `%TEMP%/dev-a01-r1-full.txt`, `dev-a01-r1-contracts.txt`, `dev-a01-r1-new-tests.txt`, `dev-a01-r1-audit-current.txt`, `dev-a01-r1-audit-baseline.txt`, `dev-a01-r1-auth-baseline.txt`, `dev-a01-r1-auth-current.txt`, and the frontend/smoke/build/predefense logs with the same prefix. No generated logs, configuration or dependency artifacts are staged.

This is a reviewable local correction batch, not a green integration or production gate. Retired-route/table failures, queue vocabulary/priority/timezone discrepancies, the unresolved full-run mail assertion, financial decisions, actual public content and B's shared-file diff remain open.

Final follow-up: AccountRecovery whole-class replay passed **23/23, 195 assertions on each checkout**; its full-suite-only failure remains inconclusive. After all tests, stopped only the disposable `dental-dev-a01-scratch-20261031`; verified exited, tmpfs configured, no persistent mounts. Baseline worktree remains tracked-clean; development HEAD/branch unchanged, eleven tracked modifications/six new files, nothing staged. No commit or remote operation.
