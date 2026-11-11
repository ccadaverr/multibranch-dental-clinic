# AUD-07 authentication duplicate-submission hardening

2026-11-11, Asia/Manila. Jaztin. Sprint 01. P2.

**CONDITIONAL — scoped implementation acceptable for technical-lead review, with no identified blocking source defect.** No commit, push, merge or deployment is authorized or performed. This is source and synthetic acceptance, not live-server authentication acceptance.

## Checkpoint and isolation

- Repository: `https://github.com/ccadaverr/multibranch-dental-clinic.git`.
- Branch: `fix/jaztin-aud07-login-lifecycle-20261111`.
- Worktree: `/Users/glesielynalcantara/Documents/dentalops-integrated-review/scratch/integration-abc-20261111/scratch/aud07-login-lifecycle-20261111`.
- Starting/current HEAD: `e5159eeb22b9611a6ff8a7dab4257f58cab3a479`.
- Verified local and published integration checkpoints before work. Verified the new branch/path were absent before creation. All implementation is inside this new feature worktree.
- Integration stays at that SHA; AUD-01 stays separately at `b750c0c8f7c5c391fe4dffc34e50268a3ff202c6`. AUD-01 is deliberately not merged into AUD-07. Other source branches and prior evidence remain preserved.

## Audit evidence and failure before implementation

Read the four preserved reports in `/Users/glesielynalcantara/Documents/dentalops-integrated-review/scratch/int-abc-20261111-evidence/post-integration-audit/`: `FINAL_SYSTEM_AUDIT_SUMMARY.md`, `P0_P1_P2_P3_DEFECT_REGISTER.md`, `FRONTEND_BACKEND_CONSISTENCY.md`, `TEST_FAILURE_CLASSIFICATION.md`. AUD-07 originally measured two local callbacks, without proving duplicate HTTP dispatch or a server bypass.

New reproduction uses the actual `Login`, actual API adapter and deferred `window.fetch` responses. No request reaches Laravel. Before production edits:

| Action on unchanged baseline | Callbacks | Login HTTP dispatches | Outcome |
| --- | --- | --- | --- |
| Two button clicks in one task | 2 | 2 | Fails one-active-attempt requirement |
| Two native `requestSubmit()` calls in one task, modeling Enter's submission path | 2 | 2 | Fails |
| Button click immediately followed by `requestSubmit()` | 2 | 2 | Fails |
| Real keyboard Enter, then another Enter while pending | 1 | 1 | Already worked |

The deterministic same-task test deliberately runs both actions before React commits pending state. It is distinct from two Playwright keyboard events on separate turns, which React can already guard. HTTP counts exclude CSRF setup. A callback exception also left the original form busy without feedback. Normal network/server/validation retry behavior already worked and is retained.

Additional before evidence: an old login success or verification-required refusal could replace a newer login form; an obsolete unsupported identity could dispatch logout; a disposed App's old verification result could change the current URL to `#verify-email`. Original component remount prevented visible old-form feedback by itself, but did not prevent App callback side effects.

The fourteen-case pre-edit diagnostic is preserved in ignored `scratch/aud07-before-browser.json`. Initial harness attempts were corrected to use distinct navigation URLs and the existing Notice `status` role before the recorded baseline run. Historical tests/assertions were not changed.

## Root cause and implementation

`Login` guarded only on the render snapshot `submitting`. `setSubmitting(true)` did not synchronously change that snapshot. Its awaited callback lacked `catch/finally`. Separately, App trusted completion of every login/bootstrap callback, without checking whether its form, App instance or authentication context still owned the request.

- `src/layout.jsx`: a ref owns the pending attempt before the first callback starts. A form lifetime is invalidated on cleanup or initial-email context replacement. `try/catch/finally` releases the current attempt after success/refusal/exception; exception details are not displayed. Existing button state, labels, form grouping and keyboard behavior are retained.
- `src/login-lifecycle.js`: a small App-local owner issues distinct in-memory tickets, checks caller ownership and the current context, and invalidates tickets on disposal/sign-out. New requests supersede old continuations. It stores no credentials or authentication tokens and introduces no global state.
- `src/App.jsx`: checks ownership before bridging/adopting identity, verification redirects and post-logout feedback. Startup, ordinary logout, security sign-out and session-revalidation continuations use the same App lifetime so obsolete completions cannot clear a newer login. These are the only consumers of the new helper.

