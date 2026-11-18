# Jaztin J09 — Clinical reliability and controlled publication preparation

November 18, 2026, Asia/Manila. **Local source acceptance; no Windows integration or hosted acceptance. Stop before pushing.**

Starting clean SHA: `39ba5ede70c17fcb27ff779511ca2aa92166daba`, branch `feature/jaztin-j08-unslop-20261118`. Implementation commit: `e36cb63469d2a6ae5d08f2b786727d321fcf615d`. All J01–J08 history preserved. The final checkpoint, ordered full SHAs, file/checksum manifests, frozen patches and verified incremental bundle are recorded in the external delivery package. The final SHA is external to avoid a self-referential report hash.

## Implemented

Three production files: `src/pages/ServerPrescriptions.jsx`, `src/prescription-command.js`, and new `src/prescription-catalog.js`.

**Catalog ownership.** Composer and license settings previously each requested the same catalog, including when settings were collapsed. Development effect replay duplicated both. A read-only resource now shares the in-flight/successful catalog within one mounted authenticated actor, branch and linked Patient/Visit scope. Effect replay is cleaned up before dispatch. Scope changes/unmount invalidate old results; errors are not cached as success. Explicit reload/retry and license-save invalidation permit a fresh request. Exact Visit reads remain separate authority checks. Typing does not refresh the catalog.

**Unchanged Draft issuance.** The write helper compares normalized saved clinical fields, excluding UI-only Other selection flags. An unchanged saved Draft gets a fresh authoritative read of the same ID, Patient, Visit, branch, revision, content and editable status. It proceeds to Issue with the reviewed revision and original issue key, without Update. Changed/conflicting/denied reads do not initiate Issue or adopt a newer revision silently. Dirty Drafts still perform one CAS Update before Issue. Lost-response retry reuses the same accepted Draft/revision/key; final readback is still required before success. The backend remains responsible for the current Dentist and author permissions.

**Error recovery.** Transient Visit failure retains available medicine entries, saved Draft information and useful same-scope context, while disabling Save/Issue until verification succeeds. Error and loading states no longer masquerade as an empty eligible-Visit list. Denied Visit reads clear stale saved context and display the failure, including when a Draft cannot be opened. Explicit retry rereads the necessary context; conflicting Drafts have a guarded Reload draft action. Settings read failures now have a visible error/retry. Allergy guidance has an honest unavailable fallback. A genuinely unused `rx-common` datalist was removed: actual selection uses the medicine select, and no input referenced that datalist. Tests now assert the actual name-only selector, not orphan markup.

