# Codex Issue Queue

- Repository: `ssword/Monight`
- Label: `ready-for-agent`
- Started: `2026-09-03`
- Baseline commit: `b51f61eddc8ce836314ad795087d6b694d194051`
- Processing order: ascending issue number, one implementation agent at a time

| Issue | Title | Status |
| ---: | --- | --- |
| #25 | Spec: Center reader architecture on the Reading Session | incomplete |
| #27 | Guarantee Reader Action ordering, coalescing, and outcomes | completed |
| #28 | Route Visual State and Zoom Intent through Reader Actions | completed |
| #29 | Open and deduplicate Documents through transactional Document Intake | completed |
| #30 | Route external file sources through Document Intake | pending |
| #31 | Restore Reading Session deterministically through Document Intake | pending |
| #32 | Close, cancel, and reopen Documents through Reader Actions | pending |
| #33 | Encapsulate PDF.js behind Document Content and Document Queries | pending |
| #34 | Route PDF targets and printing through semantic actions | pending |
| #35 | Persist Annotations independently of Reading Session | pending |
| #36 | Persist Recent Documents from explicit Document Intake only | pending |
| #37 | Make Reading Session persistence and shutdown loss-aware | pending |
| #38 | Remove legacy tab authority and reduce startup to composition | pending |
| #39 | Verify desktop adapter contracts and platform lifecycle | pending |

## Results

### Issue #25

- issue_number: `25`
- status: `incomplete`
- commit: `1b06336416d01c79400e0f91718aa371e855e4bd`
- files_changed: `src/__tests__/document-intake.test.ts`, `src/__tests__/dom-events.test.ts`, `src/__tests__/file-actions.test.ts`, `src/__tests__/presentation-controller.test.ts`, `src/__tests__/reader-actions.test.ts`, `src/__tests__/reading-session-store.test.ts`, `src/__tests__/reading-session.test.ts`, `src/__tests__/session-restoration.test.ts`, `src/__tests__/session-state.test.ts`, `src/__tests__/settings-storage.test.ts`, `src/__tests__/tabs.test.ts`, `src/__tests__/window-lifecycle.test.ts`, `src/app/dialogs.ts`, `src/app/dom-events.ts`, `src/app/file-actions.ts`, `src/app/keybinds.ts`, `src/app/presentation-controller.ts`, `src/app/session-state.ts`, `src/app/tab-state.ts`, `src/app/tauri-events.ts`, `src/app/window-lifecycle.ts`, `src/main.ts`, `src/reader/document-intake.ts`, `src/reader/reader-actions.ts`, `src/reader/reading-session-store.ts`, `src/reader/reading-session.ts`, `src/scripts/pdf-viewer.ts`, `src/scripts/settings.ts`, `src/scripts/tabs.ts`
- tests_run: `npm test`; `npm run lint`; `npm run build`; `cargo test --manifest-path src-tauri/Cargo.toml`; focused Vitest suites; `git diff --check`
- test_results: 33 TypeScript files / 155 tests passed; 25 Rust tests passed; focused tests, lint, production build, and diff checks passed.
- acceptance_criteria_results: Criteria 1-8, 10, 13, 15-27, 29-41, 46-53, 57-60, and 65-67 passed or passed for the implemented boundary. Criteria 9, 11-12, 14, 28, 43-44, 55, 62-63 were partial. Criteria 42, 45, 54, 56, 61, and 64 were not met. Criterion 68 was unverifiable without Windows/Linux and full Tauri smoke checks. Detailed per-criterion evidence is retained in the coordinator transcript.
- remaining_problems: Document Content and generation-bound Document Queries remain unimplemented; printing, links, visual mutations, Annotations, and Recent Documents are not fully routed through deep semantic modules; TabManager/PDFViewer still duplicate Reading Session authority and `main.ts` is not only a composition root; Windows/Linux automated runs and cross-platform Tauri smoke checks were not performed.

### Issue #27

