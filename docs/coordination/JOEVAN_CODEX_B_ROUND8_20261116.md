# Codex B Round 8 independent acceptance

Starting HEAD `ba675ff8dde0531151d3a724ac2f91124e5bfc97` on `feature/joevan-qa-20261115`. Round 7 was accepted as `b6e2fc9`.

- `docs/coordination/JOEVAN_CODEX_B_ROUND8_20261116.md` for the security and integration evidence manifest.
- `docs/coordination/fixtures/AppointmentReadPrivacyProbe.php` for the opt-in, synthetic reproduction and proposed acceptance assertions. B will copy it to its private test volume only. It is outside normal PHPUnit discovery.

B claims no application files or existing tests. A owns the appointment change, route/controller review and Git. B reserves its existing isolated PostgreSQL port 55517 and private browser fixture port 5197.

## Direct appointment GET

[AppointmentReadPrivacyProbe.php](fixtures/AppointmentReadPrivacyProbe.php) uses the existing two-branch scheduling fixture, a synthetic private note, a known foreign ULID, a generated absent ULID, and an existing row's internal numeric ID. It uses the production error shape with debug disabled. This is an API test with seeded identities, including a simulated signed-in session that is then deactivated, rather than a browser login.

| Scenario | Starting HEAD response | A candidate response |
| --- | --- | --- |
| Own Patient, in-scope Staff, assigned Dentist, and Owner in the other branch | 200, JSON `{data: …}` with exact public ID, patient and branch and the normal history/booking payload | 200, same authorized fields and identity |
| Another Patient, another branch, another Dentist assignment | 403, `{"message":"This action is unauthorized."}` | 404, `{"message":"Appointment not found."}` |
| Staff branch assignment revoked in the database | Old branch 403. The new authorized branch returns 200. | Old branch gets the same generic 404. Newly authorized branch returns 200. |
| Active account and missing public ID | 404, Laravel message naming the Appointment model and echoing the submitted ID | Same generic 404 as an existing out-of-scope record |
| Owner submits internal ID | 404, Laravel message naming the Appointment model and echoing the submitted number | Same generic 404. No bigint lookup. |
| Revoked signed-in account, existing and absent IDs | Existing gives 403 with `message` and `code=session_revoked`. Absent gives the model-binding 404. | Both give the same 403 session-revoked JSON |
| Guest, existing and absent IDs | Both 401, same unauthenticated response | Both 401, same unauthenticated response |

Denials had no appointment payload, synthetic private note, patient identity, branch data, history, or debug trace. The baseline still provided an existence signal for a supplied candidate ID, even to the revoked session. Echoed IDs came from the request, rather than disclosing a new record ID. The probe tested a known foreign ID against one generated absent ID and a numeric input. It did not attempt a mass scan or measure timing.

