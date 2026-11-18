# Multi-Branch Dental Clinic Operation System

## START HERE for team testing

Follow the [team UAT runbook](docs/TEAM_UAT_01.md) to start the full application on Windows with Docker Desktop, sign in with locally generated synthetic accounts, and report findings.

## Professor documentation (A9, 2026-10-30)

Read the [academic reconciliation](docs/defense/ACADEMIC_DOCUMENT_RECONCILIATION.md) first. It connects the [Proposed Workflow](PROPOSED-WORKFLOW.md), [official 25-module inventory](docs/defense/MODULES_FINAL.md) and [primary academic paper](docs/defense/BPA_MODULES_UPDATED_OCT_22_2026.docx). The [revised A9 Word candidate](docs/defense/BPA_MODULES_UPDATED_OCT_22_2026_A9_REVIEW.docx) applies the approved qualifications and is **REVIEW REQUIRED**. The [original paper](docs/defense/BPA_MODULES_UPDATED_OCT_22_2026.docx) is unchanged; no visually validated replacement exists. Read the [candidate validation and human checks](docs/defense/BPA_A9_REVIEW_VALIDATION.md) and [section amendment](docs/defense/BPA_OCT22_A9_SECTION_AMENDMENT.md).

For the demonstration, use the [feature/QA matrix](docs/defense/FEATURE_ACCEPTANCE_MATRIX.md), [runbook](docs/defense/SYSTEM_DEMONSTRATION_RUNBOOK.md) and [known limitations](docs/defense/KNOWN_LIMITATIONS_AND_PENDING_QA.md). Historical module counts below are retained baseline classifications, not current full-production acceptance. A8 and B3-B5 remain isolated at this snapshot. B6 now has an isolated synthetic API/rendered report; live browser-to-server and integrated acceptance remain unverified. No shared branch was advanced.


Current Owner Analytics includes authoritative payment/refund charts, a Last 30 Days collections/visit comparison overview, scoped outstanding balances and an accessible weekly gross-bar/net-line chart. See the [professor-ready showcase](docs/defense/OWNER_ANALYTICS_FEATURE_SHOWCASE.md) for definitions, synthetic screenshots and verified limitations; historical milestone notes below retain their original context.

Laravel/PostgreSQL/Sanctum backend and React/Vite frontend for Patient, Staff, Dentist and Owner experiences. Declared dependencies are Laravel ^13.17 and React ^19.1.1. This is the canonical repository for the clinic operations project (client: Dr. Dana Roxas; Business Process Automation, Group 3 — BSIT 3B).

**Historical frontend milestone description:** The protected implementation checkpoint is **`dac864e` — Complete Phase 3.5 safeguards and user acceptance hardening**. Phases 1–3.5 implement and test the frontend workflow with local persistence; they do not constitute a production backend or a finished production UI. Phase 4A (the shared UI foundation) and Phase 4B (the Patient experience, including the M24 Referral & Loyalty prototype) have since been completed on top of that checkpoint; the Staff, Dentist and Owner/Admin role experiences are later phases.

## Current development workflow (2026-10-30)

Patient booking uses server availability and the supported PayMongo test-mode payment/hold workflow; authoritative payment webhooks confirm payment state. Staff admission creates a distinct visit/queue context. Dentist treatment records actual procedures; billing, prescription and follow-up commands retain explicit role authority and confirmations. Server authentication, PostgreSQL persistence, queued email and messaging infrastructure exist; the prototype limitations below are historical, not a description of current backend capability.

A1-A7 and B1/B2 are in development integration at `010a386f147bed285c58821a0a2cc800c393982e`. A8 is accepted on its feature branch; B3-B5 and the newly published B6 report are not integrated. Production/live-provider acceptance is separate. Use the official 25-module mapping in [MODULES_FINAL](docs/defense/MODULES_FINAL.md); historical internal M12/M23/M24/M25 below retain their earlier meanings.

## Historical frontend workflow (Phase 3.5/4B, superseded)

The following milestone description records the earlier browser-only prototype. Its no-payment booking, simulated payment and internal module labels are not current Laravel booking/payment requirements.

**Appointment → Check-In → Queue → Treatment → Performed Procedures → Draft Invoice → Review → Issue → Payment → Receipt**

- Patient booking and its Suggested times use the same scheduling validator. Booking takes no payment. Staff records a distinct arrival; Dentist works from their own exact queue encounter.
- Dentist explicitly documents actual procedures and decides whether a Prescription or Follow-Up is required. Completion closes the linked encounter and prepares administrative handoffs. Nothing chooses diagnosis, procedures or medication automatically.
- Staff reviews itemized treatment-derived charges, issues invoices and records full payment. Card/Electronic is a labeled local simulation.
- HMO is one M12 case lifecycle whose sub-processes stay distinct: local requirements, externally performed submission/provider-response recording, and timestamp-driven contact/follow-up/escalation. Local completeness and escalation never mean provider approval.
- Messages use explicit conversation participants. Notifications use individual recipients, independent unread state and validated destinations.
- M23 coordinates predefined administrative events/actions. Owner/Admin sees a read-only Automation Monitor, not switches for clinical or privacy rules.
- Phase 3.5 adds current-state authorization, encounter/financial integrity, finalized-record protection, stale draft/retry safeguards, storage warnings and spreadsheet-safe CSV output.

