# Dr. Dana E. Roxas Dental Clinic — Backend (Foundation 1A)

**Scope of this checkpoint: authentication, registration and RBAC only.** No appointments, treatments, queue,
HMO, billing, or loyalty backend exists yet. See "Known limitations" below.

The existing React/Vite frontend (`../src`) does not talk to this backend yet — that wiring is a separate,
later checkpoint ("Backend Foundation 1B").

## Stack

- Laravel 13 (PHP ^8.3)
- PostgreSQL (real local Postgres — not SQLite)
- Laravel Sanctum, configured for **first-party SPA session-cookie authentication** (not bearer tokens in
  localStorage) — the intended pattern for the future Vite frontend

## Canonical identity model

`PERSONS` is the shared identity hub. `USERS` and `PATIENTS` are independent siblings, each holding its own
`person_id` foreign key back to `PERSONS`. There is no `PATIENTS.user_id` and no `PERSON → USER → PATIENT`
chain — a Person can exist with no User at all. This mirrors the frontend's ERD_ALIGNMENT.md identity model.

- `persons` — first/last name, unique nullable email, phone, date_of_birth, sex, address
- `users` — `person_id` (unique FK), unique `email`, hashed `password`, `role`, `account_status`
  (`Active`/`Inactive`), nullable `title` (display-only Staff duty focus — never used for authorization)
- `patients` — `person_id` (unique FK), unique `patient_code`, `consent`

## RBAC

Four canonical roles only: `patient`, `staff`, `dentist`, `owner` (`App\Enums\Role`). Enforced entirely
server-side via `App\Http\Middleware\EnsureUserHasRole` (route middleware alias `role:<role>`), which reads only
the authenticated user's `role` column — never client-supplied input, and never the display-only `title` field.
An `Inactive` account is rejected even if its role matches.

