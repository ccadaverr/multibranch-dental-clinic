# Batch09 controlled source integration

This is a local source candidate, not deployment, PostgreSQL acceptance or operational activation.

## Provenance

| Source | Exact accepted SHA | Source parent |
|---|---|---|
| Cumulative QA Batches01–08 | cbe33f1bad185745e98345e3e247257fc398fc88 | 9c642969829af5604811d4f3b74fefa9528bb14a |
| AUD-10 backend R2 | e2654fafb1d30b6e50d3c1e475b2a3c0af227457 | 15d626c03c97baf7198a7b7ca6dea2bec8f60836 |
| Shared booking frontend | f4749ddb8ec0a93fe88df9dbf0897579371b9718 | 15d626c03c97baf7198a7b7ca6dea2bec8f60836 |
| Clinical UI | 6ff3bf67483b3baa17ed15463948bb432e8ca050 | f4749ddb8ec0a93fe88df9dbf0897579371b9718 |

The isolated `integration/qa-fullstack-controlled-20261114` worktree starts at cumulative QA. None of the other three source commits was a QA ancestor or an already-applied patch. Each exact commit delta was applied once with three-way handling, in backend/shared/clinical order. Clinical's delta excludes its shared parent, avoiding duplicate application.

The resulting single local checkpoint has QA as its parent and records the other source SHAs as provenance. Those historical feature commits are not represented as merge ancestors. Existing source branches and worktrees are preserved; no merge into a release branch or remote publication is performed.

## Conflict decisions and compatibility corrections

Two actual conflict hunks in `ServerFollowups.jsx` were resolved together:

- Retain Clinical's row lifetime binding to task, Patient, branch, observed revision, service, due date and current scheduling actor. Keep QA's awaited `onReload` callback.
- Retain Clinical's current-state review, same-revision status refusal, visible uncertainty and review loading state. Keep QA's refresh icons, guarded list continuity and recovery focus behavior.

Shared booking applied cleanly to scheduling and appointment flow, but was also tested behaviorally. The immutable Check-In dispatch boundary remains unchanged: a reviewed revision is never silently replaced by a newer canonical row.

Combined testing exposed a patient-record Follow-up recovery omission already present in the QA parent: the row rendered a refresh control but its second call site did not supply `onReload`. It now supplies the awaited callback. After reload replaced that control, focus fell to the body; it now returns to the surviving, labelled patient Follow-ups section without stealing an existing valid focus. Uncertain contact remains protected and cannot trigger another mutation or selected booking.

The old M20 test lacked the selected-task helper/context. It now executes the actual selection helper and button callback with valid public identities, checks frozen capture, duplicate refusal and exact selection/prefill propagation, and retains all role/stale/pending assertions. No original requirement was removed.

## Activation and clinical invariants

- Selected-follow-up booking remains unavailable in the real Clinical UI. Including backend R2 source is not proof of deployed compatibility.
- Clinical UI does not forward caller/store capability claims into shared booking. Its actual unavailable form sends no booking POST and has no ordinary-booking fallback.
- The Clinical fixture supplies the actual shared appointment flow, so its negative activation result is not caused by a missing command implementation. Shared form/flow/transport tests use an explicitly synthetic fixture. Their successful POSTs are intercepted test traffic, not operational activation.
- Exact `followup_task_id`, `followup_expected_revision`, Patient/branch binding, stable idempotency and original `meta.followup_link` proof remain intact.
- A current task readback is not an original command receipt. Unknown outcomes and the reload/unmount recovery limitation remain visible.
- Ordinary scheduling and Check-In remain distinct from selected booking. No automatic admission is introduced.
- Batch08 messaging privacy, exact receipts, revision/context ownership, same-key retries and notification read evidence remain unchanged.

## Verification scope

The focused integration Node set covers both Follow-up row call sites, frozen task selection and shared booking, plus the actual Check-In navigation/HTTP boundary. Browser acceptance covers Clinical UI, shared form, ordinary scheduling, Check-In races, identity/HMO, prescriptions/encounters, leave, duty/roster, Dentist Schedule and messaging/notifications. Full frontend Node, render smoke and an isolated production build are the consolidated gates. Fresh counts and hashes are preserved in the Batch09 handoff, not inferred from historical reports.

Fresh consolidated results: **1,774 frontend Node passes, one unchanged OWN-11 failure, eight skips and two TODOs; 233 focused Node passes; 298 named browser cases plus18 workflow/viewport groups passed; render smoke and production build passed.** Counts overlap and do not represent separate QA closures.

All11 backend source/test/document files match accepted R2 bytes. Backend execution is not newly certified: the available PHP8.2/8.4 binaries fail dynamic loading on this host, and PHP8.0 is too old to parse the project's readonly constructor syntax. No backend Unit/Feature/worker test, Laravel bootstrap, migration or database operation was run. Historical backend acceptance documents retain their original evidence and limitations.

All86 migration files, held queue decisions, restricted fetch configuration and protected worktrees remain unchanged. `scripts/predefense-check.sh` is excluded because it invokes prohibited Artisan runtime checks. No provider, payment, email/SMS, deployment or push is part of this source checkpoint.

## Remaining acceptance

Full Staff roster/duty persistence and revision semantics require the original owners' approved contract. Notification archival/restore requires entity-specific privacy policy and supported endpoints. GEN-06/DEN-03 need their original reproduction evidence; broader GEN-09 needs supported benchmarks. Queue migration preservation, authenticated deployed compatibility, durable unknown-booking recovery and isolated PostgreSQL workflow/concurrency acceptance remain held.

The original68-issue inventory is not closed by this integration. Previously implemented QA slices now coexist in one source candidate; end-user and persisted-runtime acceptance remain separate.
