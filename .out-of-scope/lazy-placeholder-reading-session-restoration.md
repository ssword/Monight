# Lazy-placeholder Reading Session restoration

Monight does not defer restoration of saved Documents by creating placeholder
entries that load only when first activated.

## Why this is out of scope

The accepted reader architecture routes restoration through Document Intake so
that startup behavior is deterministic and each saved Document receives a real
intake outcome. The explicitly requested Document, or otherwise the saved active
Document, restores first; the remaining Documents then restore sequentially in
saved order without taking activation.

Lazy placeholders conflict with that model. They postpone validation, password
handling, cancellation, and missing-file failures until an unrelated later
activation. That prevents restoration from pruning unusable Documents from the
corrected Reading Session and from reporting one complete startup summary.

The replacement behavior is specified by #31 and follows the architecture
decision in `docs/adr/0001-center-reader-architecture-on-reading-session.md`.

## Prior requests

- #19 — "Lazy Reading Session restore with placeholder tabs"
