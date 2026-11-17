# Integration conflict resolutions — 2026-11-17

Exact parents: Operations9409b59e769de29ec0e58ab238b11d40fee29b45; Clinical407f0c6b74ce44a7d955d4b897e6100e2bd80a51; shared baselinea0725e645df6f8266c2bc4bebacc9d62dd18e7c1. Plan commitcd435eb precedes the controlled merge.

| Actual conflict | Resolution and reason |
|---|---|
| backend/app/Support/LocalMigrationProfile.php | Retain ordered allowlist of four Operations extensions AND Clinical exact-path/hash/disposable-test-only proposal guard. Resolve real paths for event checking. Actual integrated profile has no reviewed_proposal; no grant migration is selected or executed. |
| scripts/local-system.py | Union both explicit contention-lane dispatches, locks and acceptance flags. Preserve opt-in suite array/sync defaults while normal target remains queued capture. Retain Operations migration source hashing. Remove duplicate cache/test mkdir introduced by otherwise automatic hunk merge. |
| scripts/tests/test_local_system.py | Preserve both complete sets of refusal tests and Clinical suite-mail isolation tests. No half-method combination or assertion removed. |
| src/patient/pages/Archives.jsx | Clinical session/auth-generation/Patient/dependent identity checks, bounded reads, retry, exact saved receipt navigation and guarded PDF downloads retained. Operations pagination contract moved into shared archive-readback reader: cursor must equal last returned public record and cannot repeat. Clinical test fixture corrected to use valid IDs; explicit wrong-cursor test added. |

Five other overlaps auto-merged and reviewed: routes/api.php keeps scoped Direct Visit GET and all Operations routes; IntakeTest.php preserves corrected source expectations; LocalMigrationProfileTest.php keeps both guard cases; api-client.js and api-client.test.js retain both Operations endpoints and Clinical exact-document/read-error behavior. Neither side wholesale accepted as a conflict policy.

Source copy: git -c core.autocrlf=false archive from reviewed index tree. Default Windows archive CRLF caused pinned proposal hash refusal; corrected execution copy to Git LF bytes without editing any migration or repinning hashes. Grant proposal remains9b53175b26d656c62c29524da742d7f654bc2a0ce1451704784bb101fae56612.

Checkpoint evidence: frontend1995pass/8skip/0fail; smoke/build PASS. Python safety45/45pass. LocalMigrationProfile Unit13tests/28assertions PASS. PostgreSQL schema guard1/9, privilege guard1/14 PASS. Core combined95tests/1598assertions PASS after installing declared GD dependency in new isolated container (initial95tests/2PDF failures were toolchain-only). Broad suite and populated browser acceptance remain in progress, not acceptance claims.

Runtime: NEW container dentalops-integration-20261117, new source/private volumes; /private/integration/target.json; loopback PostgreSQL55527 within container; demo/test each87 selected/applied migrations, four genuine holds pending. No grants table or proposal, developer database access, historical job replay, external provider or deployment. API host127.0.0.1:8124; UI127.0.0.1:5198.

No integrated original QA promotion follows this merge checkpoint. Full criterion reconciliation and failed/not-run evidence remain mandatory.
