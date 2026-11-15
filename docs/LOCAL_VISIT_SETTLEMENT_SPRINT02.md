# Sprint 02 — local patient visit and settlement acceptance

2026-11-15, Asia/Manila. **FULL WORKFLOW LOCALLY ACCEPTED**, within the established scheduled-visit and full at-clinic Cash settlement contracts. This is local synthetic acceptance, not a hosted release, external payment acceptance or closure of all 68 original QA requirements.

## Starting checkpoint and scope

Git's registered worktree is `scratch/integration-abc-20261111/scratch/qa-fullstack-controlled-20261114`, branch `integration/qa-fullstack-controlled-20261114`. Starting HEAD `2b68c76d4d6f05d7077ffec3d8a313a3bd968c46`, parent `488a0df441eedd98dca564aafd94e3523b5dcf52`; index/worktree initially clean. Other registered worktrees and references were retained. No push, merge, deployment, external processor call or real financial transaction occurred. The single acceptance commit is the commit containing this report; its parent must be the starting HEAD.

The existing PHP 8.3.30/PostgreSQL18.6 environment was reused. UI/API processes were initially reachable, then no longer listening when browser execution started; the existing runner restarted them without reprovisioning. Mailbox/worker/scheduler were likewise resumed only after checking they were stopped. No global runtime/configuration replacement occurred.

## Implementation and end-to-end results

| Stage | Existing contract and work completed | Real browser/API/persistence evidence | Boundary |
|---|---|---|---|
| Appointment | Staff creates a scheduled appointment for an exact synthetic Patient, branch, service and Dentist. | Actual booking form → `POST /api/appointments`; double click; exact public Patient/branch IDs; authenticated GET after reload. | Staff pay-at-clinic booking. No external online booking payment attempted. |
| Staff intake | Established first-visit ID check, including required Other details and separate arrival confirmation. | Staff selects the appointment; missing ID-presented confirmation is refused; `POST /api/patients/{patient}/verify-id` records only ID type/Other description; reload reads the saved check. | Existing registered Patient; no invented medical intake fields or policy. ID images/numbers are not collected. |
| Check-In | Preserves reviewed appointment identity/revision and distinct admission. | Actual Confirm arrival → `POST /api/visits/check-in`; double click; GET Visit confirms exact Patient, appointment, branch, queue and recorded history. | Today-only admission remains enforced. No stale appointment auto-admission. |
| Dentist care | Uses the responsible Dentist's queue and established clinical commands. | Separate Dentist login, actual queue Call → `/api/queue/{id}/call`, Open encounter, Start Treatment, document `/api/treatments/{id}/document`, reload, explicit completion `/complete`; authoritative Completed readback. | Human-entered synthetic documentation and performed Oral Prophylaxis; no automatic clinical decision, medication, handover or new completion policy. |
| Billing | Replaces the fragile live Staff billing branch with a guarded server workspace. Corrects service/line-total mapping. | Actual completed-treatment worklist → `/api/invoices/from-treatment/{treatment}` → `/review` → `/issue`; M13 price version snapshots, exact procedure, quantity, identity, revision and totals; reload persists. | Existing M11 model and API retained. No second ledger, arbitrary pricing, tax or discount rule. |
| Settlement | Captures immutable intent, exact full balance and stable idempotency key. Latches same-tick duplicates; checks mutation receipt and fresh GET before success. | Actual Staff Cash confirmation → `/api/invoices/{id}/payment`; PostgreSQL stores payment, receipt, Paid/zero balance and history. Second journey deliberately drops the real response **after server commit**; UI withholds success, Retry same command uses identical key/body and recovers the same receipt. | Cash is a synthetic at-clinic collection. No actual money/provider transaction. Existing Card/POS, Bank Transfer and E-Wallet remain available with required reference; their backend paths are tested, not claimed live-browser collections here. |
| Patient receipt | Requires concordant stored payment/receipt evidence. Corrects Download Invoice vs Download Receipt labels and removes unsupported email-delivery claims. | Separate mobile Patient session, actual receipt details, actual downloaded PDF beginning `%PDF-`; reload and another new session preserve the exact receipt. Foreign Patient/Staff/Dentist reads are denied; unknown invoice is404; failed list read shows an error and Retry restores actual records. | Download/availability is verified; external email delivery is not. |

Two actual journeys produced `INV-2026-000004` / `RCT-2026-000003` and `INV-2026-000005` / `RCT-2026-000004`, each PHP1,000.00 from the existing demo M13 Oral Prophylaxis price. These are synthetic demo prices, not a newly asserted clinic price list. Direct SQL confirms each exact appointment/Visit/Treatment Completed, invoice Paid revision4, one Payment, one Receipt, and no remaining balance. Each invoice has `invoice.created → invoice.reviewed → invoice.issued → invoice.paid`; each queue has `queue.entered → queue.called → queue.served`. No historical queue meaning or append-only guard changed.

