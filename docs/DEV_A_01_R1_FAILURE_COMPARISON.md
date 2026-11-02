# DEV-A-01-R1 paired backend failure comparison

R1 final-source note: after these paired runs, the Called/Treatment Ready prerequisite was restored in QueueService to match the frozen contract. The two Waiting-start failures below are correction targets, not deferred fixture updates. Final full-suite disposition is recorded in the integration contract and final comparison addendum.

AccountRecovery follow-up: the entire 23-test class passed on both untouched baseline and final current source, 195 assertions each. Its original/final full-suite-only failure remains inconclusive; isolated/whole-class replay does not establish equivalent full-suite worker state. No authentication/mail implementation changed here. The final comparison covers 44 unique previously/currently failing names (the original 43 plus the newly baseline-reproduced audit date-filter test).

Specific deferred Queue discrepancies: `test_the_database_enforces_one_entry_per_visit_and_valid_values` exposes a database domain now accepting In Treatment as a queue state; `test_order_is_priority_then_exact_arrival_then_queue_number` and `test_priority_does_not_reorder_patients_already_called_or_treatment_ready` fail first on the now-invalid Priority/Urgent request vocabulary, before ordering assertions; `test_only_todays_queue_can_be_operated` observes a changed structured error-code contract; `test_backfill_uses_server_visits_only_and_is_idempotent_and_reversible` observes an eight-hour timestamp shift, not a Dentist shift-window problem. The latter needs the existing timezone/backfill migration owner to review a safe reproduction before any historical timestamp repair. `InterviewRoundTwoTest::test_the_5_10_and_15_minute_late_steps` observes the changed late/FIFO ordering. None is repaired by weakening an assertion or modifying historical data in this batch.

Both runs selected the exact 43 failure/error names from the earlier full suite, used the same locked dependencies, and ran serially against the guarded disposable database. Current: 40 failures, one error, two passes. Untouched baseline: 40 failures, one error, two passes. All paired failure messages are identical. These replays precede R1 contract edits; the final broad contract run separately covers the changed paths. They do not claim the two original full-run-only failures are conclusively pre-existing.

## Tests\Feature\Analytics\AnalyticsCorrectionsTest::test_automation_health_is_null_without_actions_and_exact_with_them

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [201] but received 404.
Failed asserting that 404 is identical to 201.
```

## Tests\Feature\Auth\AccountRecoveryTest::test_a_code_replaced_before_its_job_ran_is_not_sent

- Current result: PASS
- Untouched-baseline result: PASS
- Classification: Not conclusively classified. Original full-run failure did not reproduce in either paired run; suite-order/time sensitivity remains unresolved.
- Execution path / required action: No R1 or DEV-A-01 changes in account-recovery code. Investigate outbox/job timing under full-suite order; defer authentication changes outside this scope.
- Exact assertion/error from the original full run:

```text
Failed asserting that two arrays are identical.
--- Expected
+++ Actual
@@ @@
 Array &0 [
     0 => 'superseded',
-    1 => 'logged_only',
+    1 => 'pending',
 ]
```

## Tests\Feature\Automation\AutomationControlTest::test_unauthenticated_cannot_access_automation_endpoints

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [401] but received 404.
Failed asserting that 404 is identical to 401.
```

## Tests\Feature\Automation\AutomationControlTest::test_staff_and_dentist_and_patient_are_forbidden_from_automation

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [403] but received 404.
Failed asserting that 404 is identical to 403.
```

## Tests\Feature\Automation\AutomationControlTest::test_owner_can_view_automation_rules_and_snapshot

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [200] but received 404.
Failed asserting that 404 is identical to 200.
```

## Tests\Feature\Automation\AutomationControlTest::test_owner_can_trigger_manual_evaluation_and_audit_is_created

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [201] but received 404.
Failed asserting that 404 is identical to 201.
```

## Tests\Feature\Automation\AutomationControlTest::test_csv_export_neutralizes_formula_injection

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [200] but received 404.
Failed asserting that 404 is identical to 200.
```

