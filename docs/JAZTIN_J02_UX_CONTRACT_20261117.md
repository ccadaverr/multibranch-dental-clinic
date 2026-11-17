# J02 Clinical/Patient UI contract

Original Clinical-branch work, Asia/Manila, November 17, 2026. No production or Windows integration acceptance is implied.

## Scope and source

`src/patient/care-experience.css` styles content below the existing Patient shell. `src/clinical-care-experience.css` requires `.clinical-experience`, currently set only on the Dentist prescription page and exact encounter workspace. Neither file changes root tokens, shared buttons, application navigation, notification styles, fonts or clinic artwork. Both use the existing font stack, restrained teal/slate surfaces, 400/500/600 hierarchy, 15px body, 16px mobile inputs, tabular dates/amounts, flat 12–14px cards and existing shared controls. Narrow screens stack the appointment/balance and care contexts. Local `--care-*` aliases are a scoped bridge, not a replacement global theme. Joevan may map their values to the latest approved global tokens after checking contrast and six widths.

Home groups next appointment, verified next steps and care records. Booking, visits, archives, prescriptions, billing and documents retain every existing destination and interaction; they inherit scoped type/surface conventions. Family adds safe cancellation of an unsubmitted draft and returns keyboard focus to Add. During an uncertain creation cancellation remains disabled; the original same-key recovery must resolve first. No invitation was sent in acceptance.

The encounter header remains visible below the measured existing topbar. Full Patient name/code, branch, assigned Dentist, clinic date, Visit public ID and treatment status remain visible. The original identity block still exposes appointment/Visit and saved encounter revision. Progress labels describe server-established state; they do not perform a clinical transition. Documentation groups performed care, notes and Dentist-selected next care. Dirty progress has one primary Save; completion remains disabled until saved, requires the existing explicit confirmation, and produces a read-only record.

Global Dentist Prescriptions starts with the searchable saved list and a keyboard-operable Write disclosure. Exact Visit entry and editing open the form. Collapsing does not unmount the form or unregister unsaved-work protection. Editing an existing draft opens/focuses the disclosure after the existing leave guard. Optional license settings have a separate disclosure. Staff/Owner presentation is unchanged.

## Persisted read contracts

There are **no backend application, route, schema or API-client changes**.

Home uses existing `/me/dependents`, active-status `/appointments` pages and `/invoices/mine?status=Issued` cursor pages. The current session must be active Patient, have exact server/public Patient IDs, match `/me`, and retain its auth generation. Family metadata must identify that Patient. Every adopted appointment/invoice must belong to that Patient or an explicitly returned dependent. Invoice totals require all pages, canonical identities/amounts, nonrepeating cursor/record identities and integer-centavo accumulation. An error hides the total; a partial subtotal is never labelled as the balance. Active appointments retain the existing ascending status-page contract; completed/cancelled history does not block next-visit loading. Requests are bounded and late results cannot dispatch further pages after losing ownership.

Completed encounter follow-ups use existing `GET /patients/{exact-public-id}/followups`. Validate Patient, branch identity, unique task IDs, revision, status and display fields before adoption; project the selected branch. The resource does not identify source treatment, so copy explicitly says these are Patient tasks at this branch. Do not infer treatment linkage. A rejected/hung/foreign/stale response is not an empty successful list. Icon loading follows the actual read, and reload recovers independently of clinical writes.

This is presentation validation over existing server authorization. CAS, write idempotency, current session/branch enforcement, historical integrity and exact Visit linkage remain authoritative on the backend. No new diagnosis, medication, follow-up policy or reminder is generated.

## Usability application

Hick: one next-visit action and a collapsed optional composer. Fitts: existing shared controls plus large care-record links. Miller/Gestalt: three encounter groups and separate identity/progress. Jakob: familiar calendar date tile, explicit saved-record search and native disclosure. Tesler: complete authorized page traversal behind the balance. Zeigarnik: current saved revision and unsaved progress. Nielsen: real loading, bounded failure, retained text and same-operation recovery. Postel: readable labels while refusing malformed clinical identities. No artificial click benchmark or GEN-09 acceptance is claimed; Codex B owns that work.

Workflow references reviewed for principles, not copied UI/assets: [Open Dental Patient Dashboard](https://www.opendental.com/site/0_patientdashboard.html), [Open Dental Chart](https://www.opendental.com/site/0_chart.html), [Dentrix patient visit procedures](https://hsps.pro/Dentrix/Help/Routines/Procedures_for_patient_visits.htm). These support at-a-glance upcoming care and keeping clinical work anchored to the selected Patient. The design and source are original to this repository.

## Integration boundaries

Apply source commits to a review branch based on Joevan's latest source; do not merge this stale checkpoint wholesale. Review `src/patient/Portal.jsx`'s single Home prop/key wiring and scoped CSS import. Other touched domain components may have moved in Windows: reconcile guards and props semantically. Preserve newer GEN-07 fields, GEN-10 notification contracts, GEN-12 Button/RefreshButton, queue FIFO/history, workforce publication, grants and settlement stabilization. No migration, grant, queued-job processing or financial cutover is required for J02. Existing synthetic test setup deliberately omits held migrations/grants; never run an unfiltered migration chain to accept this patch.
