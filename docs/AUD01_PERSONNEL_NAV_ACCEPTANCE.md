# AUD-01 personnel discoverability — technical-lead review candidate

Date: 2026-11-11, Asia/Manila. Developer assignment: Jaztin / AUD-01 / P1.
Status: implemented locally; **uncommitted, review required**. No deployment, push or merge.

## Isolation and baseline

- Verified local integration HEAD and GitHub `refs/heads/integration/abc-controlled-20261111` both equal `e5159eeb22b9611a6ff8a7dab4257f58cab3a479` using `git rev-parse` and `git ls-remote` before implementation.
- Verified feature branch and worktree destination absent before creation.
- Feature branch: `fix/jaztin-aud01-personnel-nav-20261111`.
- Worktree: `/Users/glesielynalcantara/Documents/dentalops-integrated-review/scratch/integration-abc-20261111/scratch/aud01-personnel-20261111`.
- Starting and final feature HEAD: `e5159eeb22b9611a6ff8a7dab4257f58cab3a479`.
- Integration source and HEAD remain unchanged. Generated browser-tool logs were relocated into the feature worktree's ignored `scratch/browser-tool-evidence/` directory.

## Verified root cause and fix

`src/App.jsx` already lazy-loads and routes `team` to `TeamPage`. `canAccessPage` already permits only a valid Owner session. `NAV.owner` in `src/data.js` omitted `team`, and the Owner grouping in `src/layout.jsx` also omitted it. Both omissions prevented the shared sidebar/mobile navigation from rendering a caller.

Added one **Dentist & Staff** entry to Owner → **Clinic Operations**, alongside branches and work schedules. Exactly two production lines change. The existing icon, semantic button, selected-page state, role filter, focus styling and responsive navigation dialog are reused.

Applied Hick's Law through one task entry in an existing group; Jakob's Law through the current sidebar/drawer convention; Fitts's Law through existing 44px navigation controls. Personnel actions stay grouped with operational schedules. No new claims about clinic policy or defaults.

## Authorization and remaining personnel defect

| Role | Personnel menu/page | Availability update | Service eligibility configuration |
| --- | --- | --- | --- |
| Owner | Existing page guard allows access; entry now discoverable | Existing `PATCH /api/dentists/{dentistProfile}` and `/api/staff/{staffProfile}` are Owner-only | No supported update API or form found; authority for a future command is not inferred |
| Staff | Denied | Denied by existing role middleware | No supported command found |
| Dentist | Denied | Denied by existing role middleware | No supported command found |
| Patient | Denied | Denied by existing role middleware | No supported command found |

Evidence reviewed: `src/safeguards.js`, `src/administration.js`, `src/reference-data-bridge.js`, `src/pages/Admin.jsx`, `backend/routes/api.php`, `EnsureUserHasRole`, reference controllers/requests and `EmployeeInvitationService`.

Backend middleware revalidates authenticated Active account and canonical role. Staff reference reads retain existing branch-scope filtering; Owner personnel configuration remains clinic-wide. Existing branch and account-scope behavior is untouched. Frontend checks complement backend enforcement; no live backend denial was exercised here.

**Separate defect: invited-Dentist service eligibility cannot be configured through the current application.** Invitations deliberately create an unavailable profile without service eligibility. The dentist resource exposes `service_ids`, but TeamPage has no eligibility field, `syncPersonnelUpdate` sends none, and `UpdateDentistProfileRequest` / `DentistProfileController::update` provide no service-assignment mutation. Making availability reachable does not complete invited-Dentist booking setup. A separately reviewed command, authorization contract and UI are needed. Availability defaults, invitations and schema remain unchanged.

## Reproduction and verification

Before the production edit, `node --test tests/aud01-personnel-navigation.test.js` failed its two discovery assertions and passed its revoked-session assertion. The browser rendered zero personnel entries for Owner on the unchanged baseline. After the edit all three assertions pass; the Owner entry opens the existing screen.

| Check | Result |
| --- | --- |
| Focused tests: new navigation, production shell, reference-data bridge, employee invitations | **39/39 pass** |
| Full `npm test` | 1323 total: 1291 pass, 18 fail, 8 skipped, 6 TODO |
| Untouched baseline full suite | 1320 total: 1288 pass, the **same 18 named failures**, 8 skipped, 6 TODO |
| `npm run test:smoke` | Fails existing HMO assertion expecting `Record Provider Response`, `scripts/render-smoke.mjs:190` |
| Untouched baseline smoke | Same HMO assertion failure; 65 initial role/page renders before failure, feature has 66 |
| `npm run build -- --configLoader runner` | **Pass**; installed Vite 7.3.6, existing >500kB chunk warning |
| OCR prebuild | Reports five missing dependency assets in the local dependency installation; OCR is outside AUD-01 acceptance |
| `git diff --check` | **Pass** |
| Prior menu comparison | Every prior role/key/label matches the baseline exactly after excluding the new Owner `team` item |

