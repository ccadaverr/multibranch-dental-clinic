# Prescription search and paging v1

Clinical-branch candidate, November 17, 2026, Asia/Manila. Additive to the existing prescription read API; no schema or authorization expansion.

`GET /api/prescriptions` accepts optional `q` (string, at most 120 characters), `page` (integer 1–100000) and `per_page` (integer 1–100). Existing `patient_id`, `visit_id` and `status` filters compose with search. Search is case insensitive and treats SQL wildcard characters as literal input. Number, branch and Dentist name are searchable; Patient name is searchable only by existing authorized Staff/Dentist readers. Medicine, dose, instructions and notes are never searchable. Owner receives the established metadata projection only.

Supplying either paging argument opts into paging (defaults: page 1, 20 rows). Results retain descending database ID order and the existing public record identities. The response has `data` plus integer `meta.current_page`, `meta.last_page`, `meta.per_page`, `meta.total`. Last page is at least 1; a page past the current last page returns an empty collection with the actual total/last page. Invalid input returns 422. Existing role/session/branch middleware and controller scope remain authoritative. A scoped search with no authorized matches returns an empty page, without revealing foreign records.

With neither paging argument, the existing bounded maximum of 200 records remains for compatibility. The exact-encounter reader remains on that contract and continues to refuse a potentially truncated result. Do not infer pagination from a legacy response or silently fall back to a truncated search.

The new list UI opts into paging, validates metadata and every record before adoption, discards results from earlier filters/session generations, resets page on filter changes and supports explicit reload/retry. Offset pages are current projections, not an immutable export snapshot. Concurrent inserts/status changes can change totals or page composition; retry reads current state. No clinical write is performed by searching, paging, opening or reloading.

`GET /api/me/prescriptions` keeps its existing own/dependent Issued/Void collection and fields. It now explicitly returns `Cache-Control: private, no-store` and eager-loads Visit identity. The Patient UI requires the accompanying Family response to confirm `meta.me.id` against the current Patient, verifies every returned Patient/Visit/branch and forbids Draft/malformed/duplicate records. Reads and PDF adoption are bounded and tied to the current session. It introduces no Patient write authority.

Integrate the controller and new UI/helper together; an older backend without page metadata produces an explicit verification error. No routing/API-client/shared-style change is required. Preserve all existing issue/Void revision, idempotency, immutable-history and direct-record authorization tests. All four held migrations and the uninstalled conversation grant schema remain outside this contract.

Evidence: `PrescriptionSearchTest.php`, existing `PrescriptionTest.php`/`PrescriptionRecoveryTest.php`, `tests/prescription-list.test.js` and `tests/local-prescription-search.browser.mjs`. See the dated sprint report for actual results and limitations.
