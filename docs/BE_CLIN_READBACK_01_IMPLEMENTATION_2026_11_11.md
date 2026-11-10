# BE-CLIN-READBACK-01: Exact follow-up readback

November 11, 2026, Asia/Manila. Development cutoff: 02:00 Asia/Manila.

Branch: `feature/joevan-staff-p0-be-20261110`.
Starting HEAD: `f6a7f55d59892ae54c59a59b58c7ef03a3d6fc99`, `docs(backend): audit clinical mutation recovery contracts`.
Initial staged, unstaged and untracked inventories were empty. Previous commits are preserved.

**Commit-review verdict: CONDITIONAL.** Scoped implementation and database-free route regressions are complete; persisted API authorization/serialization and no-write acceptance remain **UNVERIFIED**. This is not production-ready or integration acceptance. No staging, commit, push or merge was performed.

## Verified gap and implementation

At starting HEAD, `backend/routes/api.php` registered list GET, patient-list GET, Create POST and transition PATCH for follow-ups, but no exact-task GET. The earlier audit's missing-readback statement remains historically correct for that HEAD.

Added `GET /api/followups/{followupTask}` -> `FollowupController::show` behind the existing authenticated group (`auth:sanctum`, EnsureAccountAccess), with `role:staff,dentist`.

- Uses existing implicit FollowupTask binding: public ULID via `getRouteKeyName() === 'public_id'`. No identity or schema changes.
- Requeries the bound public task ID with current authorized branch IDs before eager-loading clinical relations. It serializes that newly read row, not an earlier route snapshot.
- Reuses the existing `view()` projection under `{data}`: task `id`, `patient.id`, `branch.id` (existing branch legacy ref), status, integer revision and existing permitted clinical fields.
- Reads Open, Contacted, Booked and Closed without list filters or limits. Closed/Contacted readback does not resubmit their mutations.
- Out-of-scope records return 404 from the scoped query. Invalid/missing public IDs return 404 from normal implicit binding. No internal numeric-key route was added.
- Successful responses use `Cache-Control: private, no-store` to discourage retaining sensitive readback responses.
- Contains no model write, audit emission, notification, mail, transaction or row-lock call. Readback is a current observation, not a lock held against later changes.

## Authorization and privacy decision

This endpoint follows the **existing follow-up work-list and transition boundary**, not the generic Patient-profile boundary:

| Actor | Exact readback |
| --- | --- |
| Active authorized Staff | Task branch must be in current UserBranchScope rows for that account. Operational staff assignment/title does not grant scope. |
| Active authorized Dentist | Current linked DentistProfile must be assigned to the task branch through dentist branches. Not restricted to task creator/assignee. |
| Other-branch/unscoped Staff or Dentist | No clinical record returned; 404. |
| Owner | New endpoint denied by role middleware and controller role check. Existing list still returns only its redacted metadata projection. |
| Patient, including task's own Patient | Denied by role middleware and controller role check. No new Patient follow-up entitlement. |
| Guest, revoked/inactive account | Existing authentication/account middleware remains operative; no bypass added. |

Source inspection confirmed an existing distinction: `index()` and `update()` use branch authority; `forPatient()` additionally requires Staff Patient `viewProfile`, as does manual creation. Thus Staff can already read an in-branch task's details in the work list without an encounter granting generic full Patient-profile access. The new endpoint preserves that task-specific boundary; it does not call or grant the generic Patient profile API. An authored API regression characterizes both responses so the distinction is explicit. Neither existing route is relaxed or changed. This is not evidence of a newly discovered authorization defect or permission to broaden generic clinical-record access.

The response uses the established projection; no request-selected patient or branch can redirect the lookup. Current scopes are queried and the row is filtered before clinical relation loading. As with existing reads, a concurrent revocation or record change after those observations is not serialized through response delivery. This work does not claim atomic scope revocation, session-generation receipts or cross-session cancellation of in-flight requests.

## Regression evidence

`backend/tests/Unit/FollowupReadbackRouteTest.php`: **3 executed database-free tests / 10 assertions**. A real Router registers the actual API routes in an isolated Container and matches requests without booting Laravel, resolving model bindings or contacting a database. Tests verify:

1. Exact GET selects `show`, captures the exact route identity and retains authenticated Staff/Dentist middleware.
2. Existing work-list and patient-list actions/role boundaries remain registered.
3. Existing PATCH action, role boundary and throttle remain registered.

Facade application/router state is restored after each registration. These tests verify route registration/matching, not middleware execution, row authorization or clinical serialization.