The UI retains valid payment/discount input after validation failures. Unknown/conflicting outcomes retain the original command; subsequent different actions are paused until retry/readback or reload. Requests recheck session ownership immediately before dispatch; obsolete results cannot update a different account/workspace. A contradictory mutation/readback never announces financial success. Server financial calculations remain authoritative; receipt comparisons use integer minor units.

Hick's Law: one next lifecycle action per invoice status. Tesler's Law: totals, identity, receipt evidence and recovery complexity stay in the backend/shared command boundary. Fitts's Law: standard reachable controls and single-column dialogs. No design-system redesign.

## Modules and original QA ledger

- **Staff:** live completed-treatment billing, review, issue, exact collection, recovery and PDF access completed; existing intake/Check-In exercised with persistence.
- **Dentist:** own queue → encounter → performed procedure → explicit completion exercised end to end. Existing clinical authority/immutability preserved.
- **Patient:** own persisted receipt, valid PDF, new-session availability, mobile presentation and failed-read recovery verified. No client-generated settlement.
- **Owner:** authorized financial GET verified; processing controls remain unavailable and backend operational-role restrictions remain. The existing Owner branch-update API retired the temporary synthetic branch after acceptance. No new Owner clinical/payment authority or financial navigation was introduced.
- **Billing/payment planning modules M11/M23:** the existing runtime `billing` identity remains unchanged. Suggested implementation-status wording: “Existing server invoice and full at-clinic settlement workflow locally verified end to end, including durable receipt/PDF and uncertain-outcome recovery; external online/provider and deployment acceptance remain separate.” Other module status totals are not promoted by this sprint.

Unique original QA evidence advanced/reinforced: **STF-04** (Other ID type with saved readback), **STF-11** (explicit ID/arrival admission safeguards; this sprint does not claim a new cancellation-policy decision), **STF-18** (established payment methods, real settlement/receipt). **GEN-09** and **GEN-12** gain evidence on the touched workflow only; broader efficiency benchmarks and all-screen accessibility remain partial. These are overlapping requirements, not five new closures. Historical master totals remain unchanged; no unsupported total closure count is published.

**Still open:** OWN-11/STF-07 full dated Staff roster policy/contract; GEN-06/DEN-03 original reproductions; GEN-09 broader metrics; notification archival/privacy/retention; clinical handover semantics; held migration diagnostics; AUD-10 durable/deployed activation evidence. Selected-follow-up activation remains closed. This sprint's ordinary appointment and settlement recovery do not establish exact selected-follow-up recovery.

## Database, synthetic setup and recovery

Verified private profile: loopback `127.0.0.1:55488`, owned cluster, `dental_clinic_demo` and `dental_clinic_test`, restricted `dentalops_app` role and protected identity marker. Existing5432/remote/real `dental_clinic` were not used. Both active ledgers remain83 entries. **No migration added or applied; all86 original migration files remain unchanged.** All four held files remain pending.

Because acceptance ran on Sunday, a distinct branch named “Synthetic Sprint 02 — not clinic hours”, its synthetic Staff/Dentist/Patient accounts and demo roster were prepared. Actual clinic hours were not altered. The guarded fixture creates prerequisites only: no appointments, visits, treatments, invoices, payments or receipts. First-visit ID and all lifecycle writes came from actual UI/API commands. After acceptance the Owner API marked the synthetic branch **Inactive**, retaining history and preventing it being offered as an active clinic. `visit-fixture` explicitly reopens only this fixture for another local journey.

Initial recoverable custom-format snapshot: `dental_clinic_demo-20261115T014533603978Z.dump`; further snapshots precede guarded fixture preparations. Hash/mode inventory: private `SPRINT02_BACKUPS.json`. Settlement contention used a newly restored independent cluster `contention-77d9e405`, then backed it up (`dental_clinic_test-20261115T020610197709Z.dump`) and stopped it. No broad rollback/reset/truncate or unsafe migration guard probe ran. Application fixture verification uses the permitted read-only marker/endpoint; the outer runner independently checks the physical data directory.

The first local predefense check correctly failed the temporary active fixture's missing clinic contacts. It was resolved by retiring the fixture through the existing Owner command; no fake clinic phone or weakened check was added. The accepted check covers the three actual active branch records.

## Fresh tests (separate from Sprint01)