## Tests\Feature\Automation\AutomationTruthfulnessTest::test_the_api_marks_every_action_row_as_evaluation_only_and_keeps_historical_text_unchanged

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [200] but received 404.
Failed asserting that 404 is identical to 200.
```

## Tests\Feature\Automation\AutomationTruthfulnessTest::test_manual_dispatch_refuses_clinical_flags_and_every_foreign_field

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [422] but received 404.
Failed asserting that 404 is identical to 422.
```

## Tests\Feature\Automation\AutomationTruthfulnessTest::test_manual_dispatch_validates_each_rule_observation

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [422] but received 404.
Failed asserting that 404 is identical to 422.
```

## Tests\Feature\Automation\AutomationTruthfulnessTest::test_the_manual_message_says_evaluated_not_executed_and_the_event_stores_no_email

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [201] but received 404.
Failed asserting that 404 is identical to 201.
```

## Tests\Feature\Automation\AutomationTruthfulnessTest::test_only_the_owner_may_dispatch_and_authorization_precedes_validation

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [403] but received 404.
Failed asserting that 404 is identical to 403.
```

## Tests\Feature\Automation\AutomationTruthfulnessTest::test_manual_dispatch_is_rate_limited

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [429] but received 404.
Failed asserting that 404 is identical to 429.
```

## Tests\Feature\Automation\AutomationTruthfulnessTest::test_health_is_null_with_no_evaluations_and_exact_otherwise

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [200] but received 404.
Failed asserting that 404 is identical to 200.
```

## Tests\Feature\Automation\AutomationTruthfulnessTest::test_a_genuine_zero_percent_is_not_confused_with_no_data

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Failed asserting that null is identical to 0.
```

## Tests\Feature\Automation\AutomationTruthfulnessTest::test_snapshot_branch_uses_the_m2_reference_contract_and_never_silently_widens

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Failed asserting that null is identical to 1.
```

## Tests\Feature\Automation\AutomationTruthfulnessTest::test_audit_events_carry_no_event_body_and_the_csv_marks_evaluation_only

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [200] but received 404.
Failed asserting that 404 is identical to 200.
```

## Tests\Feature\Automation\AutomationTruthfulnessTest::test_legacy_descriptions_are_qualified_inside_the_csv_cell_and_in_the_exception_projection

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [200] but received 404.
Failed asserting that 404 is identical to 200.
```

## Tests\Feature\Automation\AutomationTruthfulnessTest::test_repeated_manual_dispatches_are_independent_evaluations_with_no_idempotency_contract

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [201] but received 404.
Failed asserting that 404 is identical to 201.
```

## Tests\Feature\Automation\AutomationTruthfulnessTest::test_manual_dispatch_refuses_unexpected_top_level_fields_too

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed automation-monitor route/projection. Failure occurs in retired endpoint/health expectations, not modified cancellation-summary wording. Coordinator must reconcile retired monitoring scope; defer unrelated test migration.
- Exact assertion/error in both paired runs:

```text
Expected response status code [422] but received 404.
Failed asserting that 404 is identical to 422.
```

## Tests\Feature\Automations\InterviewRoundTwoTest::test_the_5_10_and_15_minute_late_steps

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: Shared setup may traverse appointment services. Failing queue admission/priority/state/backfill paths are unchanged by this batch. Coordinator must reconcile frozen contracts with prior QA changes; no assertion weakening or broad queue rewrite.
- Exact assertion/error in both paired runs:

```text
Failed asserting that two arrays are identical.
--- Expected
+++ Actual
@@ @@
 Array &0 [
-    0 => 1,
-    1 => 2,
+    0 => 2,
+    1 => 1,
 ]
```

