# Release-candidate test runbook

This is the single operating document for the issue 66 packaged-app matrix, the desktop adapter
smoke record, and the Preview/Acrobat round trips. Execute every applicable row independently on
macOS, Windows, and Linux. Use fixtures from the
[fixture kit](release-candidate-fixtures.md). A pass on one platform is never copied to another.

## Candidate preparation

1. Open GitHub Actions, select **Release Candidate**, choose the target commit, and run the
   workflow. Wait for all three packaging jobs to pass.
2. Download the artifact for the test platform (`macos-<short-sha>`, `windows-<short-sha>`, or
   `linux-<short-sha>`). Keep its workflow run URL.
3. Read `manifest.txt`. Confirm its full commit and application version match the requested
   candidate. Verify each bundle against the listed SHA-256 with `shasum -a 256 <file>` on macOS,
   `Get-FileHash -Algorithm SHA256 <file>` in PowerShell, or `sha256sum <file>` on Linux. Record
   the artifact name and checksum; do not test a mismatch.
4. Install without treating an expected unsigned-app prompt as a Monight defect. On macOS, open
   the DMG, copy Monight to Applications, try Open, then allow it in **Privacy & Security** if
   Gatekeeper blocks it. On Windows, run the installer and use **More info -> Run anyway** if
   SmartScreen identifies the unsigned candidate. On Linux, install the deb/rpm normally or grant
   AppImage execution permissions with `chmod +x <file>.AppImage` before launching it.
5. Copy the fixture directories to a writable test directory. Keep untouched originals and make
   a fresh working copy before every destructive row. Create an alias/symlink to
   `valid-document-a.pdf`; also copy it to paths containing spaces and non-ASCII characters.

## Evidence rules

Create one evidence record per row and platform with all fields below. Screenshots and logs may be
attached, but the observed outcome is mandatory. A failed row links to a new issue containing
reproduction steps. `Pending` is not an acceptable final state. When a tester cannot perform a row,
record `not executed`, the reason, and the date. Never infer or copy another platform's result.

| Tester | Date | OS version | Application version | CI run URL | Artifact name | SHA-256 checksum | Observed outcome | Result or failure issue |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |

## Packaged-app and desktop adapter matrix

In every row, launch the installed packaged application rather than `npm run dev`.

| Capability | Fixtures and concrete steps | Expected outcome |
| --- | --- | --- |
| File dialog intake | Multi-select both valid Documents and `invalid-document.pdf`; repeat with A already open. | Valid Documents open in selection order, each path has its own outcome, invalid input is reported once, and A is activated rather than duplicated. |
| Drag-and-drop intake | Drop A, B, and the invalid fixture together; repeat A through its alias/symlink. | Valid Documents open in drop order, invalid input is reported independently, and canonical deduplication activates the existing A. |
| File association intake | With Monight closed, select A and B in the OS file manager and open with Monight; while running, open the invalid fixture and A's alias. | The same ordered Document Intake rules apply; the invalid path does not block a valid path and canonical A is not duplicated. |
| Command-line intake and canonical deduplication | Launch the packaged executable with `missing-document.pdf`, A, B, A's alias, and `--page 2`; send a second invocation while Monight runs. | Processing continues after the missing path, A appears once, B appears once, order is A then B, page targeting applies only to its scoped Document, and the active window is shown/focused. |
| Ordered Documents and Reading Session restoration | Open A then B, reorder B before A, select page 2 in A, settle distinct zoom/filter states, quit, and relaunch without opening a path. | Order, active Document, each Reading Position, and each Visual State restore; automatic restoration does not alter Recent Documents ordering. |
| Search, outline, thumbnails, and links | In A, search `moonlight`, use the **Second page** outline item, inspect both thumbnails, and activate the internal and HTTPS links. | Search returns both page matches; outline, thumbnail, and internal link navigation settle on the expected page; the web link uses the external browser. |
| Reading Position, Visual State, filters, presets, and shortcuts | Set page/location, view mode, rotation, manual/fit zoom, and filters in A. Apply/save a preset, invoke configured Reader Action shortcuts, switch Documents, and relaunch. | Settled state is Document-scoped and restored; fit zoom recalculates for the viewport; preset and shortcut actions match toolbar/menu behavior. |
| Enabled Annotation tools, undo, and redo | On a copy of A, create a highlight and text comment with contents, move/edit each, undo and redo each operation, then Save and reopen. | Only enabled tools are offered; native Annotations remain selectable and editable with contents, geometry, appearance, and attribution preserved. |
| Save, Save As, aliases, open destinations, and external conflicts | Edit A and Save. Edit again, Save As to a new unopened path C, and confirm the active Document becomes C. Open B, edit C, and try Save As onto B and B's alias. Close B, confirm overwrite, then separately modify C externally before trying Save. | Save clears dirty state only after durable replacement; successful Save As switches to C without a duplicate; B and its alias are blocked while B is open; confirmed overwrite works after B closes; external change blocks overwrite and offers recovery. |
| Edits during save and failed or uncertain writes | Use the padded B working copy. Start Save and immediately add a comment before completion. For definite failure, Save As into a test directory after removing its write permission with `chmod a-w` (macOS/Linux) or an `icacls /deny` write rule (Windows). Restore permission afterward. For uncertain replacement, Save As to a disposable removable test volume and disconnect/eject it immediately after confirming overwrite; never use a volume containing needed data. | The completed write contains its captured revision while later edits remain dirty; definite failure preserves the original and dirty state; interrupted replacement is either a definite failure or explicitly uncertain, never reported as a durable success, and retained recovery material is identified. |
| Close and Quit: Save, Discard, Cancel, and cancellation recovery | With edited A and B, test Document close and whole-app Quit separately: Cancel once, Save once, and Discard once. Cancel the Save As destination picker during a close-triggered save. Close Settings independently. | Cancel keeps all affected Documents/windows active; Save waits for persistence; Discard closes without writing; picker cancellation returns to the unsaved prompt; closing Settings leaves the main window and Reading Session active. |
| Recovery Draft: offer, restore, discard, and stale source | Edit A and force-terminate Monight. Relaunch and choose restore. Repeat and choose discard. Repeat after replacing A externally while Monight is terminated. | A Recovery Draft is offered only for unsaved edits; restore returns editable unsaved state without overwriting; discard removes it; a stale-source draft is identified and cannot silently overwrite the replacement. |
| Unsaved-Annotation printing without viewing transforms | Add an unsaved highlight/comment to A, apply strong filters and rotation/zoom, then print to PDF and inspect the result externally. | Printed output includes the unsaved native Annotations and original Document orientation/colors; no Monight viewing transforms appear. Canceling print changes neither dirty state nor source. |
| Restricted, signed, and encrypted Documents | Open all three protected fixtures. Try annotation, Save, Save As, close, restore, and print. For encrypted input enter `monight-test-password`, quit with it in the Reading Session, then verify restoration once by entering the password and once by canceling it on a fresh launch. | Each remains readable/printable as policy allows and explains read-only state; no protected write or Recovery Draft is authorized; encrypted restoration can succeed or cancel cleanly without persisting the password. |
| Offline runtime, fallback fonts, and enabled tools | Disable networking at the operating-system level before launch (not only DevTools). Open `fallback-font.pdf`, A, and an annotation working copy; search, navigate, annotate, Save, close, restore, and print. Inspect WebView diagnostics where the platform exposes them. | CJK, Arabic, and Hebrew glyphs render; local runtime/fonts and enabled tools work; no CDN or other external request occurs. Record the rendered glyph observation and diagnostics result separately. |
| Auxiliary-window close | Open Settings, close it, then continue reading and editing A. | Main window, active Document, and Reading Session remain active and usable. |
| External-link policy | Activate A's HTTPS, HTTP, mail, `file:`, `javascript:`, and `custom:` links. | HTTPS, HTTP, and mail open through the OS; unsafe or unknown schemes remain blocked without navigation in Monight. |