| Lane | Result |
|---|---|
| Full PHP Unit, documented database-free clean environment |246 passed,1158 assertions;30 existing PHPUnit metadata notices. |
| Explicit28-file PostgreSQL regression |384 passed,4892 assertions; includes appointment lifecycle/authorization, visits/queue/treatment, intake, billing/documents, clinical/follow-up/prescription/records, schedules/branches, auth and communications. Exact selection in private `api-file-manifest.txt`. |
| Focused billing/API (overlaps regression) |47 passed,855 assertions. |
| Actual independent PostgreSQL settlement contention |1 test,888 observed assertions; two workers demonstrably wait on real locks in each of three scenarios. One collection/receipt/event per invoice. Poll-observation assertion count is timing-dependent. |
| Preservation migration verification |1 passed,9 assertions. |
| Actual migration/privilege guard verification |1 passed,14 assertions. |
| Frontend full Node suite |1807 passed, **one inherited OWN-11 failure**,8 skips,2 TODOs;1818 cases total. Sprint01 baseline was1799 passes with the same one failure. |
| Focused financial command/UI tests |31 passed; exact receipts, stale/contradictory evidence, duplicate latch, same-key retry, cancellation, auth/unmount and Patient evidence. Included in Node total. |
| Real browser |Two actual persisted journeys, including committed-write/lost-response recovery.17 additional responsive/visibility groups: Staff and Patient at375/430/768/1024/1440, keyboard details and field labels, Owner authorized read, three foreign-account denials, new Patient session, missing invoice and failed-read Retry. |
| Smoke / production build |Pass;17 smoke groups. Existing bundle-size warning remains. |
| Python local-runner tests |7 passed, including fixture wrong-profile and settlement wrong-clone refusal before mutation/worker launch. |
| PHP syntax / diff whitespace |Pass for all four new PHP files; `git diff --check` passes. |
| `scripts/predefense-check.sh --local-only` under verified demo profile |Pass, exit0; three honest warnings: external providers/delivery/tunnel omitted, branch3 email missing, assistant wording still drafts. |
| Held queue source diagnostics |7 cases, **four inherited failures**. Assertions unchanged; held migration never executed. |

Initial unit invocation mistakenly inherited `DENTALOPS_LOCAL_TARGET`; mock legacy scratch-guard tests therefore took the isolated branch and failed. The corrected documented database-free invocation passed246/246 without source/assertion changes. Source-location tests were updated for the extracted live billing component; confirmation tests now execute actual callbacks and the new lifecycle has behavioral tests. Initial browser-driver timing/navigation/PDF-inspection errors were corrected; the actual saved download bytes and final complete runs establish acceptance. No failure was counted as a pass.

Private evidence root: `/var/folders/r3/d09_14x17h91r2nd70qvhdsc0000gn/T/dentalops-system-sprint02-ip25u354`. Key artifacts: `journey.json`, `lost-response/journey.json`, both downloaded `payment-receipt.pdf` files, `PERSISTED_VISIT_SETTLEMENT.json`, `responsive-isolation.json`, screenshots, regression/guard/build logs and backup inventory. Contains synthetic operational evidence; never bundle runtime credentials, captured verification mail or dumps into Git.

## Reproduce and next sprint

See `LOCAL_FULLSTACK_DEVELOPMENT.md` for guarded fixture/browser/contention commands. For a new actual journey use a fresh private evidence directory; existing journey journals represent prior command results and resumable readback, not proof of a second new mutation.

Next complete business process: **Dentist prescription draft → explicit issue → Patient readback/PDF → authorized void/correction evidence**, using the established prescription contract and local worker. Preserve clinical decision authority. Full Staff rosters require their missing business decisions; selected-follow-up activation requires its separate acceptance evidence.

## Accepted file manifest

```text
backend/tests/Feature/Billing/SettlementContentionTest.php
backend/tests/Feature/Billing/VisitSettlementJourneyTest.php
backend/tests/Support/billing_settlement_worker.php
backend/tests/Support/local_visit_fixture.php
docs/LOCAL_FULLSTACK_DEVELOPMENT.md
docs/LOCAL_VISIT_SETTLEMENT_SPRINT02.md
scripts/local-system.py
scripts/tests/test_local_system.py
src/api-client.js
src/billing-command.js
src/pages/FinanceCommunication.jsx
src/pages/ServerBilling.jsx
src/patient/pages/Billing.jsx
tests/batch4b-operations.test.js
tests/billing-command.test.js
tests/billing-ui.test.js
tests/local-visit-support.mjs
tests/local-visit-visibility.browser.mjs
tests/local-visit.browser.mjs
tests/m11-billing.test.js
```

Local acceptance creates one commit only, with this explicit manifest. Executable Git hooks were inspected: only inactive `.sample` hooks exist. Known secret values/private-key patterns are scanned before staging. The final commit SHA, content hashes, parent/ref checks and clean-status evidence are recorded outside Git to avoid a self-referential commit hash.
