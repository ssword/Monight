# Performance Benchmark Report

## Status

Issue #7 is the consolidation step for the performance work. Final before/after
numbers are still pending human collection and review, and this document should
not be treated as the regression baseline until every result row is filled.

Open prerequisite issues at the time this scaffold was created:

- #4 Constant-time continuous-scroll geometry
- #5 Defer loading PDF engine until first document open
- #6 Cap canvas resolution to protect memory at extreme zoom

## Methodology

- App version: 1.0.4
- Device: pending
- Display: pending
- Operating system: pending
- Test files: pending
- Human review: pending

Use `performance.now()` around each measured operation. Collect at least three
runs per scenario, record the median, and keep the same device, display scale,
test file, and build profile between before and after runs.

## Results

| Benchmark | Source | Before | After | Unit | Notes |
| --- | --- | --- | --- | --- | --- |
| Large-PDF open time | #2 | pending | pending | ms | Measure from file-open request through first rendered page. |
| Zoom and rotate latency in continuous mode on a many-page document | #3 | pending | pending | ms | Measure zoom and 90-degree rotate actions separately, then record representative medians. |
| Tab-switch time | #3 | pending | pending | ms | Measure from tab activation request through restored visible state. |
| Scroll frame timing on a long document | #4 | pending | pending | ms/frame | Measure a long continuous-scroll interaction on a document with hundreds of pages. |
| Cold-start-to-splash time and initial main-thread bundle size | #5 | pending | pending | ms / KB | Measure app launch through splash visibility and Vite/Tauri bundle output size. |
| Peak canvas memory at maximum zoom on a high-resolution display | #6 | pending | pending | MB | Measure maximum canvas allocation under the highest supported zoom on a high-DPR display. |

## Collection Notes

- Record the exact test file name, size, and page count before entering results.
- Record whether the app was run from development, debug Tauri build, or release Tauri build.
- Keep debug counters enabled only for collection builds so normal rendering remains unchanged.
- A human reviewer must confirm the numbers are plausible before this document becomes the baseline.
