# YZH-CLIN-04 — Odontogram accessibility and interaction reliability

2026-11-03, Asia/Manila. Developer B / Yzhekiel. Bounded frontend work, awaiting independent audit. No staging, commit, integration or deployment.

## A. Workspace isolation

Current directory, resolved directory and Git top-level were independently verified as `C:/Users/Yzhe Yu/Documents/dental-clinic-odontogram-a11y-20261103`.

- Branch: `feature/yzhekiel-odontogram-a11y-20261103`.
- HEAD: `202e7293ded3a1cf64135a69f4a3f90bf119e67a`.
- Parent: `a6a0de5bf36c77a43d948b98f821940bac41df3d`.
- Subject: `fix(clinical): isolate odontogram drafts and recording lifecycles`.
- The registered worktree and branch already existed from the preceding verification. They were reused; nothing was recreated or switched. Its starting index and tracked/untracked tree were clean.
- Its administrative directory is the distinct `.git/worktrees/dental-clinic-odontogram-a11y-20261103` in the QA-02 repository's shared Git directory.

Completed worktrees were inspected read-only under the Windows owner account because Git rejects their ownership under the sandbox account. No safe.directory configuration was changed.

| Completed directory under `C:/Users/Yzhe Yu/Documents/` | Branch | Preserved HEAD | Expected working state |
| --- | --- | --- | --- |
| `dental-clinic-odontogram-identity-20261103` | `feature/yzhekiel-odontogram-identity-20261103` | `202e7293ded3a1cf64135a69f4a3f90bf119e67a` | Zero staged, unstaged or untracked paths |
| `dental-clinic-b-qa-20261102` | `qa/yzhekiel-ui-20261102` | `e708be43af685a31d7cee2ce651981f7e2a900ae` | Zero staged/unstaged tracked paths; 63 preserved untracked evidence paths |

CLIN-04 depends on CLIN-03 and must not be integrated independently of it. QA-02 remains a separate integration dependency. No Developer A workspace or backend QA branch was accessed.

## B. Accessibility findings

| Hypothesis | Inherited behavior reproduced | Disposition |
| --- | --- | --- |
| H1 — teeth | Enter/Space already activate the correct FDI tooth. Each tooth is a Tab stop; arrows do nothing. Focus outline is removed. Selection has no programmatic pressed state. Universal names lack an explicit FDI/anatomical-side description. Back removes its focused button and loses logical focus. | Confirmed defects corrected in Odontogram/CSS. |
| H2 — surfaces | Native M/O/D/B/L checkboxes provide keyboard access, checked-state announcements and exact synchronization with the pointer diagram. Quadrant-dependent mesial/distal orientation works. All five facets and the checkbox labels have usable targets in the tested layouts. Read-only presentation has no recording controls. | PASS; SurfaceDiagram and ToothTimeline left unchanged. |
| H3 — view/dentition | Controls declare tabs without associated tabpanels or a tab keyboard model. Both view switches already retain the selected tooth/draft. | Replaced incomplete tab semantics with ordinary grouped toggle buttons. |
| H4 — targets | Center taps select the intended tooth; no neighbor selection was reproduced. At 390px all 32 permanent arch targets have a dimension below 24px, and 30 pairs of their 24px spacing circles intersect. There is no equivalent all-tooth control. | Confirmed minimum-target failure addressed by a same-page native chooser, preserving all anatomical hit regions. |
| H5 — confirmation | Native modal entry, Stay, Escape, background inertness, understandable title/body and clean/reverted navigation already work. Two same-tick confirm clicks invoke selection twice. Discard-to-summary removes the return-focus control without a surviving fallback. | Only confirm consumption and surviving focus restoration changed. The existing shared ConfirmDialog remains the sole confirmation mechanism. |

Expected interaction is deliberate tooth selection with accurate identity, visible focus and announced state; view-only changes preserve the editor; dirty context changes require explicit confirmation; read-only users can inspect but cannot record. These are technical accessibility choices, not clinic policy.

## C. Test-first baseline reproduction

Only synthetic tests/fixtures were added before production edits. The fixture server replays the five authorized odontogram production files directly from immutable Git commit `202e7293ded3a1cf64135a69f4a3f90bf119e67a`; it never checks out or edits the completed worktree.

The final inherited matrix at 390px has **6 PASS / 12 FAIL**. The corrected matrix has **72 PASS / 0 FAIL**: 18 cases at 390, 768, 1024 and 1440px.

