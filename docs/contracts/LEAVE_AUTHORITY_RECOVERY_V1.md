# Leave mutation authority and audit — v1 continuation

Batch05 continuation: the legacy revision/recovery limitations below are historical. [Leave command API v2](LEAVE_COMMAND_API_V2.md) now implements required lifecycle revisions, encrypted exact replay receipts, migrated consumers and transactional follow-on intents. Original policies remain unchanged.

Implemented on Joevan's local feature branch, awaiting integration. Existing routes, JSON inputs, states and eligibility remain unchanged:

- `POST /api/leave`: existing linked Staff/Dentist requester, validated dates/times/type/private note. Returns201 with Pending leave.
- `POST /api/leave/{public_id}/decide`: existing authorized Owner, or branch-scoped front desk only when the Owner's existing setting allows it; body `{decision:"approve"|"decline"}`. Returns Approved/Declined. No self-approval.
- `POST /api/leave/{public_id}/cancel`: existing requester or authorized approver; only Pending/Approved future-ending leave. Returns Cancelled.

All three now lock the acting user before resource mutation, then recheck current Active state, authentication revision, role and Person identity against the authenticated request. Decision/cancellation also recheck their existing branch/approver/ownership rules against the locked current leave. Authority lost while waiting returns403 without a state or completion-audit write. Actor lock precedes leave lock. Existing state guards continue to reject already-decided/ended resources with422.

Request creation, approval, decline and cancellation commit atomically with their existing audit event; audit failure rolls back the mutation and decision/cancellation metadata. Follow-on notifications remain after this transaction as before. No new leave balances, coverage policy, Staff duty publication or clinical appointment mutation is introduced.

**Recovery limits remain explicit:** these legacy routes do not expose a resource revision or durable operation replay receipt. Duplicate creation is protected by the existing overlap check but does not recover an original success receipt. Decisions/cancellation use existing locked state checks; stale/duplicate transitions return422, not a fabricated success or a new409 contract. Downstream notice/outbox recovery and a versioned request/decision interface remain future work. No blanket claim of fully idempotent leave completion.

No frontend migration or Jaztin consumer change is required by these authority/audit corrections. Shared `LeaveController.php` includes existing Dentist leave processing; changes are limited to lock-time authorization and audit placement. Existing approval effects on booking, cover suggestions, notices, private-note visibility and state enum meanings are preserved and covered by the unchanged `LeaveTest` regression. The separate patient-notify action is unchanged.

Evidence: `LeaveAuditAtomicityTest`, `LeaveTest`; five committed separate-request contention scenarios in `LeaveAuthorityContentionTest`, on a fresh guarded private clone. Original STF-08/OWN-12/OWN-10 remain integration-scoped; this hardening does not close all source acceptance or unresolved roster policies.