No backend, shared authentication, CORS, chart, follow-up, billing, Owner/Staff, queue, migration, grant or global UI file was changed. J08 typography, record grouping, PDF feedback and [Unslop attribution](https://github.com/heydamir/unslop) remain intact. Unslop by Damir Sokolovsky (@heydamir), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), was used in polish mode. No new design direction, assets, optional generation/video scripts or framework was introduced. Applied Tesler (share reliable request ownership) and Postel (strict clinical identity/content validation), with visible recovery and no fabricated success.

## Observed network comparison

`tests/j09-prescription-reliability.browser.mjs` ran against frozen J08 source before production edits, then J09, using the same synthetic Patient, branch, active Visit and clean treatment starting screen. New prescription records were explicitly entered for each trial; there was no existing Draft in the blank composer. Existing prescriptions elsewhere in the list do not change that starting editor state. Tests record raw requests and actual persisted status/revisions. Raw request journals include additional explicit verification GETs; the catalog, exact-Visit and write counts below are production dispatches.

| Observation | J08 before | J09 after |
|---|---:|---:|
| Open linked composer: GET /api/prescriptions/visits | 4 | 1 |
| Open linked composer: exact Visit GET | 2 | 1 |
| Typing a note: additional catalog GET | 0 | 0 |
| Unchanged saved Draft: Update PUT | 1 | 0 |
| Unchanged saved Draft: Issue POST | 1 | 1 |
| Saved Draft revision 1 → issued revision | 3 | 2 |
| Dirty Draft: Update PUT + Issue POST | 1 + 1 | 1 + 1 |
| Failed Visit read: saved medicine field remains visible | No | Yes |

The unchanged Issue path adds a fresh Draft verification GET instead of the redundant write. No blanket reduction in all GETs or elapsed time is claimed. Explicit catalog retry is a legitimate new load, not counted as a duplicate. The measurements use Vite development effect replay; production duplicate-replay behavior was not claimed measured. No frontend response was mocked as a successful write. Network/403 failures were explicitly injected to test recovery; successful actions persisted through the actual Laravel/PostgreSQL API.

## GEN-09 — owned evidence, still Partial

Original acceptance: **“Key flows (check-in, appointments, patient record, prescriptions) require measurably fewer clicks.”** Original tasks: map common flows/count clicks; reduce clicks through shortcuts/defaults/inline actions/fewer steps; record before/after counts.

An activation means an actual button click issued by the browser harness. Native select changes and text entries are counted separately; loading, scrolling and prerequisite fixture creation are excluded. Authentication/prerequisite treatment documentation are outside the measured starting screen. There are no measured clinical time savings.

| Owned flow / comparable starting condition | Reference | J09 / repeat | Completion and limitation |
|---|---:|---:|---|
| Clean active treatment → blank linked composer → explicit Issue | 3 activations, 1 selection, 2 text entries | Same | Open prescriptions, Issue, confirm. Synthetic medicine/name and note explicitly entered. One create and one Issue; exact issued readback and Patient PDF. No click saving claimed. |
| Loaded unchanged saved Draft editor → Issue | 2 activations, no new input | Same | Issue then confirm. Redundant Update eliminated; required review preserved. |
| Patient Home → cancel exact future Confirmed appointment | 3 activations + 1 reason selection | Same | My visits, Cancel, Cancel visit; reason selected explicitly. One cancellation POST; exact Patient/branch/appointment readback Cancelled, revision 2. |
| Clean active treatment → Dentist Patient identity summary | 1 activation | Same | Patient records; exact Patient code/name in the authorized projection; no new read/write required for that existing projection. Full clinical profile is explicitly unavailable. Current treatment unchanged on return. |

Appointment and Patient Record screens are byte-identical to J08. Their reference/repeat results are two matched trials of unchanged components on the current server, **not a claimed pair of separate old/new compiled applications**. The component hashes and complete request journals are supplied. Cancellation recovery was not fault-injected in these comparative trials; existing refusal/retry paths and neighboring tests remain separate evidence. Prescription recovery was exercised with actual writes, failure injection and retry.

Remaining: full Staff check-in/appointment benchmarks and any Staff Patient Record workflow belong to the integration/Staff owners. Full Dentist clinical profile review is not available under this checkout's existing product contract. Other appointment-management paths, including rescheduling, were not measured here. These gaps prevent global GEN-09 completion. Original QA ledger remains unchanged: 25 Complete / 32 Partial / 11 Blocked, nine reported integrated acceptances. No whole-QA promotion.

## A13 compatibility checklist

| Concern | Required contract / integration action |
|---|---|
| RA-03 prescription modification/authorship | A13 must enforce current-session Dentist, assignment/author authority, branch membership and immutable author linkage on GET, Update and Issue. This checkout still contains the older branch-wide controller policy. Its `can_edit` is not proof that RA-03 is fixed. J09 changes no controller and does not claim cross-Dentist security acceptance. |
| Fresh unchanged-Draft read | Preserve exact ID, Patient public ID, Visit, branch, revision, lines/note, status and `can_edit`. A changed revision/content or false edit permission must block Issue; no automatic revision substitution. |
| Issue/CAS/idempotency | Existing Issue endpoint consumes expected_revision and the original Idempotency-Key/X-Clinical-Context. The unchanged path uses the saved revision directly. An intervening edit must conflict. Response must retain exact clinical identity/content, Issued status/number, revision +1 and readback; review any deliberate A13 change to `can_void`, which existing client validation expects true for this authorized issuer. |
| RC-02 chart authorization/403 | DentalChart.jsx is unchanged by J09 but appears in the cumulative J04–J09 delta. Preserve A13's authorization correction and meaningful denied state; do not replace it with the frozen pre-A13 file. Retest direct/denied chart reads on combined source. |
| RA-04 follow-up authorization/concurrency | FollowupController.php and clinical follow-up commands are unchanged. Existing follow-up UI depends on canonical task/Patient/branch/status/revision. A13 owns grant/assignment/parallel-update enforcement. No policy bypass or historical participant inference added. |
| Other protected controllers | PrescriptionController.php, FollowupController.php, HmoController.php and StaffProfileController.php are byte-identical to J08 in this delta. No A13 source was fetched into or merged with this branch. Windows safety acceptance remains pending. |
| J03 API/CORS overlap | Cumulative source includes DocumentController.php, DocumentStorageService.php, documents-api.js, document API helpers and exposed X-Document-Id. Merge semantically with newer Windows origins/headers/Sanctum; no wildcard credentialed origin or duplicate ACAO. J09 itself has no API/CORS change. |

Review ServerPrescriptions.jsx and the command helper against any concurrent prescription changes. A13's actual unpublished Windows tree was not available here; this checklist identifies known contract dependencies rather than certifying a conflict-free merge. Never loosen frontend checks to accommodate an unsafe backend.

## Tests and environment

New owned synthetic target: `/private/tmp/jaztin-j09-20261118/target.json`, PostgreSQL loopback port 55547. Exact cluster identity and migration name/hash profile verified. Only owned dental_clinic_demo/test used; 87 existing selected migrations, all four held migrations excluded. No new migrations, grants, AUTO_MIGRATE, historical jobs, workers, external delivery, hosted DB, real financial transaction or A12 active database access.

- Focused frontend/controller/helper: **96 passed**, including catalog coalescing/invalidation, absent/changed identity, dirty/unchanged Issue, failed preflight, auth replacement, lost response, strict clinical fields, stale responses and unverified-Visit write refusal. New tests initially reproduced the redundant Update failure.
- Full frontend: **2,043 passed, eight optional skips, zero failed / 2,051 total**.
- PostgreSQL: **95 tests / 2,040 assertions passed**, covering prescription creation/search/recovery, exact Visit privacy, historical treatment, encounter/chart recovery and Patient documents. These regressions do not certify the known A13 cross-Dentist vulnerabilities.
- Backend units: **252 tests / 1,193 assertions passed**, 30 existing PHPUnit notices.
- Real browser: before/after dispatch measurement, blank/saved/dirty composer, transient failure, explicit retry, denied Visit, Patient issued PDF and failure retry, six widths 375/390/430/768/1024/1440, keyboard recovery/download, and matched owned GEN-09 trials. Full prescription lifecycle browser also passed Draft privacy, stale same-Dentist session rejection, lost-response Issue, exact PDF/VOID readback and explicit separate correction. Treatment remained In Treatment.
- Smoke: **17 groups passed**. Production build passed, **392 modules**. Existing React table-key and >500kB bundle warnings remain.
- Syntax, diff whitespace, scoped secret scan and exact 68-QA reconciliation checks passed. No assertion was disabled. Controller unit fixtures explicitly represent a verified selected Visit; a new negative case proves unverified Save/Issue dispatch nothing. Legacy lifecycle test now expects direct Issue rather than redundant PUT for the unchanged Draft and retains the 409/header/no-issuance assertions.

J08's six predefense failures/six warnings were environment/fixture/readiness findings, not a green application release. J09 reproduces **six failures/six warnings**: inactive worker/scheduler; sparse synthetic Patients; no unpaid invoice; deliberately unconfirmed synthetic branch contact/hours; queued synthetic mail aged beyond ten minutes. Warnings cover excluded external/provider/tunnel checks, missing branch emails, inactive assistant answers and pending jobs/mail. No protected resource or invented clinic data was changed to suppress them. Full deployment readiness is not accepted. After acceptance, both owned databases were snapshotted privately and only their exact API/UI processes and verified PostgreSQL cluster were stopped.

Early harness corrections are recorded honestly: the first attempt tried to leave newly started dirty treatment before saving; the repeated prerequisite later attempted to save an unchanged note; an availability fixture initially used booking-options instead of the existing availability endpoint. Corrected harnesses use an explicitly saved clean starting context and actual available slots. These discarded attempts were not counted as a longer baseline. A fast Visit failure also required the browser harness to await the independent canonical Draft read before testing retention. Final layout captures reset scroll and use the supported Patient deep link; failed-run artifacts are excluded from delivery screenshots, while private logs retain provenance.

## Source and publication state

Verified all named checkpoints are ancestors in one linear history from published J02 `53b0e2e1cea0a1c4db1c498eb80b8fb3e81d77da`. J03 `53aa0f4635eaa1790b57a5a7a766e478807583c4`; J04 `295dc8bad18199a699f8fa310be790a7b513a0f7`; J05 `613a85a508fa7a93ad4842c5f568d5a91d8db878`; J06 `db1eda42170b58a41b596e896c0d460a1b3de4a7`; J07 `e4a3536d4d9fefd128f9d57c67176a5f391ecc2f`; J08 starting SHA above. Fifteen J03–J08 commits precede J09. No missing source-history dependency, rebase, squash, cherry-pick, amend or rewrite. Preserve J06 fixture correction `16a6473041c7f93f01f10fe6b56ac1afdec27219` when reproducing J05 history fixtures.

Historical J03–J08 file manifests were verified against their original Git checkpoints. All six frozen archives remain unchanged; later archives' internal SHA256SUMS verified, while J03's source members were matched directly to its frozen Git tree because that archive predates the checksum-file convention. The new cumulative handoff enumerates every current changed path against J02 and its full normalized/raw hashes.

Remote is the intended `https://github.com/ccadaverr/multibranch-dental-clinic.git`. Read-only remote observation: published Jaztin branch still J02; proposed current branch absent; main `d972ebd9f20890593ce7b218fe7b28315b3b1221`. No fetch/merge of Joevan's moving source or remote write occurred.

GitHub reported zero Actions workflows; main/.github was absent. Public deployment metadata showed 20 Preview deployment records. Webhook listing required unavailable authorization (401). No hosting dashboard branch/preview environment settings could be verified. Current vercel.json rewrites API/Sanctum/broadcasting to the hosted Render API; backend entrypoint starts operational services and explicitly refuses AUTO_MIGRATE=true. **A feature-branch push cannot be certified free of external deployment effects.** Owner must verify/protect or disable feature previews and confirm Render/Railway branch pins before publication. Do not test the uncertainty by pushing or opening a hosted preview. No deployment configuration was modified.

See `JAZTIN_J09_PUBLICATION_PLAN_20261118.md` and the delivery package's literal pinned commands. Source publication and Windows presentation integration are separate decisions. No push, PR, main merge, deployment or integrated QA acceptance was performed.