The baseline [GET route](../../backend/routes/api.php#L368) implicitly bound globally before the [show authorization](../../backend/app/Http/Controllers/AppointmentController.php#L81). [AppointmentAuthorizationTest](../../backend/tests/Feature/Appointments/AppointmentAuthorizationTest.php) expected the 403 on direct foreign reads. [AppointmentPolicy](../../backend/app/Policies/AppointmentPolicy.php) and the existing [visibleTo scope](../../backend/app/Models/Appointment.php#L101) preserve own and active-dependent Patient access, explicit Staff branch scope, assigned Dentist and all-branch Owner. The smallest correction is specific to this read. Let the route pass the public ID to the action as a string; resolve inside existing read scope after the account guard, keep the existing policy check and emit the same generic 404 for all record denials. Preserve the permitted resource, history, held-payment synchronization after authorization, guest and revoked responses, and independent named mutation/PDF contracts.

A implemented that correction and owns all application and existing contract-test edits. B independently ran the fixture before and after copying A's candidate controller into B's private volume. Baseline **one pass, one intentional privacy failure, 87 assertions**. A candidate **two passes, 91 assertions**. Tested candidate controller SHA-256 `52ce02bd44b04574f9d4ad96927fb4f995e52bf7b8cbcc608de3f7c72294f896`. This verifies the bounded correction on the candidate. It does not establish authorization concealment on other appointment endpoints or on the eventual integrated build.

To rerun, copy the fixture into a private test runtime at `backend/tests/Feature/Archives/AppointmentReadPrivacyProbeTest.php` and pass that exact file to the guarded runner. The filename ending in `Test.php` is required there. The evidence fixture stays outside normal discovery. A owns the active feature regression.

## Retired-route failures

The [singular monitor](../../backend/routes/api.php) was deliberately removed in `84a9965`. The plural scheduled settings routes administer different jobs. The Owner executive summary is a verified aggregate health replacement, already adopted for the three equivalent assertions in Round 6. The normal Audit Trail export and billing analytics CSV have distinct row contracts. The 15 checks below still fail with **404** on the first assertion. Abbreviations link to the test source: [C, AutomationControlTest](../../backend/tests/Feature/Automation/AutomationControlTest.php) and [T, AutomationTruthfulnessTest](../../backend/tests/Feature/Automation/AutomationTruthfulnessTest.php). Retired paths below are relative to `/api/automation/`.

| Case and failing assertion | Endpoint | Intended behavior and current replacement | Contract and security implication |
| --- | --- | --- | --- |
| C `test_unauthenticated_cannot_access_automation_endpoints`, line 30 expects 401 | GET snapshot | Guest cannot access monitor, rules, actions or dispatch. Current supported routes enforce their own guest authorization. | Exact retired monitor contract absent. Preserve guest denial on any replacement. |
| C `test_staff_and_dentist_and_patient_are_forbidden_from_automation`, line 39 expects 403 | GET snapshot | Non-Owner monitor denial. Owner executive-summary authorization exists separately. | No current monitor. Preserve role boundaries. |
| C `test_owner_can_view_automation_rules_and_snapshot`, line 52 expects 200 | GET snapshot, then rules | Owner sees full snapshot and known rules. Only aggregate health/scope has an equivalent. | Per-rule/recent-action visibility requires an explicit allowlist. |
| C `test_owner_can_trigger_manual_evaluation_and_audit_is_created`, line 150 expects 201 | POST dispatch | Owner triggers a Warning evaluation with audit evidence. Supported internal event evaluation still writes audit records. | Manual HTTP trigger has no replacement. Do not expose generic rule execution. |
| C `test_csv_export_neutralizes_formula_injection`, line 176 expects 200 | GET export-csv | Export workflow-action CSV with formula protection. Other CSVs have separate contracts. | No current workflow CSV. Preserve spreadsheet formula neutralization if approved later. |
| T `test_the_api_marks_every_action_row_as_evaluation_only_and_keeps_historical_text_unchanged`, line 91 expects 200 | GET actions, then snapshot | Exact historical text with evaluation-only qualifiers. Persisted event history exists without this HTTP representation. | Reviewed projection would need immutable source text and truthful execution labels. |
| T `test_manual_dispatch_refuses_clinical_flags_and_every_foreign_field`, line 142 expects 422 | POST dispatch | Refuse forged clinical and actor fields. No public equivalent. | Any future command must derive authority and reject caller-supplied clinical decisions. |
| T `test_manual_dispatch_validates_each_rule_observation`, line 158 expects 422 | POST dispatch | Rule-specific observation validation and supported positive inputs. Internal rules validate persisted observations separately. | No equivalent request contract. Require explicit allowlists and missing-data handling. |
| T `test_the_manual_message_says_evaluated_not_executed_and_the_event_stores_no_email`, line 181 expects 201 | POST dispatch | Truthful wording and absence of email in the synthetic event. No current manual response. | Payload privacy and truthful execution wording remain required. |
| T `test_only_the_owner_may_dispatch_and_authorization_precedes_validation`, line 194 expects 403 | POST dispatch, then GET snapshot | Denied actors cannot reach validation. No public dispatch replacement. | Any replacement needs auth before validation and no existence leak. |
| T `test_manual_dispatch_is_rate_limited`, line 207 expects 429 | POST dispatch | Rate-limit repeated manual requests. No current trigger. | Rate and resource bounds require a reviewed contract if a trigger is ever approved. |
| T `test_audit_events_carry_no_event_body_and_the_csv_marks_evaluation_only`, line 275 expects 200 | GET export-csv | Audit payload sanitization assertions still run; the legacy CSV execution marker has no equivalent. | Retain audit minimization and explicit evaluation labels for any approved export. |
| T `test_legacy_descriptions_are_qualified_inside_the_csv_cell_and_in_the_exception_projection`, line 294 expects 200 | GET export-csv, then snapshot | Qualify old descriptions without rewriting their history. No current CSV or exception projection. | Preserve immutable original text and distinguish proposed actions from actions actually taken. |
| T `test_repeated_manual_dispatches_are_independent_evaluations_with_no_idempotency_contract`, line 305 expects 201 | POST dispatch | Independent manual evaluations. Supported internal event replay has a different identity contract. | Do not reuse this expectation for operational retries. A future command needs explicit replay semantics. |
| T `test_manual_dispatch_refuses_unexpected_top_level_fields_too`, line 326 expects 422 | POST dispatch | Reject injected top-level identity, branch and status fields. No current command equivalent. | Reject authority and status supplied by the caller in any approved replacement. |

These failures describe retired contracts. No active endpoint needed restoration, and no unconverted test had a genuine equivalent covering all substantive assertions. The inherited tests remain visible with no changes or exclusions.

## Acceptance checklist after safe integration

- **Role/branch fixture** Use an isolated synthetic runtime and the [two-branch SchedulingFixture](../../backend/tests/Feature/Appointments/SchedulingFixture.php). Test distinct accounts and fresh sign-in for Patient, Staff, Dentist and Owner. Verify active dependent access and revocation, explicit Staff authorization scopes independent of assignments, assigned Dentist reads, Owner authority, and the direct appointment probe's exact denial parity. Exercise the actual integrated login and UI separately from the HTTP fixtures.
- **GEN-10** Run the [snapshot, archive, recipient refusal and replay regressions](../../backend/tests/Feature/Notifications/NotificationArchiveTest.php) with archival capability enabled. For the Clinical/Patient UI, compare actual component ownership and established route capability before exposing Archive. Preserve the exact recipient/public ID, `collection` and Manila timestamp/ID cursor. One archive receipt must confirm that ID and metadata without fabricating a read event. After a dropped response, retry the same ID, reopen the Archived collection in a fresh authorized session, and verify recipient-only visibility. On account/scope change or revocation, clear prior content and retry affordances. Check keyboard activation, focus recovery and responsive presentation across roles. Archived recipient records are still private.
- **OWN-01** Use [persisted settlement and refund evidence](../../backend/tests/Feature/Analytics/OwnerDashboardEvidenceTest.php) and [controlled-date rendered checks](../../tests/owner-analytics-rendered.mjs). Reconcile each tooltip row and total to exact pesos, branch filters and Manila dates across weekdays, Saturday and Sunday rollover. Verify empty, retry, and stale-branch refusal. The [A4 contract](../OWN01_A4_ACCEPTANCE.md#saturday-semantics-and-acceptance-boundary) is on-demand Saturday availability. A background task is outside that contract.
- **STF-25 / DEN-16** Run [archive exact-resource checks](../../tests/arc02-archive-scope.test.js) after comparing authentic Clinical source and DTO usage. Verify precise collection, record, patient and branch identity, denied search results and invalidation after branch or session change. Keyboard Enter must open the exact permitted record. Escape must return to its View button. Confirm Dentist scope, financial exclusion, and a disabled restoration action where policy is absent. The browser fixtures are synthetic. Run an authorized real cross-role journey after integration.
- **GEN-11** Hold broader entity visibility, retention and restoration until approved. Do not infer Owner authority over private records from notification/audit acceptance. Keep the retired failure ledger and appointment probe results alongside any integrated QA report.

## Commands and results

- Guarded PostgreSQL command inside `dentalops-codex-b-20261116`: `python3 scripts/local-system.py --target /private/audit-b-full/target.json --profile test test`, followed by the explicit filenames.
  - `tests/Feature/Archives/AppointmentReadPrivacyProbeTest.php`: baseline **1 pass, 1 intended failure, 87 assertions**. Candidate **2 passes, 91 assertions**.
  - On A's candidate, `tests/Feature/Notifications/NotificationArchiveTest.php tests/Feature/Notifications/NotificationHistoryTest.php tests/Feature/Notifications/NotificationIntegrationTest.php tests/Feature/Audit/OperationalArchiveScopeTest.php tests/Feature/Archives/ArchivesIsolationTest.php tests/Feature/Appointments/AppointmentAuthorizationTest.php tests/Feature/Analytics/OwnerDashboardEvidenceTest.php tests/Feature/Analytics/AnalyticsComparisonTest.php`: **47 passes, 759 assertions**, zero failures or skips.
  - `tests/Feature/Automation/AutomationControlTest.php tests/Feature/Automation/AutomationTruthfulnessTest.php`: **14 passes, 15 failures, 143 assertions**, zero exclusions. `php artisan route:list --path=api/automation --except-vendor --no-ansi` showed the four current plural settings routes only.
- `node --test tests/notif01-server-feed.test.js tests/notif02-patient-notifications.test.js tests/notification-date-groups.test.js tests/arc02-archive-scope.test.js tests/owner-revenue-analytics.test.js tests/owner-analytics-a5.test.js tests/owner-report-export.test.js`: **55 passes**, zero failures and one opt-in browser case, exercised separately.
- Synthetic Chrome at **390 and 1440 px** on private Vite port 5197. Invoked `runArc02ArchiveScope(page, base)` and `runOwnerAnalyticsAcceptance(page, base)` at both widths. The Staff and Dentist archive buttons opened the exact record with Enter and restored focus on Escape. `node tests/notification-history-recovery.browser.mjs <playwright-index.mjs> http://127.0.0.1:5197` passed both widths after a cold-start navigation timeout and an unchanged warm rerun. Browser evidence is independent of the PostgreSQL suite.
- PHP lint, scoped whitespace and credential-pattern checks passed. B stopped its private services. No migrations or provider calls. No integrated suite, deployment or source transfer.

## Handoff to A

**READY.** The exact frozen B-owned paths are:

- `docs/coordination/JOEVAN_CODEX_B_ROUND8_20261116.md`
- `docs/coordination/fixtures/AppointmentReadPrivacyProbe.php`

Starting and final observed HEAD `ba675ff8dde0531151d3a724ac2f91124e5bfc97`. The privacy correction tested above belongs to A's worktree. B made no Git mutations and left existing test assertions untouched. No shared wiring is requested for the evidence package. Hold Patient/Clinical integration claims until authentic source and end-to-end acceptance are available.
