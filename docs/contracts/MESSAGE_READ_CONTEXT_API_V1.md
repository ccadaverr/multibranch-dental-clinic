# Message read context — v1 (implemented)

2026-11-16 Asia/Manila. Shared Staff/Dentist/Patient messaging read contract, owned Clinical change. No message sending, Dentist-switch policy, notifications, archival or workforce changes.

Existing `GET /api/conversations` retains `q` (keyword/contact), cursor, per-page, summary-only rows and authorization. Existing `GET /api/conversations/{conversation}/messages` retains ordinary/cursor history, keyword `q`, and newer-message `after` modes. Each successful message result now includes:

```json
{"data":[],"meta":{"context":{"conversation_id":"exact conversation ULID","patient_id":"exact Patient ULID","branch_id":"existing branch legacy_ref"}}}
```

Existing pagination metadata is retained, including `order`/`more` for newer-message reads and `next_cursor` for history/search. Context is emitted even for empty results; it is derived from the route-bound conversation after authorization. Inbox and message reads are `Cache-Control: private, no-store`.

Existing server rules remain: Patient own conversation plus participation; Staff authorized branch scope; Dentist branch plus participation; Owner denied. Cursor/after lookup stays within the exact conversation. Search decrypts existing encrypted history in bounded chunks and returns a limited page, not exported bodies in inbox summaries. No production-scale benchmark or external transport availability is claimed.

`messaging-api.js` validates conversation, Patient and branch context before adopting ordinary, search or newer-message rows. The selected summary supplies expected Patient/branch. Missing/foreign context is an explicit unconfirmed error, including empty responses. The existing page request/query/selection/access-version/auth guards suppress delayed responses. A separate read-deadline helper bounds each read at 30 seconds without introducing another polling loop or blind retry. Existing central refresh and polling authority remain intact. These are read operations; no command key, resource revision or migration is added.

The new frontend requires the backend context contract. Deliver compatible backend and frontend together; an older target fails safely with unavailable-message feedback. Existing callers of `loadMessages`/`loadNewerMessages` can omit the optional expected-context argument but still require a matching conversation ID and populated server Patient/branch proof. No send/close/add-Dentist mutation contract changed.

Evidence: [Batch07](../JAZTIN_CLINICAL_BATCH07_20261116.md), PostgreSQL all-mode exact context and existing encrypted-search/authorization/cursor tests; Node mismatch/lifetime/deadline checks and actual role-specific browser search. STF-23's bounded search criterion is separate from DEN-14's unresolved STF-21 active-Dentist contract.
