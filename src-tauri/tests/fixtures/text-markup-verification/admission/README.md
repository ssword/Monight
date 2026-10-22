# Native #116 admission snapshots

Disposable synthetic PDFs saved through the packaged Monight, Preview 11.0 and
Acrobat Reader 26.002.21901 interfaces on 2026-10-22. See
[the admission record](../../../../../docs/issue-116-text-markup-admission.md)
for candidate identity, operator actions and native observations.

- `monight-created-snapshot.pdf`: candidate-created Underline on `sun` and
  Strikethrough on `gypsy` in the existing `../selection-fonts.pdf` input.
- `{reader}-edited-snapshot.pdf`: the reader's exact saved comment edits.
- `{reader}-deleted-return.pdf`: the reader's exact saved annotation deletion.
  Preview leaves two orphan Popup objects; neither parent markup remains.
- `{reader}-roundtrip-final.pdf`: Monight re-edits of reader-edited comments.
- `{reader}-monight-deleted.pdf`: Monight deletion of both returned markups.
- `{reader}-origin-edited.pdf` and `-origin-deleted.pdf`: Monight edits/deletion
  of marks genuinely created in that reader. Acrobat's original is
  `../acrobat-text-markups.pdf`; Preview's is `preview-origin-input.pdf`.

`candidate.patch.gz` contains the exact pre-build delta against
`fa437d96e80e212dfdec0ec78ffaa0b7f4bcc18f`. `SHA256SUMS` pins retained PDF bytes;
`inventory.json` records saved annotation dictionaries and decoded stream hashes.
With pypdf installed, run `python3 verify.py` to compare all 13 saved stages with
the source PDFs, require unchanged page boxes/content/rotation, exact appearance
programs and geometry across comment edits, and no deleted parent marks.
Native screenshots remain in the local evidence directory named in the record.
