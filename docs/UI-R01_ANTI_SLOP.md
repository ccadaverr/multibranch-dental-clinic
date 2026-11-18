# UI-R01 clinic interface refinement

Starting point 87f41696561872fc24d399901b25d16e5afa1dce. The A16 presentation worktree and runtime were preserved. Browser comparisons use the frozen A16 archive on 5472, the UI-R01 worktree on 5471 and an independent synthetic PostgreSQL restore on API port 8471.

| PDF page | Components and outcome |
| --- | --- |
| 1 | The public landing page puts booking and sign-in above the fold and gives branch and service links their own compact space. Appointments separate the lifecycle and booking-payment columns. The payment badge in the telemetry annotation now shows an explicit payment label, a wallet icon and a distinct treatment. The app has no separate system-health telemetry source. |
| 1–2 | The operational notification dialog groups Inbox and Archived, shows server unread counts and uses compact dated rows. Long bodies have disclosure. History expansion appears when it adds rows, and cursor pagination is retained. |
| 2 | Scheduled arrival guidance and historical restoration limits use inline text. Clinical notices, live errors and retry decisions remain visible. |
| 3 | Walk-in admission uses a 180 ms entry/exit transition with reduced-motion support. Focus enters the inline form, and Escape returns focus to the opener when no command or picker is active. The form remains inline and registration safeguards are unchanged. |
| 3 | Dentist wording review prioritizes subject, message, approval prerequisites and approval action. Formatted preview is loaded on request and can be collapsed. |
| 3–4 | Dentist Patient Records uses full-width identity rows, clearer search states and a selected indicator. Sidebar icons now distinguish the chart, handovers, work hours and leave with the shared line icon family. |
| 4 | Dental Chart labels M, O, D, B and L with their full names. The five stored codes and whole-tooth behavior are unchanged. |
| 5 | Archive details group identity, Visit context and settlement. Confirmed amounts retain centavo precision and authorized receipt actions remain intact. Audit groups the four loaded counts in a single panel labeled with its filter and pagination scope. |

## Design references

- [Impeccable](https://github.com/pbakaus/impeccable) informed the compact task hierarchy, reduced nesting and matched viewport review.
- [Make Interfaces Feel Better](https://github.com/jakubkrehel/make-interfaces-feel-better) informed restrained motion, visible focus, semantic icons and tabular figures.
- Adapted visual redlining guidance from [Unslop by Damir Sokolovsky](https://github.com/heydamir/unslop), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Jaztin’s [J08 attribution](JAZTIN_J08_UNSLOP_20261118.md) is retained.
- [daisyUI](https://github.com/saadeghi/daisyui/tree/master/skills/daisyui) served as a pattern reference for alert, badge, disclosure, focus and dialog behavior. UI-R01 uses the existing Inter/system type, CSS variables, React controls and native elements.

## Verification notes

The local evidence folder dentalops-local-backups/UI-R01-evidence contains the reviewed PDF renders, the screenshot index, six-width pairs and command results. Browser comparisons use 375, 430, 768, 1024, 1440 and 1920 px. Synthetic predefense reported zero failures and five expected local-runtime warnings before workflow fixtures were exercised.

The failed-login emitter calls recordAuth with its default info severity. Audit displays the persisted severity and counts security-category membership independently. Severity classification remains a backend decision. The focused PostgreSQL run also surfaced the existing Audit CORS test’s stale exposed-header list, which omits the document ID header.
