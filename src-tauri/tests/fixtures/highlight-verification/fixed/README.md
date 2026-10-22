# Fixed-candidate Highlight evidence (#124/#127)

See [the admission record](../../../../../docs/issue-124-127-highlight-admission.md)
for exact candidate identity, native actions, scope and screenshots. Parent PDFs
are the genuine native-reader regression inputs from the earlier matrix; these
outputs were saved by the packaged fixed candidate. Files are not synthesized.

Run `python3 verify.py` with pypdf installed. It verifies checksums, exact decoded
native appearances/resources (float geometry tolerance 0.001pt), RGB tolerance
±1/255, identities, comments/replies, page content and rotations. It also checks
fresh fixed-build creation/Preview edits/Monight return and a genuine colour edit.

The parent `verify.py` remains the historical expected-failure verifier. Its
strict mode is supposed to fail on the original failed outputs; use this verifier
for the fixed candidate's admission result.
