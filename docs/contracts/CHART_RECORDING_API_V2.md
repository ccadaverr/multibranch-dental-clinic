# Chart recording API v2 — implemented 2026-11-16 Asia/Manila

Clinical owner Jaztin. Supersedes **v1 write compatibility only**. No migration/notation/status change. Existing read routes, projections, immutable history, precise attribution, branch authorization and audit privacy remain as [v1](CHART_RECORDING_API_V1.md).

`GET /api/patients/{patient-public-ULID}/chart` for an authorized Dentist advertises:

```json
{"write_contract":{"version":2,"revision_scheme":"tooth_entry_count","idempotency":true,"requires_revision":true,"requires_idempotency":true},"tooth_revisions":{"36":2}}
```

Every `POST /api/patients/{patient-public-ULID}/chart` now requires **both** `Idempotency-Key` and original `expected_revision` (integer, minimum 0). Linked commands additionally require original `expected_treatment_revision` paired with the exact `treatment_id`. Keep the original Patient, FDI tooth, branch, finding payload, key and revisions across uncertain retries. No server or client reads the latest count to silently fill a missing/stale revision. Missing revision/key is 422, without an entry/audit/journal. Stale tooth/treatment is 409 `chart_revision_changed` / `chart_treatment_changed`. Distinct reviewed commands use distinct keys. Same-key/exact-payload replay returns the original 201 receipt without a duplicate append. A new key cannot bypass the revision check.

Source-supported safety defect: v1 permitted direct unkeyed/revision-free commands and older clients could append a whole-tooth finding after a newer observation. History survived, but the current projection could silently clear/supersede newer surface findings. The sole application mutation caller is `src/chart-command.js` via `recordChartEntry`; it already preserves its original key/revision and now requires actual v2 readiness. Old direct clients fail explicitly and must GET/review then submit a new confirmed command with their own key and observed revision. Read paths remain compatible. Already-committed v1 keyed receipts retain their original serialized v1 snapshot and remain verifiable as historical receipts; they never enable v1 writes. The new UI separately refreshes current v2 state after such recovery. No exception is retained solely for old clients.

Transactions, per-Patient/tooth advisory lock, linked Visit→Treatment lock order, CAS, command-key uniqueness and atomic audit/receipt remain. Completed clinical documentation is not modified by a chart append. Replay is the original snapshot; UI separately reads current state after uncertain recovery and requires review when the tooth has advanced or current read fails. New browser editor refuses v1/missing capability rather than claiming global safety on an older server.

Tests: `ChartCommandRecoveryTest` directly rejects legacy payloads and stale keys, including immutable-history/journal assertions. `DentalChartTest` and `ChartBe01AuditAtomicityTest` use newly reviewed independent intents; conflict/replay tests retain their original revision explicitly. Real `ChartCommandContentionTest` runs three two-worker scenarios on a private clone. The older scratch-reset `ChartBe02ConcurrentRecordingTest` expectations are updated from unsafe append-on-retry to CAS/replay; its legacy reset harness remains unexecuted on the held-migration target. [Batch06](../JAZTIN_CLINICAL_BATCH06_20261116.md) records actual evidence and limits.
