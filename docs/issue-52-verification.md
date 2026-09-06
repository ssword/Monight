# Issue 52 repair verification

Issue #52 remains **in progress**. This record covers the integrated repair commit and does not
claim native desktop completion for any platform without observed evidence.

## Verification subject

- Repair integration commit: `05949aa203a0dc0f6c9803ab820c19ab30e30a32`
- Verified issue #52 source/CI tree: `a2646a19e046ad25acc9528a0104ac3c0b3ad984`
- Repair issues: #47, #48, #49, #50, and #51
- Verification date: 2026-09-06
- Tester: Codex local verification
- Host: macOS 26.6.2 (build 25G83), Apple silicon (`arm64`)
- Toolchain: Node.js 24.19.0, npm 11.17.0, rustc/cargo 1.98.0

The issue #52 changes are verification-only: line-ending policy, portable Rust test expectations,
formatting of the gesture regression, and this evidence record. They do not change a persisted
schema, domain authority, or reader behavior.

## Local automated evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Focused repair contracts | Pass | 8 files, 164 tests passed |
| Pre-repair regression run | Expected failure | The same 164 tests on `2a82c0c` produced 45 failures and 119 passes |
| TypeScript full suite | Pass | `npm test`; 48 files and 369 tests passed |
| Lint with lockfile Biome 2.3.11 | Pass | `npm ci`, then `npm run lint`; 117 files checked |
| Frontend production build | Pass | `npm run build`; 74 modules transformed |
| Rust suite | Pass | `cargo test --locked --manifest-path src-tauri/Cargo.toml`; 34 tests passed |
| Rust formatting | Pass | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` |
| macOS application bundle | Pass | `npm run tauri:build -- --bundles app` |
| Default macOS installer bundle | Fail | Release binary and `.app` built, then Tauri `bundle_dmg.sh` failed |

The macOS application artifact is
`src-tauri/target/release/bundle/macos/Monight.app` (`CFBundleVersion` 1.0.6, 4.1 MB). The release
binary SHA-256 is `325dd7cfefd8d85335c4e375cbe457bda38344863191d8d73bafd900cc34ed84`.
The artifact has not been used for native interaction checks, so its existence is build evidence
only.

### Old-failure confirmation

The focused suite was overlaid onto detached commit `2a82c0c`, the review baseline before #47-#51.
Observed failures included:

- implicit navigation changed Document B instead of the Document A active at dispatch;
- an action dispatched with no active Document later committed to a newly active Document;
- stale uncertain reads and migration conflicts were not rejected by either durable authority;
- interrupted restoration lacked the shutdown interruption contract and timed out or published;
- lifecycle composition did not stop intake, quiesce Reader Actions, or retain early Quit;
- failed/provisional Document opening did not satisfy cleanup and retry expectations;
- search navigation and public gesture wiring failed at the production workspace boundary.

This confirms the repair regressions are sensitive to the reported old behavior. Some failures
also report missing public methods because those shutdown seams did not exist at the baseline.

Reproduce the comparison from a clone containing `ab1a096`:

```bash
git worktree add --detach ../monight-issue52-baseline 2a82c0c
tests="application-lifecycle window-lifecycle session-restoration document-workspace reader-actions search-navigation-integration gesture-zoom durable-authority-contracts"
for test in $tests; do
  git show ab1a096:src/__tests__/$test.test.ts > ../monight-issue52-baseline/src/__tests__/$test.test.ts
done
cd ../monight-issue52-baseline
npm ci
npm test -- --run $(printf 'src/__tests__/%s.test.ts ' $tests)
```

The expected baseline result is 45 failures and 119 passes. Remove the temporary worktree after
capturing the output.

## Cross-platform CI evidence

There is no CI run for integrated commit `05949aa`: the local `develop` branch has not been
published. Cross-platform verification therefore remains pending.

The most recent published run is CI run
[`33960531622`](https://github.com/ssword/Monight/actions/runs/33960531622) for pre-repair commit
`2a82c0c12a5df5d8aaac4120b922eb08df9147e1`.

| Job | Job ID | Result | Limitation |
| --- | ---: | --- | --- |
| TypeScript macOS | 101291525466 | Pass | Pre-repair commit only |
| TypeScript Ubuntu | 101291525534 | Pass | Pre-repair commit only |
| TypeScript Windows | 101291525525 | Fail | Git checkout converted files to CRLF; Biome reported 110 format errors |
| Rust macOS | 101291525435 | Pass | Pre-repair commit only |
| Rust Ubuntu | 101291525565 | Pass | Pre-repair commit only |
| Rust Windows | 101291525517 | Fail | 4 fixture assertions compared mixed/canonical Windows path forms |
| npm dependency audit | 101291525480 | Pass | Pre-repair commit only |
| Rust dependency audit | 101291525377 | Pass | Pre-repair commit only |

The issue #52 verification changes add LF checkout policy for Biome-supported source/config files
and make the four Rust fixture assertions platform-stable. These are not passing Windows evidence
until a new CI run executes them.

## Native repair checks

No cell below is complete. Automated tests and a macOS `.app` build do not substitute for native
interaction evidence.

| Repair behavior | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Main close during background restoration | Pending | Pending | Pending |
| Application Quit during background restoration | Pending | Pending | Pending |
| Close/Quit while encrypted restoration awaits a password | Pending | Pending | Pending |
| Interrupted saved Documents retained with foreground progress | Pending | Pending | Pending |
| Final-save failure retry and explicit discard | Pending | Pending | Pending |
| Repeated mixed close/Quit requests share one shutdown | Pending | Pending | Pending |
| Closing Settings leaves the main Reading Session active | Pending | Pending | Pending |
| Failed opening cleans provisional state and permits same-path retry | Pending | Pending | Pending |
| Input remains targeted to the Document active at dispatch | Pending | Pending | Pending |
| Cleared/replaced search cancels queued and in-flight navigation | Pending | Pending | Pending |
| Wheel/pinch gesture commits one settled Zoom Intent | Pending | Pending | Pending |

Each completed cell must include tester, date, exact OS version, commit/build identifier, artifact,
and observed result. A result from another platform must not be copied into a pending cell.

## Persistence compatibility

- The shared public authority contract suite passes all 42 Annotation and Recent Document cases.
- Annotation schema version remains 1; Recent Document schema version remains 1.
- Reading Session schema version remains 2; settings storage schema version remains 1.
- Annotation and Recent Document stores, snapshots, clears, failures, and observers remain
  independent in the contract suite.
- No issue #52 source change touches Reading Session, Annotation, Recent Document, or settings
  persistence implementation.

## Remaining limitations

1. Run the current commit through all macOS, Windows, and Linux CI matrix jobs and record the run
   and job identifiers.
2. Complete the native repair matrix above with packaged artifacts on each platform.
3. Diagnose or explicitly waive the failed macOS DMG bundling step; do not identify the failed DMG
   as a release artifact.
4. Keep issue #52 open until every required platform check has passing evidence. Do not close or
   alter parent issue #44 from this verification work.
