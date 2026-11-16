# Owner-mediated handoff to Joevan Codex A (notification contracts also to B)

Clinical start: `a60f7816af4e45ccdf811204de7e692e05e91c9e`. Expected Operations: `8de2cf3f37e8ae253ec8d918e3690bdde3a1b1cb`. Operations source has NOT reached this Mac. No automated message sent; owner copies this document through the approved ChatGPT channel. No credentials or private documents are included.

## Portable OWN-11 reproduction

From this Clinical checkout, run:

```sh
node --test --test-name-pattern '^OWN-11:' tests/staffing.test.js
```

Test: **OWN-11: work schedule supports both Dentist and Staff schedules with shift management and duty status**. It reads `src/pages/Staffing.jsx` as text. Fixture/initial data: the current source file only; no database seed, account, roster or browser state. Assertions, in order: `/Dentist schedules/`, `/Staff schedules/`, `/Staff work schedules/`, `updateStaffProfile(currentStaff.id`, `/Marked available/`, absence of `/Available \/ On-Duty/`, and `/Weekly roster coverage/`.

Expected locally: all source assertions pass. Actual: the third assertion (`tests/staffing.test.js:106`, `/Staff work schedules/`) fails; 0 passed / 1 failed. This is inherited and predates Operations receipt. It is a **source/contract drift signal**, not evidence that a real published-duty workflow fails. Joevan reports that actual workflow passes on Operations; please provide the exact file/ref, fixture, role/branch scope and request → approval → separate publication → effective-duty evidence. Do not rename a heading just to hide a contract mismatch.

Authority: original OWN-11 in `FINALS-QA-REVISIONS.md`; frozen `docs/architecture/CONTRACTS.md`; workforce authority and separate publication in `docs/INTEGRATED_ACCEPTANCE_RUNBOOK_20261116.md:I02`. Compare the actual combined component/API before replacing this static check with meaningful persisted acceptance. No Clinical workforce patch was made.

## Walk-in ordering / immutable history

Reproduce: `node --test tests/batch4b-operations.test.js`. At line24 the test expects **Walk-ins are queued behind scheduled arrivals and must not displace confirmed appointments**. Current `PatientFlow.jsx` instead states recorded arrivals and authorized queue controls. The owner has now explicitly approved arrival FIFO, without an automatic scheduled-first override; see `CLINICAL_OWNER_POLICY_DECISIONS_20261116.md`.

Current Mac evidence: `QueueService::positions()` orders `v.arrived_at ASC, q.queue_number ASC`, partitioned by Dentist queue; its preceding comment still describes priority/late ordering and conflicts with the SQL. The UI uses server position. This is bounded source evidence, not proof of branch-wide FIFO, manual prior/new-order history, or every queue transition. Please verify branch versus Dentist partition, equal-time stability, scheduled/walk-in arrival order, permitted reorder history, denied cross-branch changes, and Served-as-start on authentic Operations. Retain all four held migrations. The Clinical assertion remains red pending substantive acceptance, not because scheduled-first remains policy.

## DEN-14 notification and archive contracts

Owner approved exact conversation/Patient/branch/Dentist grants, atomic Staff reassignment with revision/reason and former-Dentist revocation. New Dentist alone receives subsequent Dentist-directed notifications. Old notifications retain audit evidence but cannot expose revoked content. Patient/Staff contracts continue; no Owner transcript grant. Current Clinical `NotificationCenter::messageReceived()` targets Patient only, and `staffNotice()` is the available identity-specific writer. Please provide B's new Dentist notification kinds, dedupe keys, target identity, authorization/revocation filtering, delayed-worker behavior and focused evidence. No competing edits to Operations notification/controller files.

Patient `src/patient/pages/Archives.jsx` remains unchanged pending authentic side-by-side comparison: own/dependent Patient scope, full paging/error state, read-only history, exact Invoice/Receipt/PDF identity and no implicit Owner access. Intake requests complete source, independent digest/ref/ancestry, migration inventory, file manifest and accepted logs. Reported bundle/digest in the intake JSON are **not receiver verification**.
