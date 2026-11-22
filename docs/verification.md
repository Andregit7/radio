# Verification

## Verified automatically

- Node tests cover diacritics, diagnosis name and keyword search, migration of legacy search terms, curriculum filtering, grading by ID, multiple selection, spaced-review intervals and exam selection.
- Detecting a change of the key/prompt without depending on the order of the options.
- Eligibility of the full interpretation, missing sections, canonical diagnosis labels, regions and matching from all annotations linked to findings, exact matching, self-assessment and session transitions.
- Structured interpretation: chapter-bank steps, exact choice sets, repeated observation matching, measurement normalization, order-independent signatures, image/key invalidation and one scheduled attempt per case.
- Authored written questions with their own rubric and self-assessment signature; they stay outside automatic accuracy.
- Validation of pack v1/v2, mark styles, comparison layers, linked differentials, chapter banks, structured findings, images, hashes, coordinates and learning backups v1/v2.
- Stored and deflate ZIPs produced independently with Python; binary export/import; rejection of malicious and corrupted archives.
- The complete pack, including its chapter banks and source-derived structured cases; exact counts are in `starter-pack/build-report.json`.
- Static checks for syntax, local imports, CSP, cache files, the manifest and shared-module identity.

The exact commands and the result of the last run are in `verification-results.json` in the project distribution.

## Verified in the browser

The project harness `dist/checks.html` passed in headless Chrome against the build IDs recorded in `docs/browser-checks.json`. That file also records the separate Studio authoring and appearance smoke checks.

This is desktop-browser evidence, not a substitute for the manual matrix below. Installation on Windows, Android, iOS and macOS, airplane mode and consumption on modest phones remain to be verified.

## Manual checklist before distribution to colleagues

| Check | Expected result |
|---|---|
| Fresh Study launch | Empty library, no account or permission prompts; RadioEasy brand |
| Course pack import | Cases and chapters match the starter pack report. Images and notes open |
| First case, linked observation | Selecting the text highlights the ellipse and vice versa |
| Zoom and orientation change | The annotation stays on the same region |
| Viewer Fit/Fill | `Fit` shows the whole film with dark letterbox bars; `Fill` covers the stage and crops the overflowing side; the choice survives a reload and applies to every viewer |
| Viewer drag panning | A zoomed or cropped image follows the pointer with a grab cursor; marks stay clickable; `Reset` returns to 1x and the top-left corner |
| Diagnosis-only case | Missing sections are explicitly marked |
| p054 | Can be studied, with no automatic diagnosis question |
| Method selector | Five methods explained; annotation-based methods appear for the cases that have linked annotations |
| Interpretare structurată, guided | One step at a time; a submitted step reveals its own reference; later steps do not inherit wrong choices |
| Interpretare structurată, exam | All steps can be edited; no key, note, mark or comparison layer appears before final submission |
| User layers | `Repere` hides every mark, including the selected one; comparison layers toggle without losing the base image |
| Differential quick access | Linked rows open a closeable case preview without changing the route, visit state or reading position |
| Interpretare completă (legacy text) | Empty fields for the sections present; missing sections are named, not graded |
| Written question | The author rubric appears only after submission; self-check stays outside automatic accuracy |
| Self-assessment | After submission the notes and checks appear; the percentage does not mix in the self-assessment |
| Displayed diagnosis | The full canonical name |
| Catalogue, `cancer`, `endobronsic`, `potcoava` | Filtering without diacritics, full title, only chapters with matches |
| Search by an author-defined keyword | The matching diagnosis appears under its full name and is selected by its existing ID |
| A single result in the catalogue | Selection and confirmation are still required |
| Search with no text | Chapters can be expanded/collapsed; the list stays the same for cases in the same curriculum |
| MCQs | Shuffling the options does not change the key; a double click does not duplicate the attempt |
| Simulare | A single click confirms and advances; no explanation before the end |
| Rezultate (results) | Image, diagnosis and full explanation open over the results; closing returns to the list |
| Rezultate, answers | Tiles are headed by case and section; a wrong answer also shows `Răspuns corect` (Correct answer); the color accent carries the state; a skipped tile reads `Sărit` (Skipped) |
| Early finish | Confirmed answers are kept; unanswered ones are not counted |
| Pauză (pause)/reload | The session continues without losing confirmed answers |
| Resetează progresul (reset progress), cancel | The modal closes and the counters, bookmarks and installed packs are unchanged |
| Resetează progresul, confirm | Answers, self-assessments, visited cases and the paused session are cleared; bookmarks and installed packs stay; a reload keeps that state |
| Export/import JSON twice | The counters are not doubled; self-assessments and bookmarks are kept |
| Full backup on a new origin | Packs, bookmarks, automatic progress and self-assessments are restored |
| Cancelled or failed import | The existing pack stays usable |
| Malicious ZIP | Clear message, without replacing existing data |
| Airplane mode, close and reopen | The application and the already imported pack stay available |
| Update during the test | Not activated in one's own unfinished session |
| Network | No material, answer or progress uploaded to a server |
| Studio, create/edit/export | The resulting pack can be imported into Study |
| Studio, editing a case | Questions remain exportable after the edit |
| Studio, case editor | The ribbon and each pane can collapse. Dividers resize the panes. The marks list and observations keep their scroll offsets on drawing and binding |
| Studio, narrow window | Panes stack and can resize vertically. The radiograph fits its viewport and supports zoom and drag panning |
| Studio, banks | Chapter-specific variants survive rename/reorder; deleting a used variant is blocked |
| Studio, drawing | Open and closed freehand preserve long strokes. Drawing without a preselected observation requires binding or discarding the mark before the next stroke |
| Studio, mark editing | A mark, list entry, or observation selection highlights the corresponding elements. Shape, color, line width, line style, and closed-shape fill survive export and import |
| Studio, comparisons and preview | A local or referenced comparison survives export and import. The layer selector and keyboard shortcuts switch views. Studio preview shows the Study reader with linked notes and marks |
| Study and Studio, appearance | Each theme persists on reload. System follows the device preference. Christmas decorations remain clear of the work area and honor reduced motion |
| Studio, differentials | A linked case opens from Study; deleting the target is blocked until the link is removed |
| Studio, written question | The rubric exports with the bank and is unavailable before submission |
| Studio, close/reopen | The locally saved project is kept |

Minimum matrix: Windows with Chrome/Edge, Android with Chrome on a modest phone, iOS with Safari and the application installed, macOS with Safari and Chrome. Check installation from an external browser separately after first opening the link in Discord. For phone testing use HTTPS hosting; the local server is intentionally limited to loopback.

Do not mark the release as validated on all platforms before these checks are done.