- issue_number: `27`
- status: `completed`
- commit: `eb3d5749716b5a035e6db285d0967841eae7719a`
- files_changed: `src/reader/reader-actions.ts`, `src/__tests__/reader-actions.test.ts`
- tests_run: focused Reader Actions tests; `npx tsc --noEmit`; focused Biome check; `npm test`; `npm run build`; `npm run lint`; `cargo test --manifest-path src-tauri/Cargo.toml`; `git diff --check HEAD^ HEAD`
- test_results: 29 focused tests, 169 full frontend tests, 25 Rust tests, typecheck, production build, lint, and diff validation all passed.
- acceptance_criteria_results: Target capture, per-Document/global ordering, relative ordering, absolute coalescing with superseded outcomes, cross-Document independence, commit-after-success, unchanged state on failure/supersession, typed outcomes, and behavior coverage passed. Generation/removal barriers and recovery after projection, persistence, or removal failures were also verified.
- remaining_problems: none.

### Issue #28

- issue_number: `28`
- status: `completed`
- commit: `5fa788cccb1001bd2b1a207ebfd2c44f8eb8ea05`
- files_changed: `src/__tests__/dom-events.test.ts`, `src/__tests__/fit-position.test.ts`, `src/__tests__/gesture-zoom.test.ts`, `src/__tests__/reader-actions.test.ts`, `src/__tests__/reader-input-actions.test.ts`, `src/__tests__/reading-session.test.ts`, `src/__tests__/tauri-events.test.ts`, `src/app/dom-events.ts`, `src/app/keybinds.ts`, `src/app/presets.ts`, `src/app/tauri-events.ts`, `src/main.ts`, `src/reader/reader-actions.ts`, `src/reader/reading-session.ts`, `src/scripts/pdf-viewer.ts`, `src/scripts/tabs.ts`
- tests_run: `npm test`; `npm run lint`; `npm run build`; `cargo test`
- test_results: 181 frontend tests and 25 Rust tests passed; lint, TypeScript, production build, diff checks, and two-axis code review passed.
- acceptance_criteria_results: All seven acceptance criteria passed, including semantic actions for all settled view choices, authoritative per-Document Visual State, Zoom Intent restoration/recalculation, transient-state exclusion, commit-after-render, adapter equivalence, and behavior coverage.
- remaining_problems: none.

### Issue #29

- issue_number: `29`
- status: `completed`
- commit: `08b216e36d6e9f47d3314d0331a9af0f1a5648ed`
- files_changed: `src/__tests__/document-intake.test.ts`, `src/__tests__/reader-actions.test.ts`, `src/__tests__/session-restoration-runtime.test.ts` (removed), `src/__tests__/session-restoration.test.ts`, `src/__tests__/tabs.test.ts`, `src/__tests__/tauri-events.test.ts`, `src/app/document-intake-runtime.ts`, `src/app/file-actions.ts`, `src/app/session-restoration-runtime.ts` (removed), `src/app/tab-state.ts`, `src/app/tauri-events.ts`, `src/main.ts`, `src/reader/document-intake.ts`, `src/reader/reader-actions.ts`, `src/reader/reading-session.ts`, `src/scripts/tab-reading-session.ts`, `src/scripts/tabs.ts`
- tests_run: focused Document Intake, Reader Actions, Reading Session restoration, TabManager, and file-dialog suites; `npx tsc --noEmit`; focused Biome checks; `npm test`; `npm run build`; `npm run lint`; `cargo test --manifest-path src-tauri/Cargo.toml`; `git diff --check`; final two-axis code review.
- test_results: 205 frontend tests and 26 Rust tests passed; typecheck, production build, lint, diff validation, and final Standards/Spec reviews passed with zero findings.
- acceptance_criteria_results: All ten acceptance criteria passed, including early foreground/completion outcomes, source adapter encapsulation, canonical identity and concurrent alias deduplication, existing-Document page activation without reread, transactional PDF acceptance/password/first-render/registration/activation, rollback, independent multi-file outcomes, runtime-state ownership and byte release, post-commit observer isolation, and production/in-memory file-dialog contract coverage.
- remaining_problems: none.
