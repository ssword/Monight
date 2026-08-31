# Domain Docs

How engineering skills should consume this repository's domain documentation.

## Before exploring, read these

- Root `CONTEXT.md`.
- Root `CONTEXT-MAP.md` if it exists, following it to relevant context documents.
- Relevant ADRs under `docs/adr/`.
- Context-scoped ADRs under `src/<context>/docs/adr/` if the repository later becomes multi-context.

If any file does not exist, proceed silently. Domain-modeling skills create these documents lazily as terminology and decisions are resolved.

## File structure

This repository currently uses a single-context layout:

/
├── CONTEXT.md
├── docs/
│   └── adr/
└── src/

## Use the glossary's vocabulary

When output names a domain concept—including in issue titles, refactoring proposals, hypotheses, and test names—use the term defined in `CONTEXT.md`.

If a required concept is absent, reconsider whether the term belongs to the project or record the gap for domain modeling.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding the decision.