| Regression | Inherited | Corrected, all four widths |
| --- | --- | --- |
| H1-selected-state | FAIL — missing pressed state | PASS |
| H1-visible-focus | FAIL — no outline/focus stroke | PASS |
| H1-efficient-navigation | FAIL — arrow key does not move focus | PASS |
| H1-summary-focus | FAIL — Back loses focus | PASS |
| H1-anatomical-description | FAIL — no FDI/side description | PASS |
| H2-surface-equivalence | PASS | PASS |
| H2-touch-surfaces-and-targets | PASS | PASS |
| H3-truthful-segments | FAIL — incomplete tab semantics | PASS |
| H4-target-equivalent | FAIL — no equivalent control | PASS |
| H4-target-spacing | FAIL — intersecting undersized-target circles, no equivalent | PASS |
| H4-touch-geometry | PASS — center taps identify the correct tooth | PASS |
| H4-narrow-zoom-layout | FAIL — equivalent chooser absent; not evidence of inherited overflow | PASS |
| H5-modal-safety | PASS | PASS |
| H5-confirm-once | FAIL — selections are `[18,17,17]` | PASS — `[18,17]` |
| H5-chooser-draft-boundary | FAIL — chooser absent; supporting verification of the new equivalent | PASS |
| H5-discard-back-focus | FAIL — no surviving focus destination | PASS |
| read-only | PASS | PASS |
| clean-reverted | PASS | PASS |