Login/bootstrap use the existing provider's stable `getAuthGeneration` reader. Revalidation and logout instead track current server identity plus App ticket: a 401 intentionally invalidates the clinical authentication generation, so using that generation for its own revalidation would suppress necessary sign-out. The shared provider/clinical generation implementation is unchanged. New login tickets prevent the same-account A→logout→A case from reviving older work.

The optional third **frontend callback** argument `{isCurrent}` is consumed by App; the HTTP login signature and payload remain unchanged. All other Login callers reviewed are test fixtures/SSR renders; two-argument callbacks remain compatible with JavaScript's extra-argument behavior.

## Full-stack contract review

| Boundary | Existing contract, unchanged |
| --- | --- |
| Login → App | Captured email/password; normalized success/refusal; current App decides identity adoption |
| App → API adapter | `api.login(email,password)` → `POST /api/login`, JSON `{email,password}` |
| Transport / CSRF | `credentials: include`; shared CSRF-cookie promise; `X-XSRF-TOKEN`; one sequential replay after 419, never an automatic success retry |
| Route / validation | Laravel `LoginRequest`: required bounded string fields and existing PasswordInput rule; public login endpoint uses `throttle:m1-login` |
| Throttling | Existing 30/minute IP and 5/minute normalized-account-plus-IP limits |
| Credentials / status | Generic unknown-email/wrong-password refusal; Active account required; Patient email verification required |
| Session | Existing web-guard cookie login, session regeneration and stored `auth_version`; logout invalidates session and regenerates CSRF token |
| Response / adoption | Existing safe UserResource contains server public identity, canonical role, account status, linked Patient/employee and branch scopes; existing identity bridge remains authoritative for the compatibility workspace |
| Protected operations | Sanctum plus fresh `EnsureAccountAccess`, backend role checks and existing branch-scope authorization remain unchanged; frontend navigation does not grant authority |

Reviewed `api-client.js`, `session-bootstrap.js`, `identity-bridge.js`, provider generation/adoption in `store.jsx`, Laravel auth controller/request, route registration, rate limiter, UserResource, stateful bootstrap middleware and account-access middleware. No backend, API adapter, store, policy, schema, session infrastructure or CSRF code changed.

The confirmed duplicate defect is frontend-only. No backend correction is established as necessary by these tests. **Already dispatched HTTP operations are not cancelled or made idempotent by this fix.** Ignoring their JSON payload does not prevent the browser from applying response cookies or the server from completing an earlier login/logout. Cross-tab or abandoned-form concurrent cookie/session ordering needs a separate approved authentication-concurrency acceptance task with disposable accounts/infrastructure. If that exposes a server defect, any session-locking/protocol correction requires technical-lead review. No live cookie race, authorization bypass or compromise is claimed.

## Verification actually executed

| Check | Result |
| --- | --- |
| New ownership unit regressions | **10/10 pass** |
| Focused existing/new auth tests | 119 total: **114 pass, 1 fail, 4 TODO** |
| Focused known failure | Existing `tests/m1-employee-identity.test.js:57`: “the session stays inactive until the server profile is loaded, then re-derives to the SAME person”; classified as F09 stale source-pattern assertion in preserved audit; not changed/waived |
| Final browser run | **26/26 pass**, zero captured runtime page errors |
| Feature full suite | 1330 total: **1298 pass, 18 fail, 8 skipped, 6 TODO** |
| Fresh exact-baseline full suite | 1320 total: **1288 pass, 18 fail, 8 skipped, 6 TODO** |
| Failure comparison | Same 18 failing names; zero newly failing names |
| Production build | **Pass**, `npm run build -- --configLoader runner` |
| Build qualifications | Existing >500kB chunk warning; installed OCR English trained-data asset is missing; no dependency installation/manifest change |
| Smoke | Existing HMO `Record Provider Response` assertion still fails at `scripts/render-smoke.mjs:190`; initial 65 role/page renders and earlier workflow checks pass |
| Whitespace / secrets | `git diff --check` and changed-file secret-pattern scan pass |

The fresh baseline is an untouched `git archive` under ignored `scratch/aud07-baseline/`; all 1,865 tracked blobs were verified against the exact starting Git tree. Installed dependencies are reused through links inside feature-local `node_modules`, with isolated local caches. No package/lockfile changes.