## Tests\Feature\Feedback\ConcurrentFeedbackTest::test_a_double_submitted_request_with_one_key_is_stored_once

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
[{"status":404,"body":{"message":"The route api\/feedback could not be found."}},{"status":404,"body":{"message":"The route api\/feedback could not be found."}}]
Failed asserting that an array contains Array &0 [
    0 => 404,
    1 => 404,
].
```

## Tests\Feature\Feedback\ConcurrentFeedbackTest::test_separate_legitimate_submissions_racing_are_all_kept

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
[{"status":404,"body":{"message":"The route api\/feedback could not be found."}},{"status":404,"body":{"message":"The route api\/feedback could not be found."}},{"status":404,"body":{"message":"The route api\/feedback could not be found."}}]
Failed asserting that two arrays are identical.
--- Expected
+++ Actual
@@ @@
 Array &0 [
-    0 => 201,
-    1 => 201,
-    2 => 201,
+    0 => 404,
+    1 => 404,
+    2 => 404,
 ]
```

## Tests\Feature\Feedback\FeedbackTest::test_the_feature_is_patient_only_and_owner_staff_dentist_and_guests_are_all_refused_everywhere

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
Expected response status code [201] but received 404.
Failed asserting that 404 is identical to 201.
```

## Tests\Feature\Feedback\FeedbackTest::test_owner_can_review_feedback_with_filters

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
Expected response status code [200] but received 404.
Failed asserting that 404 is identical to 200.
```

## Tests\Feature\Feedback\FeedbackTest::test_a_patient_submits_free_text_about_their_own_completed_visit_and_the_record_is_minimal_and_server_derived

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
Expected response status code [201] but received 404.
Failed asserting that 404 is identical to 201.
```

## Tests\Feature\Feedback\FeedbackTest::test_only_the_patients_own_completed_visits_are_eligible_and_every_other_case_is_one_indistinguishable_refusal

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
Expected response status code [422] but received 404.
Failed asserting that 404 is identical to 422.
```

## Tests\Feature\Feedback\FeedbackTest::test_the_text_is_bounded_free_data_and_every_authority_or_policy_field_is_refused

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
null
Failed asserting that 404 is identical to 422.
```

## Tests\Feature\Feedback\FeedbackTest::test_submission_is_idempotent_a_new_key_is_a_separate_submission_and_no_uniqueness_is_invented

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
Expected response status code [201] but received 404.
Failed asserting that 404 is identical to 201.
```

## Tests\Feature\Feedback\FeedbackTest::test_a_patient_reads_only_their_own_feedback_newest_first_with_a_cursor_that_reveals_nothing_about_others

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
Expected response status code [200] but received 404.
Failed asserting that 404 is identical to 200.
```

## Tests\Feature\Feedback\FeedbackTest::test_m26_is_a_foundation_only_no_rating_category_status_reply_publication_marketing_or_other_module_side_effect

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
Expected response status code [201] but received 404.
Failed asserting that 404 is identical to 201.
```

## Tests\Feature\Feedback\FeedbackTest::test_submission_is_rate_limited_per_account_and_explains_itself

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
Expected response status code [201] but received 404.
Failed asserting that 404 is identical to 201.
```

## Tests\Feature\Feedback\FeedbackTest::test_patient_can_submit_1_to_5_star_rating_and_low_ratings_auto_create_followup_task

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
Expected response status code [201] but received 404.
Failed asserting that 404 is identical to 201.
```

## Tests\Feature\Feedback\FeedbackTest::test_owner_can_review_patient_feedback_with_branch_and_dentist_filters

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
Expected response status code [200] but received 404.
Failed asserting that 404 is identical to 200.
```

## Tests\Feature\Queue\ConcurrentQueueNumberTest::test_simultaneous_arrivals_get_distinct_queue_numbers

- Current result: PASS
- Untouched-baseline result: PASS
- Classification: Not conclusively classified. Original full-run failure did not reproduce in either paired run; suite-order/time sensitivity remains unresolved.
- Execution path / required action: Scheduling fixture can traverse shared services, but new Patient publication restrictions do not apply to Staff arrival. Earlier full run failed schedule checks near midnight; repeated paired runs pass. Reproduce with controlled Manila time before changing production code.
- Exact assertion/error from the original full run:

```text
[{"status":422,"body":{"message":"This walk-in can\u2019t be admitted.","code":"walk_in_invalid","errors":{"walk_in":["The branch is within its operating hours","The Dentist is working at this branch now (work schedule, not on leave)"]},"failed_checks":["branch-hours","dentist-shift"]}},{"status":422,"body":{"message":"This walk-in can\u2019t be admitted.","code":"walk_in_invalid","errors":{"walk_in":["The branch is within its operating hours","The Dentist is working at this branch now (work schedule, not on leave)"]},"failed_checks":["branch-hours","dentist-shift"]}}]
Failed asserting that two arrays are identical.
--- Expected
+++ Actual
@@ @@
 Array &0 [
-    0 => 201,
-    1 => 201,
+    0 => 422,
+    1 => 422,
 ]
