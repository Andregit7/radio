# Architecture

## Independent applications

Study and Pack Studio are two static applications, each with its own manifest, Service Worker and IndexedDB database. There is no backend and no communication between applications. Transfer happens through a ZIP pack. The validation and ZIP modules are shared at source level and copied explicitly for distribution; Studio does not load modules from the Study origin.

Study does not offer pack creation or editing. Annotations shipped in the pack are displayed via SVG generated from validated geometry. Studio draws ellipses, rectangles, arrows, open freehand strokes and closed freehand polygons on any case image, with automatic or manual colors and closed-shape fill patterns. Study renders the same validated shapes; completed v1 packs keep their legacy gold marks. A case can add primary images, comparison-only images and named comparison layers; references are validated inside the same pack.

## Contracts

Course data, questions and algorithms are separate:

- `pack.json`: curriculum, catalogue, cases, explanations, annotations, chapter banks, structured findings and comparison links;
- `questions.json`, optional: MCQs with fixed options and written questions with an author rubric;
- the application: filtering, presentation, session composition, grading, spaced review.

Each diagnosis has a canonical ID, a full label, search aliases and chapters. Cases reference these IDs. Search normalises diacritics, capitals and punctuation, then requires a match on all words. The available list depends only on the curriculum, search and the chosen filter; the search function does not receive the case or the correct answer.

An automatic answer is an explicit selection of identifiers or a structured observation whose keyed fields are compared by ID. Typed text is not graded and a single result is not confirmed automatically. Catalogue selection, MCQs and structured interpretation are available. Free text in the legacy `Interpretare completă` (Full interpretation) and authored written questions remain self-assessed with a visible rubric; notes never become answer keys. There is no automatic grading of medical prose, no voice answers, no LLM and no clinical generation at runtime.

## Exercises

Study offers five selectable methods. `Interpretare structurată` (Structured interpretation) uses the chapter banks and the case's source-derived observations, asks one step at a time in guided review, and grades exact ID sets plus one-to-one observation matching. Guide steps reveal their own reference before continuing; exam simulation reveals nothing until final submission. `Interpretare completă` (Full interpretation) derives its fields from the sections present in the pack; missing sections are not graded and are not invented. `Repere numerotate` (Numbered annotations) and `Potrivire` (Matching) use only `reviewed` annotations, with a one-to-one link between region and observation; `draft` annotations stay in the reading view but do not enter exercises. `Potrivire` is the only annotation-based method graded automatically. `Întrebări scurte` (Short questions) keep the catalogue, MCQs and authored written questions.

## Learning

A spaced-review session prioritises overdue mistakes, then other overdue questions, then new material, then questions scheduled in the future. A mistake returns after 10 minutes; successes have intervals of 1, 3, 6, 12… days, up to 90. Self-assessments use the same scheduling but are kept separately; an interpretation counts as successful only when the student ticks every element present. It is a transparent heuristic, not a clinically calibrated memory model or an FSRS implementation.

The exam simulation distributes the exercises across the selected chapters without using the history of mistakes. Explanations and correctness are shown only at the end. The configured number means exercises; for interpretation, cases. Short questions keep the catalogue and the MCQs, without duplicating the diagnosis.

Progress has two separate registers: automatically graded results (`catalogue`, `mcq`, `matching`, `structured`) and self-assessments (`interpretation`, `regions`, `written`). The accuracy percentage uses only the first register. A signature of the prompt, options, sections, pairs or structured keys prevents reuse of the schedule when the exercise changes. The display order of options, labels and chapter-bank ordering do not change the signature; changing the primary film or a keyed finding does. Structured attempts update the schedule once per submitted case, not once per guided step.

## Persistence and restore

Images are Blobs in IndexedDB, with internal references, without URLs from the pack. A replacement writes the pack, the bank and the images in a single transaction. Errors cancel the replacement, keeping the previous version. Old images are removed in the same transaction, without touching the data of other packs.

Confirming an answer saves progress and the session in a single transaction. Self-assessment saves `selfAssessments` separately, and the JSON backup keeps both registers. Structured results use `progress` with kind `structured`; written self-checks use `selfAssessments` with kind `written`. Backup v2 is written only when one of those kinds exists, while v1 remains importable. Restore keeps the record with the most recent attempt date and merges bookmarks without duplication. The full backup validates all data before the common transaction.

This version is intended for use in a single active window per application. Simultaneous progress updates in several tabs have no event-level conflict resolution yet.

## Offline and updates

The Service Worker stores the explicit list of application files atomically. Imported material is in IndexedDB, separate from the cache. The distribution uses a cache identifier computed from content, so an incomplete version does not replace the active cache. Both workers honor an explicit `ACTIVATE_UPDATE` message and call `skipWaiting()`; the package version alone is never the update signal.

The update check compares the published `release.json` build hash with the active shell-cache build hash. A difference forces a fresh worker registration with that build hash, bypassing stale HTTP/CDN copies of `sw.js`. If the new worker installs, it waits and is activated explicitly. If installation or activation fails, the application unregisters the worker and reloads from the network; IndexedDB is untouched. Settings exposes the active and published build IDs plus a manual forced-reload repair action.

Study asks explicitly to activate an update and does not activate it from its own unfinished session. It does not delete IndexedDB on activation. It clears only its own caches, with the prefix of its own origin/paths. Studio saves the local draft before activation and uses the same recovery path.

The initial start and the import of a pack received online require the files to be already downloaded. Afterwards, studying, tests, editing and export rely on local data. The browser and the user can delete storage; external backups are required.