The baseline comparison used an untouched `git archive` of the starting SHA under ignored `scratch/aud01-baseline/` inside this feature worktree. No existing tests were edited. Logs are `/private/tmp/aud01-{focused,npm-test,baseline-test,smoke,baseline-smoke,build}.log`.

Browser acceptance used Chromium through connected Playwright, synthetic records and intercepted API responses. No migration, database-backed test, real invitation, clinical/financial mutation or external provider action was executed.

| Width | Owner entry and both profile dialogs | Denied roles | Keyboard/focus and page overflow | Navigation target |
| --- | --- | --- | --- | --- |
| 375 | Pass | Staff/Dentist/Patient denied | Pass; no horizontal page overflow | 306 × 44px |
| 430 | Pass | Staff/Dentist/Patient denied | Pass; no horizontal page overflow | 306 × 44px |
| 768 | Pass | Staff/Dentist/Patient denied | Pass; no horizontal page overflow | 306 × 44px |
| 1024 | Pass | Staff/Dentist/Patient denied | Pass; no horizontal page overflow | 306 × 44px |
| 1440 | Pass | Staff/Dentist/Patient denied | Pass; no horizontal page overflow | 219 × 44px |

Checked Enter activation, visible keyboard focus, mobile drawer closure, accessible control/dialog names, Escape and profile-dialog focus restoration. Accessibility-tree inspection verifies names/roles; an actual screen reader was not used. Existing Staff and Dentist navigation remains in place. Empty personnel, synthetic failed save with retained draft, pending response and successful retry passed. Save/adoption exercised Dentist availability only; Staff editing was opened without saving. No runtime errors in the matrix or real App acceptance.

Visual spot checks: `scratch/aud01-nav-375.png`, `scratch/aud01-profile-375.png` and `scratch/aud01-personnel-1440.png` (local-only evidence). The existing personnel table layout is retained; the small-screen profile dialog scrolls vertically to its availability/save controls.

The **real App** (not just the component fixture) passed Owner menu → TeamPage → profile dialog, Staff/Dentist exclusion, reference loading and load-error retry. `?open=team#team` is not a supported personnel deep link for any role; it does not select the page or bypass permissions. The existing in-memory routing convention is retained. The direct-page guard was separately exercised for all four roles in unit/component checks.

Backend suite and `scripts/predefense-check.sh` were deliberately not run under the task's safe-test restriction. The script reads the demo database and performs live SMTP/PayMongo diagnostics. Live Laravel authorization, real invited-account onboarding, persisted saves, native screen-reader use and OCR remain unverified.

## Final review and complete changed-file manifest

A separate final self-review checked the entire production diff, added test fixtures, route guards, backend role gates and menu equivalence. No independent human or second-agent review is claimed. No backend, schema, permission, dependency-manifest, asset or existing-test changes. Secret-pattern scan of all changed/new files and whitespace checks passed. No clinic data or environment values appear in the change.

| Git state | File | Purpose |
| --- | --- | --- |
| Modified | `src/data.js` | Owner menu label/key |
| Modified | `src/layout.jsx` | Existing Clinic Operations grouping |
| Untracked | `tests/aud01-personnel-navigation.test.js` | Discovery, role and revoked-session regression |
| Untracked | `tests/aud01-personnel.browser.mjs` | Five-width component acceptance and real App transport-mocked acceptance |
| Untracked | `tests/fixtures/aud01-personnel.html` | Isolated browser entry |
| Untracked | `tests/fixtures/aud01-personnel.jsx` | Actual Shell/TeamPage with synthetic transport and shared adoption commands |
| Untracked | `tests/support/aud01-personnel.js` | Synthetic normalized role fixtures |
| Untracked | `docs/AUD01_PERSONNEL_NAV_ACCEPTANCE.md` | This review record |

Browser exports: `runPersonnelAcceptance(page, base)` and `runPersonnelAppAcceptance(page, base)` in `tests/aud01-personnel.browser.mjs`; use a local Vite server on the supplied base (default `http://127.0.0.1:5182`). Both use mocks; they do not require Laravel or a database.

Final Git status: two modified tracked files and six untracked deliverable files on the feature branch; nothing staged, committed or pushed. Integration worktree clean. Ignored dependency symlink, build output and scratch evidence are local-only.

Module status remains **M1 Partial**. Suggested process-document qualification: "Owner can discover existing Dentist/Staff profiles and availability from Clinic Operations; invited-Dentist service-eligibility configuration remains unavailable." No module promotion or DOCX change. AUD-03 through AUD-07 were not started. Stop here for technical-lead review.