```

## Tests\Feature\Queue\QueueTest::test_the_database_enforces_one_entry_per_visit_and_valid_values

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: Shared setup may traverse appointment services. Failing queue admission/priority/state/backfill paths are unchanged by this batch. Coordinator must reconcile frozen contracts with prior QA changes; no assertion weakening or broad queue rewrite.
- Exact assertion/error in both paired runs:

```text
expected the database to reject {"visit_id":2,"status":"In Treatment"}
```

## Tests\Feature\Queue\QueueTest::test_order_is_priority_then_exact_arrival_then_queue_number

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: Shared setup may traverse appointment services. Failing queue admission/priority/state/backfill paths are unchanged by this batch. Coordinator must reconcile frozen contracts with prior QA changes; no assertion weakening or broad queue rewrite.
- Exact assertion/error in both paired runs:

```text
Expected response status code [200] but received 422.
Failed asserting that 422 is identical to 200.

The following errors occurred during the last request:

{
    "message": "The selected priority is invalid.",
    "errors": {
        "priority": [
            "The selected priority is invalid."
        ]
    }
}
```

## Tests\Feature\Queue\QueueTest::test_priority_does_not_reorder_patients_already_called_or_treatment_ready

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: Shared setup may traverse appointment services. Failing queue admission/priority/state/backfill paths are unchanged by this batch. Coordinator must reconcile frozen contracts with prior QA changes; no assertion weakening or broad queue rewrite.
- Exact assertion/error in both paired runs:

```text
Expected response status code [200] but received 422.
Failed asserting that 422 is identical to 200.

The following errors occurred during the last request:

{
    "message": "The selected priority is invalid.",
    "errors": {
        "priority": [
            "The selected priority is invalid."
        ]
    }
}
```

## Tests\Feature\Queue\QueueTest::test_only_todays_queue_can_be_operated

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: Shared setup may traverse appointment services. Failing queue admission/priority/state/backfill paths are unchanged by this batch. Coordinator must reconcile frozen contracts with prior QA changes; no assertion weakening or broad queue rewrite.
- Exact assertion/error in both paired runs:

```text
Failed asserting that null is identical to 'not_today'.
```

## Tests\Feature\Queue\QueueTest::test_start_treatment_serves_the_entry_and_moves_visit_and_appointment_together

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: Shared setup may traverse appointment services. Failing queue admission/priority/state/backfill paths are unchanged by this batch. Coordinator must reconcile frozen contracts with prior QA changes; no assertion weakening or broad queue rewrite.
- Exact assertion/error in both paired runs:

```text
Expected response status code [422] but received 201.
Failed asserting that 201 is identical to 422.
```

## Tests\Feature\Queue\QueueTest::test_backfill_uses_server_visits_only_and_is_idempotent_and_reversible

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: Shared setup may traverse appointment services. Failing queue admission/priority/state/backfill paths are unchanged by this batch. Coordinator must reconcile frozen contracts with prior QA changes; no assertion weakening or broad queue rewrite.
- Exact assertion/error in both paired runs:

```text
Failed asserting that two strings are identical.
--- Expected
+++ Actual
@@ @@
-'2026-09-28T09:20:00+08:00'
+'2026-09-28T17:20:00+08:00'
```

## Tests\Feature\Treatments\TreatmentTest::test_start_refusals_leave_everything_unchanged

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: Shared setup may traverse appointment services. Failing queue admission/priority/state/backfill paths are unchanged by this batch. Coordinator must reconcile frozen contracts with prior QA changes; no assertion weakening or broad queue rewrite.
- Exact assertion/error in both paired runs:

```text
Expected response status code [422] but received 201.
Failed asserting that 201 is identical to 422.
```

## Tests\Feature\Feedback\FeedbackTest::test_submitted_feedback_is_immutable_and_nothing_can_erase_it

- Current result: FAIL / ERROR; exact message below
- Untouched-baseline result: FAIL / ERROR; identical message below
- Classification: Pre-existing: reproduced unchanged on exact baseline source.
- Execution path / required action: No changed feedback route/model/migration. Removed routes/table require coordinator scope decision; do not restore a retired module or rewrite its tests in this batch.
- Exact assertion/error in both paired runs:

```text
SQLSTATE[42P01]: Undefined table: 7 ERROR:  relation "patient_feedback" does not exist
LINE 1: select * from "patient_feedback" limit 2
                      ^ (Connection: pgsql, Host: 127.0.0.1, Port: 5432, Database: dental_clinic_scratch, SQL: select * from "patient_feedback" limit 2)
