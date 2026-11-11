# AUD-04 Patient More accessibility — Sprint 02

2026-11-11, Asia/Manila. **CONDITIONAL: scoped source implementation acceptable for controlled commit review; native screen-reader/device acceptance remains outstanding.** Nothing committed, pushed, merged or deployed.

## Isolation and baseline

Branch: `fix/jaztin-aud04-patient-more-20261111`.
Worktree: `/Users/glesielynalcantara/Documents/dentalops-integrated-review/scratch/integration-abc-20261111/scratch/aud04-patient-more-20261111`.
Starting/current HEAD: `e5159eeb22b9611a6ff8a7dab4257f58cab3a479`.
Verified the destination branch/path absent before creation. Local and remote baseline, AUD-01 and AUD-07 matched their supplied SHAs. Existing worktrees/evidence were preserved.

Read the preserved full-system summary, defect register and failure classification under `scratch/int-abc-20261111-evidence/post-integration-audit/` in the parent repository. AUD-04 correctly identifies a visually modal mobile navigation sheet implemented as a plain `div role=dialog` without a focus or modal lifecycle.

## Original failure and minimal correction

Before changing production source, the real PatientPortal probe at 375px found: initial focus outside More; no native dialog or aria-modal attribute; **11/18 Tab stops** on background controls; programmatic background focus succeeded; **Escape did not dismiss**. Original-source JSON is preserved at ignored `scratch/aud04-before.json`.

Replaced the More wrapper with the existing shared `Modal` in `src/components.jsx`. That component calls native `showModal`, provides a labelled heading/Close action, handles cancel/Escape and backdrop dismissal, restores previous connected focus and body scrolling, and cleans up on unmount. It is reused without modification. More's opening button explicitly takes focus before opening so pointer activation also supplies a reliable restoration target, and now declares `aria-haspopup=dialog` alongside its existing expanded state.

The same seven shortcuts and Sign out confirmation remain. Scoped CSS keeps More a bottom sheet with a viewport-safe scrollable body and a 480px maximum width. No new keyboard listener, authentication logic, backend change, navigation destination or shared-component API was introduced. No unrelated overlay was changed.

The portal's existing desktop breakpoint is **960px**, not 1025px. At 1024/1440px, normal navigation stays in the sidebar with More hidden. Responsive modal tests open More at 768px, resize to those desktop widths, verify that the active modal remains usable, then dismiss it. Restoration to a now-hidden trigger is not asserted; it is asserted whenever the trigger remains visible.

## Executed verification

| Check | Result |
| --- | --- |
| Focused existing Patient portal/notification tests | **28/28 pass** |
| Deterministic browser acceptance | **8/8 pass**, zero captured runtime page errors |
| Five-width matrix | 375/430/768/1024/1440px pass; no page-level horizontal overflow |
| Feature full frontend suite | **1288 pass, 18 fail, 8 skipped, 6 TODO** (1320 total) |
| Fresh exact integrated baseline | Same counts and exactly the same 18 failing case names |
| Production build | **Pass**, `npm run build -- --configLoader runner` |
| Smoke | Existing HMO `Record Provider Response` assertion at `scripts/render-smoke.mjs:190` remains; earlier renders/workflow assertions pass |
| Diff whitespace and changed-file secret scan | Pass |

Browser cases use the actual PatientPortal under StrictMode with intercepted synthetic responses, not a copied More implementation. They cover keyboard/pointer opening, initial focus, all retained shortcut names, repeated Tab/Shift+Tab, inert background focus, Escape, Close, backdrop, restoration, real Billing navigation/main focus, Sign out confirmation/Cancel, repeated openings, unmount and scroll cleanup. No mutation transport was dispatched.

Native dialogs may offer browser chrome a boundary Tab stop; each width recorded two BODY/browser-chrome stops across 36 key presses. **No obscured application control received focus.** This is distinguished from the original 11 background-control stops and does not claim to trap browser chrome.

Final results: ignored `scratch/aud04-after.json`. Visual checks: `scratch/aud04-more-375.png`, `scratch/aud04-more-1440.png`. Runner: exported `runMoreAcceptance(page, base)` in `tests/aud04-patient-more.browser.mjs`, default base `http://127.0.0.1:5184`. Diagnostic mode records original failures; normal mode asserts zero failed cases.

Logs: `/private/tmp/aud04-{focused,frontend,build,smoke}.log`, `/private/tmp/sprint02-baseline-frontend.log`. Sprint baseline snapshot under `scratch/sprint02-baseline/` was verified against all **1,865 tracked Git blobs** at the starting SHA. It is an unmodified baseline, not a copy of AUD-04 edits, and may be read for Task B's comparison.

No native screen reader, physical touch device, browser beyond Chromium, forced-colour or full-system accessibility acceptance was exercised. Pointer and keyboard use were tested; real clinical data/workflows were not. Existing bundle-size/missing OCR asset warnings remain. The database-backed suite and predefense script were not run because this sprint excludes database/provider operations. Existing 18 failures are not waived or claimed fixed.

## Final source review, preservation and integration

A separate self-review checked production source, shared Modal behavior, cleanup/focus ownership, desktop breakpoint, original shortcuts/confirmation and all new fixtures. No blocking source/security defect was identified. This is not a second human/agent review or production certification. Jakob's Law: standard native dialog behavior; Hick's Law: unchanged shortcut choices; Fitts's Law: existing usable controls; existing field/action grouping and clear close affordance retained.

Exact manifest (two modified production files, four new files):

```text
src/patient/Portal.jsx
src/patient/portal.css
tests/aud04-patient-more.browser.mjs
tests/fixtures/aud04-patient-more.html
tests/fixtures/aud04-patient-more.jsx
docs/AUD04_PATIENT_MORE_ACCEPTANCE.md
```

No overlap with AUD-01/AUD-07's committed `src/layout.jsx` changes. The shared `src/components.jsx` is reused unchanged. No expected source conflict with independently implemented AUD-03; integrate each as a separate logical commit and recheck the combined UI. Runtime permissions, message/notification privacy, clinical/financial policy and module status remain unchanged. No module-status promotion or DOCX edit.

Task A validation is complete with inherited limitations only. Preserve this uncommitted worktree and continue to Task B from the exact integrated baseline. Commit/publication still require subsequent approval.