For the offline row, isolate the application with an operating-system control that blocks all
outbound traffic. Examples are a temporary deny rule for the Monight executable in macOS or
Windows application firewall tooling, or launching the AppImage in a Linux network namespace with
no interfaces. Prove the rule first by showing that an HTTPS link cannot open, keep it active for
the whole row, then remove the temporary rule after evidence is captured. Browser DevTools
request blocking, disconnecting only one interface, or relying on an already-empty cache is not
sufficient.

### Password non-persistence

After the encrypted workflow, close Monight. Search application logs, temporary directories, caches, Reading Session storage, and Recent Documents storage for `monight-test-password`. Record the
inspected paths and commands. The password must not appear in any location; finding it fails the row
and requires a linked security issue. Do not attach files that contain the password.

## Preview and Acrobat round trips

Run all four rows on fresh copies. Preview rows are macOS-only; record `not executed` with reason
and date on Windows/Linux. Acrobat rows require a current desktop Acrobat installation on each
tested platform. For every inspection, use each reader's annotation/comment list or object
properties to inspect **native Annotation objects**, not only screenshots. Confirm type, contents,
author, geometry, appearance, selectability, editability, and deletion.

| Direction | Fixtures and concrete steps | Expected outcome |
| --- | --- | --- |
| Monight -> Preview -> Monight | In Monight create a highlight and note on `original.pdf`, Save, open in Preview, inspect/edit both, delete one, add replacements, Save, reopen in Monight, edit/delete, and Save again. Repeat preservation check with `preview-unsupported.pdf`. | Supported objects remain native and editable through both saves. Unsupported content is preserved byte-semantically or Monight blocks the save with an explicit explanation; it is never silently flattened or deleted. |
| Preview -> Monight -> Preview | In Preview open `preview-supported.pdf`, inspect/edit/delete/re-save, then repeat those operations in Monight and again in Preview. Run the Monight save step separately on `preview-unsupported.pdf`. | Supported objects survive the full editable round trip; unsupported content is preserved or the Monight write is blocked explicitly. |
| Monight -> Acrobat -> Monight | In Monight create a highlight and note on `original.pdf`, Save, inspect/edit/delete/re-save in Acrobat, then inspect/edit/delete/re-save in Monight. Repeat preservation check with `acrobat-unsupported.pdf`. | Supported objects remain native and editable through both saves. Unsupported content is preserved or the Monight write is blocked explicitly. |
| Acrobat -> Monight -> Acrobat | In Acrobat open `acrobat-supported.pdf`, inspect/edit/delete/re-save, repeat in Monight, then repeat in Acrobat. Run the Monight save step separately on `acrobat-unsupported.pdf`. | Supported objects survive the full editable round trip; unsupported content is preserved or the Monight write is blocked explicitly. |

For each external reader, also open a saved Document and a print-to-PDF output after strong Monight
filters, zoom, and rotation were active. Confirm both outputs have no Monight viewing transforms;
the saved Document retains native Annotations, while printed output is judged according to the
print row above.