Focused command: `node --test tests/aud07-login-lifecycle.test.js tests/api-client.test.js tests/public-auth-site.test.js tests/patient-portal.test.js tests/identity-bridge.test.js tests/m1-employee-identity.test.js tests/m1-employee-invitations.test.js tests/yzh-clin-11-auth-lifecycle.test.js`. Logs: `/private/tmp/aud07-{auth-focused,frontend,baseline-frontend,smoke,build}.log`.

Browser runner: exported `runLoginAcceptance(page, base)` from `tests/aud07-login.browser.mjs`, default base `http://127.0.0.1:5183`. Default mode asserts zero failures; diagnostic mode records pre-edit failures. The fixture renders real Login or real App under StrictMode, replaces transport before mounting and does not retain request credentials. Final results: ignored `scratch/aud07-after-browser.json`.

The browser cases cover immediate repeats, native keyboard submission, held responses, normal failures/retry, callback exception, existing bounded CSRF replay, form/App unmount, obsolete success/refusal/verification, unsupported identity, newer authenticated Owner surviving older Staff success, StrictMode bootstrap, session invalidation, obsolete revalidation and obsolete sign-out. Current verification-required and unsupported-workspace flows remain functional. Self-service credential changes are covered by reviewed callback ownership/source, not a new live end-to-end test.

## Accessibility and UX

At 375/430/768/1024/1440px: visible keyboard focus, real Enter submission, correct field/autocomplete names, readable pending/error feedback, retry and no page-level horizontal overflow passed. Submit targets are 265/320/606/438/438px wide respectively, all **52px high**. The form remains `aria-busy` during the request; the existing warning Notice announces through `role=status`. No full native screen-reader, physical-device, zoom or forced-colour acceptance is claimed.

Visual spot checks are preserved in ignored `scratch/aud07-login-375.png` and `scratch/aud07-login-1440.png`. No CSS, assets or visual redesign. Applied Hick's Law by retaining the single-step form, Jakob's Law by preserving native submit/retry patterns, Fitts's Law through the existing large control, and existing field/action grouping and truthful feedback.

Technical references consulted: [React state snapshots](https://react.dev/learn/state-as-a-snapshot), [React effect cleanup and obsolete results](https://react.dev/learn/synchronizing-with-effects). These support the engineering choice; they are not clinic policy.

## Separate final review and complete manifest

A separate source-review pass examined the full diff, all helper callers, state/request lifetimes, disposal/StrictMode, current/obsolete identity paths, logout/revalidation interaction and the new tests. The strict browser run was repeated during final verification with runtime-error capture. No separate human or second-agent review is claimed. No blocking source defect was identified. Final verdict remains **CONDITIONAL** because synthetic success does not establish live cookie/session acceptance and the baseline suite is not green.

| State | Exact file | Purpose |
| --- | --- | --- |
| Modified | `src/App.jsx` | Authentication completion ownership |
| Modified | `src/layout.jsx` | Synchronous Login guard and recovery |
| New | `src/login-lifecycle.js` | App-local request lifetime |
| New | `tests/aud07-login-lifecycle.test.js` | Ownership regressions |
| New | `tests/aud07-login.browser.mjs` | Production component/App regression and responsive acceptance |
| New | `tests/fixtures/aud07-login.html` | Synthetic browser entry |
| New | `tests/fixtures/aud07-login.jsx` | Held synthetic transport and real components |
| New | `docs/AUD07_LOGIN_LIFECYCLE_ACCEPTANCE.md` | Contract, evidence and review record |

No historical tests/assertions changed. No migrations, database-backed/RefreshDatabase tests, live account actions, provider operations or unsafe Artisan commands. `scripts/predefense-check.sh` was not run because it accesses the database and live SMTP/PayMongo diagnostics. Queue migration stays blocked. Clinical mutations, branch scopes, payment settings and prescription/follow-up lifecycles remain untouched.

M1 status stays **Partial**; suggested process-document qualification: “Sign-in has synchronous duplicate-submit prevention and client completion ownership; deployed cookie/session concurrency acceptance remains pending.” No module promotion or DOCX edit. Nothing staged or committed. Stop for technical-lead acceptance before any commit/publication.