```

## Final R1 full-suite comparison (963 tests)

Current final source: 922 passed, 40 failed, one error; 10,491 assertions. Both Waiting-start tests pass. All 24 tests added across DEV-A-01 and R1 pass. Each original test below has an exact paired assertion/error above; final error text is unchanged except synthetic record identifiers. Audit date filtering is a newly observed failure, reproduced independently on untouched baseline (same assertion); details follow.

### Newly observed audit failure (additional to the original 43)

Exact test: `Tests\Feature\Audit\AuditQueryTest::test_exact_filters_by_category_severity_action_branch_and_date`.

- Final current full suite: FAIL. Current whole-class replay: six pass, this one fails (103 assertions total).
- Untouched baseline exact-test replay: FAIL, 16 assertions.
- Both exact messages: `Failed asserting that actual size 0 matches expected size 3.`
- Classification: pre-existing, newly observed after Manila midnight; **not** a regression introduced by R1.
- Execution path: AuditService, AuditController, AuditLog and this test are unchanged. The test obtains today's date from the database (not its frozen September PHP clock); AuditController binds offset-bearing clinic midnight/end-of-day Carbon values through Laravel's offset-free date grammar. Date-bound interpretation across session/time zones is the implicated path. Do not attribute it to the Patient booking quote or clinical-start guard.
- Required action: scoped audit-query timezone-boundary reproduction/correction by the audit owner, using explicit offset-safe bounds and tests at both day edges; no historical timestamp repair, migration, or broad obsolete-test update here. This is outside the assigned Patient booking/lifecycle changes and remains a reported baseline blocker.

| Exact test | Final current | Untouched baseline replay | Final classification / action |
| --- | --- | --- | --- |
| `Tests\Feature\Analytics\AnalyticsCorrectionsTest::test_automation_health_is_null_without_actions_and_exact_with_them` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Auth\AccountRecoveryTest::test_a_code_replaced_before_its_job_ran_is_not_sent` | FAIL / ERROR | PASS | Not conclusively classified: full-run failure, selected baseline/current pass; mail path untouched; investigate suite/worker state |
| `Tests\Feature\Automation\AutomationControlTest::test_unauthenticated_cannot_access_automation_endpoints` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationControlTest::test_staff_and_dentist_and_patient_are_forbidden_from_automation` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationControlTest::test_owner_can_view_automation_rules_and_snapshot` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationControlTest::test_owner_can_trigger_manual_evaluation_and_audit_is_created` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationControlTest::test_csv_export_neutralizes_formula_injection` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationTruthfulnessTest::test_the_api_marks_every_action_row_as_evaluation_only_and_keeps_historical_text_unchanged` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationTruthfulnessTest::test_manual_dispatch_refuses_clinical_flags_and_every_foreign_field` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationTruthfulnessTest::test_manual_dispatch_validates_each_rule_observation` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationTruthfulnessTest::test_the_manual_message_says_evaluated_not_executed_and_the_event_stores_no_email` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationTruthfulnessTest::test_only_the_owner_may_dispatch_and_authorization_precedes_validation` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationTruthfulnessTest::test_manual_dispatch_is_rate_limited` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationTruthfulnessTest::test_health_is_null_with_no_evaluations_and_exact_otherwise` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationTruthfulnessTest::test_a_genuine_zero_percent_is_not_confused_with_no_data` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationTruthfulnessTest::test_snapshot_branch_uses_the_m2_reference_contract_and_never_silently_widens` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationTruthfulnessTest::test_audit_events_carry_no_event_body_and_the_csv_marks_evaluation_only` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationTruthfulnessTest::test_legacy_descriptions_are_qualified_inside_the_csv_cell_and_in_the_exception_projection` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationTruthfulnessTest::test_repeated_manual_dispatches_are_independent_evaluations_with_no_idempotency_contract` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automation\AutomationTruthfulnessTest::test_manual_dispatch_refuses_unexpected_top_level_fields_too` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Automations\InterviewRoundTwoTest::test_the_5_10_and_15_minute_late_steps` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Feedback\ConcurrentFeedbackTest::test_a_double_submitted_request_with_one_key_is_stored_once` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Feedback\ConcurrentFeedbackTest::test_separate_legitimate_submissions_racing_are_all_kept` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Feedback\FeedbackTest::test_the_feature_is_patient_only_and_owner_staff_dentist_and_guests_are_all_refused_everywhere` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Feedback\FeedbackTest::test_owner_can_review_feedback_with_filters` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Feedback\FeedbackTest::test_a_patient_submits_free_text_about_their_own_completed_visit_and_the_record_is_minimal_and_server_derived` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Feedback\FeedbackTest::test_only_the_patients_own_completed_visits_are_eligible_and_every_other_case_is_one_indistinguishable_refusal` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Feedback\FeedbackTest::test_the_text_is_bounded_free_data_and_every_authority_or_policy_field_is_refused` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Feedback\FeedbackTest::test_submission_is_idempotent_a_new_key_is_a_separate_submission_and_no_uniqueness_is_invented` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Feedback\FeedbackTest::test_a_patient_reads_only_their_own_feedback_newest_first_with_a_cursor_that_reveals_nothing_about_others` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Feedback\FeedbackTest::test_m26_is_a_foundation_only_no_rating_category_status_reply_publication_marketing_or_other_module_side_effect` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Feedback\FeedbackTest::test_submission_is_rate_limited_per_account_and_explains_itself` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Feedback\FeedbackTest::test_patient_can_submit_1_to_5_star_rating_and_low_ratings_auto_create_followup_task` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Feedback\FeedbackTest::test_owner_can_review_patient_feedback_with_branch_and_dentist_filters` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Queue\ConcurrentQueueNumberTest::test_simultaneous_arrivals_get_distinct_queue_numbers` | PASS | PASS | Original failure unclassified; final and paired runs pass; inspect clock-sensitive fixture before changing code |
| `Tests\Feature\Queue\QueueTest::test_the_database_enforces_one_entry_per_visit_and_valid_values` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Queue\QueueTest::test_order_is_priority_then_exact_arrival_then_queue_number` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Queue\QueueTest::test_priority_does_not_reorder_patients_already_called_or_treatment_ready` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Queue\QueueTest::test_only_todays_queue_can_be_operated` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Queue\QueueTest::test_start_treatment_serves_the_entry_and_moves_visit_and_appointment_together` | PASS | FAIL / ERROR | Pre-existing defect corrected; frozen clinical admission restored |
| `Tests\Feature\Queue\QueueTest::test_backfill_uses_server_visits_only_and_is_idempotent_and_reversible` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
| `Tests\Feature\Treatments\TreatmentTest::test_start_refusals_leave_everything_unchanged` | PASS | FAIL / ERROR | Pre-existing defect corrected; frozen clinical admission restored |
| `Tests\Feature\Feedback\FeedbackTest::test_submitted_feedback_is_immutable_and_nothing_can_erase_it` | FAIL / ERROR | FAIL / ERROR | Pre-existing; exact baseline reproduction above; justified domain/scope deferral |
