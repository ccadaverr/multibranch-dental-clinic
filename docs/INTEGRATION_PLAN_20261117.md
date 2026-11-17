# Local full-stack integration plan — 2026-11-17 (Asia/Manila)

Authorization: local integration/commits only. No push, main merge, deployment, production access, held migration or proposed grant installation.

## Verified source
- Origin: https://github.com/ccadaverr/multibranch-dental-clinic.git
- Operations: 9409b59e769de29ec0e58ab238b11d40fee29b45 (includes accepted A/B work).
- Clinical: 407f0c6b74ce44a7d955d4b897e6100e2bd80a51.
- Exact merge base: a0725e645df6f8266c2bc4bebacc9d62dd18e7c1. Both independently verified using live ls-remote and fetched without tags.
- Original Operations checkout clean and preserved. Separate branch integration/dentalops-fullstack-20261117 in sibling dentalops-integration-20261117.

## Ordered work and acceptance gates
1. Inventory both deltas (219 Operations paths / 218 Clinical paths); retain full path manifests. Inspect nine overlapping files and shared API/security contracts before merge.
2. Controlled no-commit Clinical merge. Record actual conflicts and each semantic resolution. Preserve both histories and all four held migration bytes. Retain grant implementation/proposal but exclude proposal from execution. No blanket ours/theirs.
3. Review Sanctum/session/auth-version, branch scope, no-store, Appointment/Visit read concealment, exact history IDs, notification recipients/grant revocation and Patient archive/PDF paging. Preserve Served=treatment START, former-Dentist revocation and fail-closed reassignment on missing schema.
4. Inspect explicit migration plan before provisioning a NEW synthetic Linux/PostgreSQL target. Existing developer targets/jobs remain untouched. Base83 plus four reviewed Operations extensions yields87 selected entries; proposed grant extension remains uninstalled. Verify manifest identity/hashes and four pending holds before and after each action. Never use default migrations/AUTO_MIGRATE.
5. Focused PostgreSQL regressions: read privacy/revocation, admissions/encounters/chart CAS/history/prescription/invoice/receipt/cash idempotency; roster approval versus publication/duty, leave dates and scope; recipient notification archives/counts and absent-grant messaging; peso reporting/branch filters. Then actual isolated service/browser journeys and worker/scheduler/local capture. No historical queue replay or external delivery.
6. Reconcile OWN-11 and15 retired-route failures against original criteria without weakening assertions or restoring insecure routes. Classify predefense environment failures separately. Run coherent consolidated frontend/backend reviewed lanes, syntax/safety, smoke/build/predefense; preserve failed evidence.
7. Reconcile all68 original QA rows from authoritative Clinical matrix, retaining21 provisional local Complete/36 Partial/11 Blocked until full item-specific evidence. Record source/tests/local/integrated status and remaining criteria. Advance only fully verified originals.
8. Commit coherent local merge/corrections/evidence; report exact candidate SHA, clean state and limitations. Continue next vertical slice only after safety-critical integrated regressions are resolved.

## Risks and initial limitations
- Nine overlaps: LocalMigrationProfile.php, routes/api.php, IntakeTest.php, LocalMigrationProfileTest.php, local-system.py, test_local_system.py, api-client.js, Patient Archives.jsx, api-client.test.js.
- Textual merge success cannot prove semantic compatibility. Grant schema deliberately unavailable; no implicit historic access permitted.
- Staff Pending/Approved/Published recurrence differs from existing Dentist weekly writes: no invented symmetric approval lifecycle.
- Owner-wide archive wording conflicts with clinical/message privacy; entity-specific policy approval remains required.
- Source runtime is POSIX; native Windows is unsuitable. Docker initially stopped; start only toolchain then new container/volumes. No existing developer service start or queue processing.
- Vercel/Render trigger risk remains; no integrated publication authorized.
- Clinical reconciliation document absent on Operations but present on verified Clinical source; no missing-content assumption.
