# Native Preview Page Rotation acceptance

Disposable synthetic fixtures from the 2026-10-22 native acceptance of #115.
See `docs/issue-115-page-rotation-verification.md` for candidate identity and provenance.

| Snapshot | SHA-256 | Page rotations |
| --- | --- | --- |
| `preview-rotation-highlight-note-removed.pdf` | `d3d97eb2869f93fb144b6ea6b6806d7ba392a1e62197efcb7a8eb4f185970497` | 180, 0, 0 |
| `preview-rotation-monight-final.pdf` | `dc99e180ed47c78740aabb36b5d4d6c4aa660535bef59e27217522fdcc557696` | 90, 0, 0 |

Preview removed only the Highlight's attached note, retaining its mark. Monight
reopened it, edited the existing Text note and Highlight contents, rotated page 1
left and saved. Native Preview then displayed the exact edited contents and
correctly placed marks and note icons. Page contents and MediaBoxes are unchanged;
annotation geometry differs only by float serialization (less than 0.0001pt).
The page-2 StrikeOut is preserved #116 evidence, not an admitted tool.