Modules follow the official 25-module structure (5 members owning an exact block of 5 consecutive modules; M23 Archives & Historical Records Management) documented in [docs/defense/MODULES_FINAL.md](docs/defense/MODULES_FINAL.md) and [academic reconciliation](docs/defense/ACADEMIC_DOCUMENT_RECONCILIATION.md), strictly aligned with the group's official paper (`BPA_MODULES_UPDATED_OCT_20_2026.docx` and `BPA_MODULES_UPDATED_OCT_22_2026.docx`). The historical official classification inventory is 20 Implemented, 5 Partial and 0 Mock only; A9 does not recertify every subfeature or change those counts. In earlier frontend milestone tests, **M24 and M25 are Proposed Enhancements (PE)** (formerly recorded as Approved Frontend Enhancements): M24 Referral & Loyalty is implemented as a team-designed prototype that is not an established clinic program (Phase 4B.2), and M25 Marketing & Reactivation has only a limited frontend campaign-draft preview today (it sends nothing); full management, consent, targeting, delivery and analytics are deferred to a later role phase. Full historical mapping and reconciliation are documented in [docs/defense/MODULES_FINAL.md](docs/defense/MODULES_FINAL.md).

## Run and verify

Use a Node.js version compatible with the Vite 7 dependency in `package.json`.

```bash
npm install
npm run dev
npm test
npm run test:smoke
npm run build
npm run preview
```

Open the URL printed by Vite. The historical Phase 4B run recorded **402 automated domain/regression/safeguard tests: 402 passing, 0 failing** (260 at the Phase 3.5 checkpoint), 13 passing React render-smoke/integration scenarios and a passing production Vite build. The build has an existing nonfatal JavaScript chunk-size warning. These checks are not full browser automation, accessibility certification, penetration testing or backend integration tests.

## Historical prototype scope and demo data

**Superseded frontend-only milestone:** Accounts use demo sessions and browser state. There is no server authentication/authorization, secure patient-data storage, database locking, cross-device synchronization, real payment gateway, HMO API or email/social delivery. Timers/reminders run only while the frontend is open. Local storage can fail and is not transactionally atomic across collections. See [Frontend Scope](FRONTEND_SCOPE.md).

Names, branch labels, staffing, fees and records in seeds are illustrative, not client facts. The clinic already uses digital booking, billing and records; prescriptions are a paper-based exception. This project addresses workflow coordination, not an entirely manual clinic. The [reconciliation record](DOCUMENTATION_RECONCILIATION.md#client-context) preserves the supplied business context.

**Historical browser-workspace instructions only; not a server-data reset procedure:** The application has no in-app demo reset. To start a local development workspace over, clear this site's browser storage (the `dentalops-v4-*` keys) in the browser's developer tools. Saved historical dates do not advance on reload; pristine seeds use the current Manila clinic date. Unreadable saved data is preserved and requires recovery rather than silent replacement.

## Encryption key

`APP_KEY` in `backend/.env` encrypts Patient messages at rest. **If it is lost, the messages cannot be read.** Back it up in a
password manager. Rotating it requires `php artisan messages:encrypt-bodies --rotate` and signs everyone out. See
`backend/README.md` ("Encryption key") and `docs/M17_REALTIME_MESSAGING.md`.

## Documentation

- [Documentation Reconciliation](DOCUMENTATION_RECONCILIATION.md): source hierarchy, conflicts, policies and Phase 4 inputs.
- [Frontend Scope](FRONTEND_SCOPE.md), [Module Coverage](MODULE_COVERAGE.md), [ERD Alignment](ERD_ALIGNMENT.md).
- [Professor Demo Guide](PROFESSOR_DEMO_GUIDE.md), [Agent instructions](AGENTS.md), [Branding Alignment](BRANDING_ALIGNMENT.md).
- [ERD Data Dictionary](docs/architecture/ERD_v2_Data_Dictionary.md) and unchanged diagrams in `docs/architecture/`.
- [Phase 4B Patient experience and M24](PHASE4B_PATIENT_EXPERIENCE.md).
- Historical implementation records: [Phase 1](PHASE1_IMPLEMENTATION_NOTES.md), [Phase 2](PHASE2_IMPLEMENTATION_NOTES.md), [Phase 3](PHASE3_IMPLEMENTATION_NOTES.md), [Phase 3.5](PHASE3_5_SAFEGUARDS.md), [P0](P0_IMPLEMENTATION_NOTES.md), [P1 UI refresh](P1_PRODUCTION_UI_REFRESH.md).

**Historical Phase 4 planning record (later A/B acceptance is linked above):** Production UI/UX, accessibility and responsive polish belong to Phase 4: the shared foundation (4A) and the Patient role (4B) are complete, and the Staff, Dentist and Owner/Admin role passes remain. The application's visible identity is the clinic's own: **Dr. Dana E. Roxas — Dental Clinic**. It is rendered as text beside the unchanged official compact logo `public/images/logo.png`; the supplied `public/images/logo-with-name.png` is preserved unchanged but not rendered until its usage is confirmed. See [Branding Alignment](BRANDING_ALIGNMENT.md). Internal identifiers such as the `dentalops-v4-` storage namespace are intentionally unchanged so saved workspaces keep loading.
