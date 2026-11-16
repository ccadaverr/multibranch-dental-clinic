# Codex B Round 3 — archive branch and detail identity

Starting HEAD: 472b3ba2f68fd061f940cd17c45886b3cb405bbf on feature/joevan-qa-20261115. The starting tree was clean. Round 2 commits 3cc49c1 and 472b3ba are present. All 12 Round 2 files remain frozen here.

## Original criteria

- GEN-11: "No record is permanently deleted by normal users; each role sees only permitted archives; Dr Dana sees all."
- STF-25: "View action is clear, correctly sized, and opens the archived record."
- DEN-16: "Dentist archives match staff UI and are RBAC-scoped."

Claimed paths: src/pages/ArchivesPage.jsx, tests/arc02-archive-scope.test.js, and this document. These are outside the 12 Round 2 paths and A's shared integration and workforce paths.

Investigating two independent archive readback defects: branch names are used as filter identity, and selected detail validates record and patient identity without validating the branch. Use the existing scoped server appointment projection and exact branch references. Both defects were reproduced on the prior component. The Dentist render also showed the wrong branch when its stale display name matched an assigned branch.

## Completed archive fixes

- The branch selector, tables and visible-row CSVs share the canonical branch ID. Duplicated labels are distinguished with branch code or stable reference. Renaming a branch preserves its local selection. An ambiguous or unavailable named shell branch requires a new selection and cannot widen to all branches.
- Staff records remain limited to existing authorized branch scopes. Dentist records require both existing dentist identity and an assigned branch ID. Legacy reference labels can resolve only uniquely; a record's own label cannot grant authority. The Owner retains the existing scope.
- Open detail retains exact collection, record, patient and branch identity. A branch reassignment closes the current detail and requires reopening the new projection. A missing branch identity can only retain the same projected record object.
- The existing authorized readback is sourced from GET /api/appointments, AppointmentController::index and Appointment::visibleTo. No route, schema, authorization policy or clinical semantics required edits. The changes use the existing bounded working projection.

## Verification

- Focused Node command: node --test tests/arc02-archive-scope.test.js tests/aud03-archive-feedback.test.js tests/m23-archives.test.js tests/ui-foundation.test.js. 49 passed. The opt-in browser group was exercised separately.
- Chrome drove the actual ArchivesPage in its synthetic fixture at 390 and 1440 px, with nine scenarios at each width. It verified duplicate names, a rename, exact branch rows/CSV across all three categories, scope loss, role changes, stale patient and branch identity, and reopening the exact record. No real patient or clinic data entered the fixture.
- The existing real PostgreSQL AppointmentAuthorizationTest passed 15 tests and 85 assertions using B's guarded dental_clinic_test on container loopback port 55517. Test target snapshot retained and B runtime stopped. Existing route and model files were verified against the source snapshot. No migration run and all four holds preserved.
- Scoped diff whitespace and credential-pattern scan passed. No introduced failures remain in the focused runs. Combined suites, smoke, global build and hosted predefense were deferred under the parallel Round 3 scope.

## Commit handoff

READY FOR CODEX A COMMIT. At review, HEAD was 46d604bc005a96e2e91ae231db61e12e7ab34662. Round 3 changed only src/pages/ArchivesPage.jsx, tests/arc02-archive-scope.test.js and this new document. All 12 Round 2 files and A-owned files remain untouched by B. No A-owned wiring request and no Git writes by B.

STF-25 and DEN-16 read-only view criteria are locally acceptance-ready within approved permissions. GEN-11 remains partial: universal access to private notifications or clinical records and unspecified restoration/permanent removal conflict with approved policy. No additional independently actionable original requirement was established. The current appointment window and transitional prescription/invoice projections do not constitute a complete archive of historical or archived entities. Extending them to other entities needs explicit permissions and lifecycle contracts.