# Staff R07 implementation notes

This patch consolidates role-scoped Staff CSS from R02–R06 into one active `staff-design-system.css` import and removes the duplicate page name from the Staff topbar.

It does **not** seed Supabase or implement Staff profile photo upload, because the Laravel user/photo storage controllers, models, migrations, and queue/follow-up endpoints were not included in the supplied frontend source bundles.

The 20-row CSV is a scenario plan, not a database seed. Importing it directly would bypass patient/appointment/visit/treatment identity relationships.

For the next integration patch inspect the full backend and these missing frontend sources: `src/pages/ServerFollowups.jsx`, `src/pages/StaffOnDuty.jsx`, `src/pages/Staffing.jsx`, `src/pages/QueueCounts.jsx`, `src/api-client.js`, `src/patient-records-api.js`, `src/patient/Account.jsx` (if present), `src/App.jsx`, `src/Brand.jsx`.

Checks: no API endpoints, database records, payment logic or auth permissions were changed by this patch.