Every production correction has a failing inherited behavioral regression. Supporting new-control tests do not imply additional independent baseline defects. Early harness issues (initial cold-load timeout, clicking the empty portion of an irregular group's bounding box, and treating the browser-chrome focus sentinel as an underlying control) were corrected before classification. No production fix was justified by those harness errors.

## D. Implementation and interaction model

Only two production files changed:

- `src/components/odontogram/Odontogram.jsx`: teeth remain button actions in a named toolbar. One tooth is tabbable; Left/Right moves in visible tooth order, Up/Down moves between corresponding arch positions, Home/End moves to first/last, and Enter/Space selects. Moving focus alone does not change clinical selection. Names retain visible numbering/status; descriptions add anatomy, patient side and original FDI. `aria-pressed` exposes selected state. The interactive arch is a group instead of an image. View/dentition buttons use grouped `aria-pressed` semantics and native button keyboard behavior.
- The same component provides a native, labelled Choose tooth select for every tooth of the visible dentition, with full anatomical option names and FDI alongside Universal numbering. All chooser changes pass through the existing dirty-selection/generation boundary. Stay restores its original value/draft; Discard selects a blank editor. Native chooser and dentition-control focus are retained. Disappearing Back/summary controls return focus to the correct surviving SVG tooth. A synchronous pending-target ref is consumed once before applying confirmation, preserving generation invalidation.
- `src/components/odontogram/odontogram.css`: visible focus ring/stroke, a 44px native chooser and bounded reflow. Odontogram imports its previously unreferenced component stylesheet so these styles are present in actual consumers. Existing anatomical paths, coordinates, rotations and pointer hit regions are unchanged.

No second modal, clinical field, persisted draft, diagnosis, policy, API, authentication or backend change was added. SurfaceDiagram, ToothTimeline, ChartSummary, DentalChart, Patient Teeth and the historical regression files/reports remain unchanged.

## E. Clinical safety invariants

Each row passed against corrected production components with synthetic intercepted API responses. CLIN-03 assertions were retained, including original-patient/tooth/body and authoritative-update assertions.

| Required invariant | Executed evidence |
| --- | --- |
| 1. A's draft cannot appear under B | unsaved-fields/isolation; dentition-isolation; summary-dentition; chooser-draft-boundary |
| 2. Patient A's chart cannot appear under B | patient-success; patient-failure; patient-unsaved |
| 3. Delayed success cannot reset a newer editor | save-success; rapid-success; back-pending-success; active-save |
| 4. Delayed failure cannot enter the wrong editor | save-failure; rapid-failure |
| 5. A → B → A cannot revive stale ownership | rapid-success/failure; synchronous confirmation consumption |
| 6. Duplicate submission stays blocked | duplicate-submit, including same-tick native form submits |
| 7. Unexpected rejection releases recording locks | thrown-retry; network-retry |
| 8. Original identity and submitted body are immutable | race assertions compare original patient pA, tooth 18, status, surfaces, note, date and branch; subsequent explicit B save is compared separately |
| 9. Dirty navigation needs intentional confirmation | Stay/Discard, keyboard tooth/dentition changes, patient-unsaved and native chooser; clean/reverted forms do not prompt |
| 10. Read-only users cannot record | actual Staff ChartView and Patient Teeth fixtures, plus shared-component read-only cases |

The unchanged CLIN-03 script passed **92/92 against the inherited commit**. The corrected source passed **92/92 through `yzh-clin-04-safety.mjs`**, which adapts only tab-role locators to the intentional button semantics. A second **92/92 replay** additionally routes its existing `pick` helper through the new native chooser. No historical assertion is removed or weakened. One earlier chooser replay had a 2.5-second synthetic patient-picker boot timeout during concurrent browser activity (91/92); the complete isolated replay then passed 92/92 with the original timeout and assertions.

## F. Accessibility and responsive verification

- Keyboard: actual browser Tab, arrows, Home/End, Enter, Space and Escape; permanent/primary dentition; top/front views; exact selected FDI and clean draft boundaries.
- Accessible semantics: role-based locators resolve real accessible names; Chromium's platform Accessibility tree independently exposes button role, Universal tooth name, FDI/anatomical description and pressed state. This is not a screen-reader speech test.
- Focus: visible SVG focus verified by computed paint and screenshots; return from summary/confirmation tested against `document.activeElement`. Native modal isolation prevents focus reaching underlying controls. Chromium can move through browser chrome with `document.activeElement` represented by body; the test distinguishes that sentinel from a focused background control.
- Touch: all 104 teeth across both dentitions and both views are tapped at each width, with exact FDI checks. Centers are verified through `elementFromPoint`, rather than using a group's number-inclusive bounding box as its hit region. No invisible expanded hit areas were added.
- Surface touch: all five facets on Q1–Q8 are toggled on/off; every tap checks the exact checkbox set. Each convex facet has a sampled inscribed 24px square, including its corners, and each existing checkbox label meets 24px in both dimensions. Native keyboard checkboxes remain the accessible alternative; no redundant interactive facets were added.
- Tooth target assessment uses actual painted-shape bounds and spacing-circle intersections to establish the inherited failure. It does not assert that an irregular SVG bounding box is itself compliant. The full-size chooser supplies the equivalent action for every visible tooth. Measured chooser width/height: 390px viewport = 324×44; 768 = 702×44; 1024 = 554×44; 1440 = 970×44 CSS px.
- All four widths pass document-overflow checks. A 195 CSS px viewport models the reflow width of 390px at approximately 200% browser zoom; this is a viewport-equivalence test, not a real-device zoom test.
- Reduced-motion browser captures pass at all four widths. The 390px focus/dialog, 768px focus and 1024/1440px front-editor captures were visually inspected. Existing subtle transitions are unchanged.

Standards basis: [W3C SC 2.5.8, including the equivalent-control exception](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [APG button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/), and [APG modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). No full WCAG conformance claim is made.

## G. Independently executed checks

| Check | Result |
| --- | --- |
| Focused M10 Node regressions | 4 passed / 0 failed |
| Immutable inherited accessibility matrix | 6 passed / 12 expected failures at 390px |
| Corrected accessibility/interaction matrix | 72 passed / 0 failed at four widths |
| Unchanged CLIN-03 script on inherited source | 92 passed / 0 failed |
| CLIN-03 assertions on corrected source, role adapter only | 92 passed / 0 failed |
| CLIN-03 assertions on corrected source, chooser selection adapter | 92 passed / 0 failed on complete isolated replay |
| Reduced-motion visual capture | 4 widths passed; 12 screenshots in Temp |
| `npm.cmd test` | 1025 passed / 0 failed / 5 existing skips, 1030 total |
| `npm.cmd run test:smoke` | PASS; existing Table key warning remains; logo hashes pass |
| `npm.cmd run build -- --configLoader runner` | PASS; existing >500 kB chunk warning remains |
| `git diff --check` / `git diff --cached --check` | Both exit 0 |

Initial sandbox test/smoke attempts encountered esbuild access-denied errors through the dependency junction. Both checks were rerun successfully under the owner account; those access failures were not treated as application defects. No package was installed. An ignored node_modules junction in this worktree reuses the existing QA dependency installation. Fixture-server caches remain in Windows Temp. Build/OCR outputs are ignored outputs in this worktree only.

No backend suite, migrations, seeders, database-writing tests, hosting/predefense acceptance or real clinical/provider calls were run. This task's frontend-only/synthetic restrictions supersede general repository implementation gates requiring backend/predefense work or commits.

Evidence is outside the repository in Windows Temp:

- `yzh-clin-04-final-before/results.json` and `yzh-clin-04-final-before.log`.
- `yzh-clin-04-final-after/results.json` and `yzh-clin-04-final-after.log`.
- `yzh-clin-04-inherited-before/results.json`.
- `yzh-clin-04-safety-after/results.json`.
- `yzh-clin-04-chooser-safety-final/results.json`.
- `yzh-clin-04-visual/` with screenshots and results.
- `yzh-clin-04-full-test.log`, `yzh-clin-04-smoke.log`, `yzh-clin-04-build.log`.
- `yzh-clin-04-final-inventory.json`, the final SHA-256 inventory including this report.

Replay uses existing Playwright/Chrome. Start `node tests/yzh-clin-04-server.mjs --baseline` on port 5194. In another shell set `CLIN04_PORT=5195` and run `node tests/yzh-clin-04-server.mjs`. Set `CLIN04_URL=http://127.0.0.1:5194` for `node tests/yzh-clin-04.browser.mjs --baseline`, and `http://127.0.0.1:5195` for corrected-source runs. Set `CLIN03_URL=http://127.0.0.1:5195/tests/fixtures/yzh-clin-03.html` for `node tests/yzh-clin-04-safety.mjs`; additionally set `CLIN04_SELECTION=chooser` for the chooser replay. Give each replay a distinct CLIN03_EVIDENCE_DIR or CLIN04_EVIDENCE_DIR under Temp. The task's fixture servers are stopped after verification.

## H. Git integrity, ownership and hashes

All changes below belong to Developer B's bounded CLIN-04 task. Final expected inventory: **2 modified tracked files, 7 new task files, 0 staged files**.

```text
 M src/components/odontogram/Odontogram.jsx
 M src/components/odontogram/odontogram.css
?? docs/YZH_CLIN_04_REPORT.md
?? tests/fixtures/yzh-clin-04.html
?? tests/fixtures/yzh-clin-04.jsx
?? tests/yzh-clin-04-server.mjs
?? tests/yzh-clin-04.browser.mjs
?? tests/yzh-clin-04-safety.mjs
?? tests/yzh-clin-04-visual.mjs
```

Final production SHA-256 hashes:

```text
1a0cea731dbe7956dd4555c97f6a4922834796ee3f8730f9ed008e945e2139bc  src/components/odontogram/Odontogram.jsx
32071df16ecfbee38d08e99689989a78a3e9053dc5e971ea81c0fc27024fe54b  src/components/odontogram/odontogram.css
```

Result matrices include all five production source hashes; the external final inventory includes hashes for all nine task files without a recursive self-hash in this report. Historical files are not regenerated or rehashed in bulk. Final preservation checks verify the original branches/HEADs, clean tracked trees/indexes and QA-02's same 63 untracked paths. No original QA evidence or CLIN-03 report/regression file was edited. The complete diff/new-file set was reviewed and scanned for common secret patterns without printing any secret values.

No staging, commit, push, merge, cherry-pick, rebase, reset, restore, clean, stash, worktree operation or database action was performed. Existing module classifications remain unchanged. The chart feature's status note can now say: bounded keyboard/focus/target-equivalence corrections implemented and synthetic-browser verified, with clinical identity safeguards retained; real assistive-technology/device and authenticated integration acceptance remain pending. No academic or canonical module document was edited.

## I. Limitations

This verifies frontend behavior using production React components, synthetic data and intercepted API responses. It does not certify authenticated authorization, durable backend writes, cross-device idempotency, clinical anatomical approval or private-data policy. No NVDA, JAWS, VoiceOver, physical touchscreen or real mobile-browser zoom session was used. Chromium accessibility-tree inspection does not replace screen-reader acceptance. An axe installation was not available; no dependency was added. Preexisting tiny SVG labels/anatomical presentation were retained within the no-redesign boundary. The chart-wide/unknown-response limitations documented by CLIN-03 remain unchanged.

## J. Recommendation

**READY FOR INDEPENDENT READ-ONLY AUDIT**

Stop here. Await the independent audit and explicit later commit authorization.