`backend/tests/Feature/Followups/FollowupExactReadbackTest.php`: **13 authored API regressions, NOT EXECUTED**. They use the existing SchedulingFixture, TestCase scratch guard and RefreshDatabase lifecycle, so this file must not run under the current database hold. Coverage authored for:

- Same-branch Staff with correct task/patient/branch identity and the existing work-list vs full-profile distinction.
- Assigned Dentist reading Closed state/revision and no-store response; Contacted state/representation parity; Booked appointment identity.
- Exact readback when the task falls outside both list caps.
- Other-branch Staff/Dentist, unscoped Staff, Owner, Patient, guest, invalid/nonexistent/internal numeric identities, with no clinical data in denied responses.
- Stale route snapshots: latest patient/status/revision and denial after task branch changes.
- Staff scope and Dentist assignment revocation applying to the next request (sequential checks, not real concurrent revocation).
- Repeated GET preserving raw task fields/revision and task/audit/notification/mail counts, with only SELECT SQL in the isolated token-authenticated fixture.

The Feature fixture uses an in-memory session driver to distinguish endpoint effects from framework browser-session persistence. Real browser middleware can persist session activity; this endpoint adds no domain write or audit side effect. No infrastructure is provisioned or database configured by this task.

## Validation executed

From repository root:

```text
php backend/vendor/bin/phpunit --no-configuration --bootstrap backend/vendor/autoload.php --do-not-cache-result backend/tests/Unit/FollowupReadbackRouteTest.php
php backend/vendor/bin/phpunit --no-configuration --bootstrap backend/vendor/autoload.php --do-not-cache-result backend/tests/Unit
php -l backend/app/Http/Controllers/FollowupController.php
php -l backend/routes/api.php
php -l backend/tests/Unit/FollowupReadbackRouteTest.php
php -l backend/tests/Feature/Followups/FollowupExactReadbackTest.php
git diff --check
```

Results: focused registration suite **3 passed / 10 assertions**; complete database-free Unit suite **171 passed / 1,027 assertions**, preserving the existing 168 cases. All four changed PHP files passed syntax checks. Full tracked diff reviewed; new files separately reviewed. Whitespace and secret-pattern checks passed for the exact five-file manifest.

No database connection, application bootstrap, migration, RefreshDatabase execution, seeder, destructive Artisan operation, environment-file change or real provider work occurred. No frontend files changed; frontend tests/smoke/build were not run. Full backend Feature tests and predefense scripts were not run under the database hold. Persisted authorization, actual implicit binding, response encryption/serialization and no-write behavior remain **UNVERIFIED** until separately approved isolated PostgreSQL acceptance.

## Recovery limits and next gate

Exact readback supports a client that already knows the public task ID. It does not prove whether an uncertain manual-create request committed when that ID was never received. Manual creation still has no request deduplication or recovery lookup by operation identity. Current status/revision does not attribute a mutation to a particular request or session.

No mutation receipt, idempotency behavior, expected-revision precondition, prescription Void contract or automatic follow-up writer was changed. A failed read may mean lost authorization/authentication, not failed mutation. A successful read is a point-in-time state observation; later mutations can advance it. Frontend recovery must continue to avoid inferring safe mutation retry from a missing/failed response.

Next gate: independent source/test review, then separately authorized database-backed acceptance on a verified disposable isolated instance with reviewed migration lifecycle. The configured scratch name/address is not approval of disposability. The queue migration remains blocked, so no full migration chain is authorized. The 10 Staff P0 database regressions remain unexecuted.

Official M15 Follow-Up Management process-document qualification: "Exact-task readback implemented in scoped development source; database-free route registration checks passed; PostgreSQL authorization, serialization and no-write acceptance remain unverified. Manual-create operation recovery and mutation receipts remain incomplete." Existing module classification is retained; no DOCX edit or module promotion.

## Exact changed-file manifest

1. `backend/app/Http/Controllers/FollowupController.php` — add exact `show`, scoped fresh read and no-store response.
2. `backend/routes/api.php` — register authenticated Staff/Dentist exact GET.
3. `backend/tests/Unit/FollowupReadbackRouteTest.php` — three database-free registration regressions.
4. `backend/tests/Feature/Followups/FollowupExactReadbackTest.php` — thirteen unexecuted persisted API regressions.
5. `docs/BE_CLIN_READBACK_01_IMPLEMENTATION_2026_11_11.md` — scoped implementation, evidence and remaining holds.

No migrations, schema, production database/auth configuration, queue lifecycle, prescription implementation, clinical frontend or scheduling/frontend ownership files were changed. Nothing is staged or committed. Prior reviewed backend commits remain intact; these working-tree changes are not represented as independently accepted.