## API

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/register` | none | Patient self-registration only |
| POST | `/api/login` | none | Session-cookie login |
| POST | `/api/logout` | session | Invalidates the session |
| GET | `/api/me` | session | Current identity |
| GET | `/api/rbac-demo/{patient,staff,dentist,owner}-only` | session + role | Proof-of-concept RBAC endpoints only — not a business API |

### Registration contract

`POST /api/register` accepts `first_name`, `last_name`, `email`, `phone`, `date_of_birth` (optional), `password`,
`password_confirmation`. Creates a `Person` → `Patient` → `User` (role `patient`, status `Active`) inside
one DB transaction, then logs the new user in.

`phone` must be a normalized Philippine mobile number: `+63` followed by exactly 10 digits, the first of
which is not `0` (e.g. `+639171234567`) — enforced by both the frontend's `src/phone.js` control and this
same backend regex, so a request that bypasses the frontend still can't submit a malformed number.

Reserved fields (`role`, `role_name`/`roleName`, `permissions`, `account_status`/`accountStatus`, `title`,
`person_id`/`personId`, `patient_id`/`patientId`, `user_id`/`userId`, `id`) are rejected outright with a 422
field-level validation error if present in the request body — public registration can never choose a role or
any internal ID. Enforcement is two-layered: the `FormRequest`'s `prohibited` rules reject the request, **and**
the controller only ever writes fields it explicitly reads off `$request->validated()`, so no unlisted field
could reach the database even if a validation rule were ever missed.

A likely-duplicate Patient (matching phone, or matching first+last name and date of birth) is rejected with a
generic message that does not disclose which existing record matched (mirrors the frontend's
`possibleDuplicatePerson` check).

### Login contract

`POST /api/login` accepts `email`, `password`. An unknown email and a wrong password return the **same** 422
message (anti-enumeration); an `Inactive` account gets a distinct message. Both are returned as a normal
Laravel 422 `{message, errors}` validation response, plus a machine-readable `code`
(`invalid_credentials` / `inactive_account`, Backend Foundation 1B) so a frontend client can distinguish the
two cases without string-matching the human-readable message. A successful login regenerates the session ID
(session-fixation protection).

### `/api/me`

Returns the authenticated identity via `App\Http\Resources\UserResource`: `id` (the user's ULID `public_id` —
no internal person/patient/user bigint is returned), `name` (derived from the related Person — not a stored column), `first_name`,
`last_name`, `phone`, `date_of_birth` (Backend Foundation 1B — already-stored, already-safe
Person fields, exposed so a frontend identity bridge can build a real local Person projection instead of
parsing `name`), `email`, `role`, `title`, `account_status`, `patient` (`{id, code}` — the account's own Patient
record's `public_id` and `patient_code`, resolved server-side through the unique User → Person → Patient links, or
`null`), and `branch_scopes` (the account's explicit authorization branch scopes as `{id, name}` using branch
`legacy_ref`; Owner authority is global and does not depend on it). Never includes `password` or `remember_token`.
The same fields appear in the register/login response envelopes (`data.*`).

## Sanctum / CORS / CSRF for the future SPA

- `bootstrap/app.php` calls `$middleware->statefulApi()` so `/api/*` requests from a configured frontend origin
  get session-cookie (not bearer-token) authentication.
- `config/cors.php` is scoped to `FRONTEND_URL` (default `http://localhost:5173`) with `supports_credentials`
  true — not a wildcard origin, since wildcard + credentials is disallowed by browsers anyway.
- `SANCTUM_STATEFUL_DOMAINS` must include the frontend's host:port (see `.env.example`).
- Backend 1B will need to `GET /sanctum/csrf-cookie` before any state-changing request, per Sanctum's standard
  SPA flow — no custom CSRF mechanism was invented here.

## Local setup

1. Install PHP 8.3+, Composer, and a local PostgreSQL server.
2. `composer install`
3. Run `test -e .env || cp .env.example .env`, then fill in the local database credentials in the ignored `.env`.
4. Run `php artisan key:generate` only for a new environment with no existing key or encrypted data. If an existing
   environment loses its key, restore its private backup before starting Laravel.
5. Create the database: `createdb dental_clinic` (name must match `DB_DATABASE` in `.env`)
6. `php artisan migrate`
7. Seed demo accounts: `php artisan db:seed` (see below)
8. `php artisan serve`

### Running tests

Tests run against a **real, separate** PostgreSQL database, not SQLite, so "PostgreSQL was tested" is actually
true here.

1. `createdb dental_clinic_test`
2. `cp .env.testing.example .env.testing`, fill in your local Postgres host/port/username/password
3. `php artisan key:generate --env=testing` (Sanctum's stateful-SPA cookie middleware needs its own app key for
   the test environment)
4. `php artisan test`

`phpunit.xml` fixes `DB_CONNECTION=pgsql` and `DB_DATABASE=dental_clinic_test` directly (both safe, non-secret
values); the machine-specific host/port/credentials come from the gitignored `.env.testing`. Running an artisan
command against the test database outside PHPUnit therefore needs both set explicitly
(`APP_ENV=testing DB_CONNECTION=pgsql DB_DATABASE=dental_clinic_test php artisan …`); otherwise Laravel falls
back to its default SQLite connection.

### PostgreSQL requirement: `btree_gist` (M6 appointments)

The M6 appointments migration runs `CREATE EXTENSION IF NOT EXISTS btree_gist` and adds two exclusion
constraints, so PostgreSQL itself refuses overlapping active appointments for the same Dentist or the same
Patient, even when two requests validate at the same moment. `btree_gist` ships with PostgreSQL's standard
contrib modules (Postgres.app, Homebrew, the official Docker image and the major managed services include it).
Creating it needs a role allowed to `CREATE EXTENSION` (a superuser, the database owner on PostgreSQL 13+ for
trusted extensions, or a managed service's admin role). If the migration role lacks that privilege, have an
administrator run `CREATE EXTENSION btree_gist;` once in each database (`dental_clinic`, `dental_clinic_test`)
before `php artisan migrate`. There is intentionally no application-only fallback: without the constraint two
concurrent bookings could both succeed.

`tests/Feature/Appointments/ConcurrentBookingTest.php` starts two real PHP processes with their own database
connections, so it commits data and rebuilds `dental_clinic_test` (`migrate:fresh`) before and after itself. It
refuses to run against any other database.

Feature tests that exercise the session-cookie login/logout lifecycle send a `Referer: http://localhost:5173`
header (see `tests/TestCase.php`) so Sanctum's stateful-SPA middleware recognizes them as frontend requests,
exactly as it will for the real Vite app later.

### Demo/dev seed accounts

`php artisan db:seed` runs `DemoAccountsSeeder` and `DemoStaffProfileSeeder`, which refuse to run when `APP_ENV=production`.
They create one account per role, plus a second Staff branch for the cross-branch messaging demo:

| Role | Email | Title | Branch (profile and access) |
| --- | --- | --- | --- |
| Patient | `patient@example.test` | — | — |
| Staff | `staff.reception@example.test` | Receptionist | Branch A |
| Staff | `staff.assistant@example.test` | Dental Assistant | Branch A |
| Staff | `staff.branchb@example.test` | Receptionist | Branch B |
| Dentist | `dentist@example.test` | — | — |
| Owner | `owner@example.test` | — | — |

On an existing local database, add only the Staff profiles and the Branch B account with
`php artisan db:seed --class=DemoStaffProfileSeeder` (idempotent).

Password for all demo accounts: the value of `DEMO_ACCOUNT_PASSWORD` in your `.env` if set, otherwise the
local-dev-only fallback `DemoPass123`. This is not a secret worth protecting (it only ever unlocks a throwaway
local database) but is not hardcoded as plaintext in any tracked file beyond this placeholder documentation.

## Encryption key (`APP_KEY`)

`APP_KEY` encrypts Patient message text at rest (M17), queued email jobs that carry one-time codes, and session cookies.

- **Losing it makes every stored message unreadable.** There is no recovery. Back it up in the clinic's password manager as soon as
  it is generated, and keep the backup outside the server.
- **Never commit it** and never reuse the development key in production.
- **Rotating it** (for example after a suspected leak):
  1. Move the current key to `APP_PREVIOUS_KEYS` and set a new `APP_KEY`.
  2. Restart the API, the queue worker and Reverb.
  3. Run `php artisan messages:encrypt-bodies --rotate`. If it stops, resume with `--from-id=<last id>`.
  4. Then remove the old key.

  Rotation signs everyone out. Plan it outside clinic hours. Details: `docs/M17_REALTIME_MESSAGING.md`.

## Known limitations (this checkpoint only)

- No appointments, treatment, queue, HMO, billing, or loyalty tables or endpoints exist yet.
- No profile-editing endpoints.
- No rate limiting has been added beyond Laravel's defaults.
- Staff `title` is a free-text display field with no catalog/validation of allowed values yet.
- The frontend is not wired to this backend yet (Backend Foundation 1B).
