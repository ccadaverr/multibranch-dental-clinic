# Codex B Round 4 audit and notification QA

Starting branch `feature/joevan-qa-20261115`, HEAD `1b521b886c54fa0c222c640551431f3b191fc7e0`.

## Original criteria and acceptance

- **GEN-11** requires server-side archive visibility and protection against direct-ID bypass. An audit list filtered by a real branch public ID returned both branches when a second branch's legacy reference used that same value. Audit list and CSV now resolve one branch using the existing M2 public-reference contract and apply its internal ID. PostgreSQL proves the exact selected audit event ID is the only list and CSV row. Owner authorization, exact event and cursor behavior, and append-only history retain their existing tests.
- **GEN-10** requires notifications grouped under date headers and an endpoint sorted by date, with recipient-owned archive and read actions. The latest page previously led with an old event inserted late. Active and archived pages now order by recorded timestamp, then ID for ties. The recipient-scoped cursor keeps the database timestamp offset and remains valid when its anchor is archived. PostgreSQL confirms Manila midnight, tied instants, all 107 unique IDs across three pages, rejection of a foreign cursor, and recipient-only archive replay.
- **GEN-10** also requests mark-as-read where it fits. A rejected read request with another account's cursor previously changed the notice before returning 404. Single and bulk reads now resolve and validate the response filters before writing, and generate the response inside the write transaction. Tests prove a rejected single or bulk request leaves unread state intact, retries keep the first read timestamp, and an inactive account cannot read or mutate history.
- **OWN-01** requires exact billing values on the Owner charts. Review and regression covered the accepted branch/period scope, persisted figures and CSV transport. PostgreSQL's branches_name_unique constraint rejected an attempted duplicate-name report-order fixture. The probe was removed. No independently actionable report/export change remained.
- **GEN-02, GEN-13, STF-25 and DEN-16** retain scoped acceptance for the audit clear and keyboard refresh controls and the permitted Staff/Dentist archive detail paths. Browser checks exercised the existing controls. The report does not claim global all-dashboard acceptance.

GEN-11 remains partial. The Owner/DPO and team need an approved entity-by-entity visibility, retention and restoration policy that identifies authorized actors, preserves patient/clinical/recipient boundaries and defines restore conflict handling. The original universal visibility and permanent removal wording conflicts with the operative privacy and no-hard-delete rules. The bounded appointment history does not establish a full historical archive. GEN-10 broader shell acceptance and real deployment remain integration checks. Jaztin's latest Mac reconciliation was unavailable.

## Verification

- B-only PostgreSQL on container loopback 55517, using the guarded `dental_clinic_test` profile. Three failures reproduced before edits. Broader post-fix run had 57 passes and one inherited failure. The automation-health fixture still expected HTTP 201 from its setup endpoint and received 404. Explicit rerun excluding that one test passed **57 tests, 864 assertions** across audit, operational archive, notifications and analytics. No migration was run. The four holds were retained and B stopped its runtime after verification.
- Focused Node regression **72 passed**, one opt-in browser group skipped in that invocation and exercised separately. Synthetic Chrome passed Owner audit filter/refresh keyboard controls, export cancellation, replacement and revoked-Owner refusal at 390 and 1440 px. Internal notification recovery passed at both widths. Patient notification focus/overflow checks passed at 390, 768, 1024 and 1440 px. Archive detail, branch selection and scoped CSV passed at 390 and 1440 px. No UI source changed.
- PHP lint, scoped diff whitespace and credential-pattern scan passed. Global frontend, smoke, build and local predefense are recorded in A's Round 4 coordination file. Final combined acceptance and any hosted verification belong to A.

## Handoff to Codex A

**READY.** B's six files are frozen. Stage only these paths for the Round 4 B changes:

- `backend/app/Http/Controllers/AuditController.php`
- `backend/app/Models/AuditLog.php`
- `backend/tests/Feature/Audit/AuditQueryTest.php`
- `backend/app/Http/Controllers/NotificationController.php`
- `backend/tests/Feature/Notifications/NotificationHistoryTest.php`
- `docs/coordination/JOEVAN_CODEX_B_ROUND4_20261116.md`

No shared-file wiring is needed. A-owned files, routes, runtime configuration, shared databases and Git state were untouched by B.
