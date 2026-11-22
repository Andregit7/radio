# Code map

One line per file: what it is, what it exports, what it depends on.
The map covers the hand-written application surface in `app/`.

## Entry points

| File | Role |
|---|---|
| `package.json` | npm scripts only; `type: module`, node >= 20, no runtime dependencies |
| `tools/serve.mjs` | static dev server; root `dist/` or `studio/` with `--studio`; port = first numeric arg, else 4173 (study) / 4174 (studio); binds `127.0.0.1`; GET/HEAD only, `Cache-Control: no-cache`, path-traversal guard → 403 |
| `start-study.cmd`, `start-studio.cmd` | wrap `node tools/serve.mjs` (+ `--studio`) |
| `dist/index.html` | Study shell: CSP, `#app`, `#notice`, `#pack-input`, `#backup-input`, `#modal`; loads `./js/app.js` |
| `studio/index.html` | Studio shell: `base.css` + `studio.css`, `#open-pack`, `#add-image`, `#notice`, `#modal`; loads `./studio.js` |
| `dist/checks.html` | dev-only browser test harness; loads `./checks/browser.js`; excluded from release |
| `dist/manifest.webmanifest`, `studio/manifest.webmanifest` | PWA manifests; `start_url`/`scope` must be `"./"` (enforced by `check.mjs`) |

## `dist/js` — Study runtime

This directory is **source**, not build output. It is served directly.

| File | Purpose | Exports | Deps |
|---|---|---|---|
| `core.js` | pure learning logic, no DOM | `APP_VERSION`, `DAY`, `SECTION_LABELS`, `normalise`, `matches`, `searchCatalogue`, `shuffled`, `progressKey`, `questionSignature`, `matchingProgress`, `gradeAnswer`, `scheduleReview`, `chooseQuestions`, `availableQuestions`, `bytesLabel`, `dateLabel` | none |
| `schema.js` | pack/archive contract + validators | `LIMITS`, `requireThat`, `safePath`, `parseJSON`, `validateAnnotation`, `validatePack`, `validateQuestions`, `imageDimensions`, `validateFiles` | none |
| `storage.js` | IndexedDB `radia-study-v1` | `DB_NAME`, `openDatabase`, `getMeta`, `setMeta`, `setMetas`, `listPacks`, `clearLearning`, `assetBlob`, `packAssets`, `installPacks`, `removePack`, `learningVersion`, `validateLearning`, `learningSnapshot`, `mergeLearning`, `restoreLearningFile` | `schema.js` |
| `zip.js` | ZIP read/write over `DecompressionStream` | `crc32`, `inspectZip`, `readZip`, `writeZip` | `schema.js` |
| `archive.js` | runs ZIP work in a Worker | `archiveJob(action, payload, onProgress, signal)` — 120 s timeout, AbortSignal | `archive-worker.js` |
| `archive-worker.js` | worker entry | none (`self.onmessage`) | `zip.js` |
| `dom.js` | DOM kit | `el`, `button`, `link`, `badge`, `icon`, `toast`, `modal` | none |
| `annotation-view.js` | shared SVG marks, conversion between shapes, observation order, and stroke/fill styling | `annotationRenderer`, `updateAnnotationGeometry`, `convertAnnotationShape`, `annotationsInObservationOrder`, `annotationNumbers`, palette and line options | `schema.js` |
| `appearance.js` | resolves the local theme preference, installs seasonal decorations, and renders appearance controls | `initAppearance`, `themeControl` | `dom.js` |
| `credits.js` | shared credits content, modal, and theme-aware credits button (present animation on the Christmas theme) | `CREDITS`, `openCredits`, `creditsButton` | `dom.js` |
| `case-interpretation.js` | builds the linked observation panel and resolves comparison assets for Study and Studio preview | `caseInterpretation`, `caseComparisonLayers` | `core.js`, `dom.js` |
| `viewer.js` | image viewer: fit/fill stage, zoom, drag panning, marks, and comparisons | `imageViewer(record, caseData, opts) → {node, selectItem, destroy}`. Provide `opts.loadAsset` when using local Studio draft files | `dom.js`, `annotation-view.js`, Study `storage.js` as the default asset loader |
| `catalogue.js` | chapter/case selector UI | `catalogueSelector(pack, opts)` | `dom.js`, `core.js` |
| `exercises.js` | exercise derivation + grading | `EXERCISE_LABELS`, `SECTION_PROMPTS`, `SECTION_ORDER`, `presentSections`, `interpretationExercise`, `regionsExercise`, `matchingExercise`, `availableExercises`, `gradeMatching`, `matchingScore`, `answerSelfChecks`, `selfAssessmentCount`, `selfAssessmentItems`, `recordSelfAssessment`, `sessionAnswer`, `advanceSession`, `finishSessionEarly`, `receivedAnswers`, `exerciseSubject`, `canonicalDiagnosisLabels` | `core.js`, `structured.js` |
| `structured.js` | chapter-bank exercise derivation, one-to-one observation matching, structured progress | `STRUCTURED_ORDER`, `structuredExercise`, `stepLabel`, `gradeStructured`, `structuredRecord`, `optionLabel`, `describeObservation` | `core.js` |
| `app.js` | Study SPA: router (`#library`, `#cases`, `#case/:id`, `#practice`, `#exam`, `#progress`, `#settings`), reader layers, differential previews, guided/exam structured rendering and persistence, result tiles headed by case and section label with the chosen and correct answers, the persisted `viewerMode` preference, the credits entry, and the learning reset through `clearLearning` | none | everything above |
| `checks/browser.js` | browser integration checks | none | `storage`, `schema`, `archive`, `viewer`, `catalogue`, `core`, `exercises` |

## `studio`

| File | Purpose |
|---|---|
| `studio.js` | Pack Studio SPA, local drafts, sidebar navigation with chapter-grouped collapsible cases, section views, case forms, chapter banks, diagnoses, curriculum, questions, Study preview, and pack import/export |
| `annotation-workbench.js` | drawing and mark editing, binding, single/multi selection across the canvas/list/observations (select-all and drag marquee), colour swatches, pen/select/hand modes, fill and style editing, pane layout and viewport controls |
| `landing.js` | launch actions, saved-draft chooser, workspace navigation, and the credits entry |
| `studio/lib/*` | **GENERATED** shared modules listed in `tools/prepare-studio.mjs` |
| `studio/base.css` | **GENERATED** copy of `dist/styles.css` — never edit |

## `tools`

| File | npm script | Purpose |
|---|---|---|
| `serve.mjs` | `dev`, `studio` | dev server |
| `prepare-studio.mjs` | `prepare:studio` | copies the shared modules, icons and `styles.css` into `studio/` |
| `check.mjs` | `check` | static checks: shared-module drift, manifest scope, SW `FILES` exist, `release.json` hashes |
| `release.mjs` | `release` | stamps `sw.js` `VERSION`, writes `dist/release.json` + `studio/release.json`, builds `releases/` |
| `deploy.mjs` | `deploy` | publishes; supports `--dry-run` |
| `verify.mjs` | **none** | writes `verification-results.json` |
| `preview-assets.mjs` | **none** | writes `dist/starter.json` and `dist/packs/*.zip` |
| `build_starter_pack.py` | none | builds the starter pack; needs PyMuPDF (`fitz`) |
| `package_project.py` | none | packaging helper |
| `starter-annotations.json` | none | annotation data for `build_starter_pack.py` |
| `starter-structured.json` | none | curated chapter banks, case findings, notes and written questions for `build_starter_pack.py` |

## `tests`

`node --test tests/*.test.mjs`.

| File | Covers |
|---|---|
| `core.test.mjs` | normalise/diacritics, catalogue scoping, grading by ID sets, review intervals, question choice, signature invalidation |
| `schema.test.mjs` | prototype-key and oversize JSON, pack stripping, path/duplicate/pixel rejection, annotations, question bank, PNG/JPEG dimensions, sha256, learning restore |
| `zip.test.mjs` | crc32, stored/deflate import, roundtrip, truncation, zip-slip/duplicate/active/overlap/oversize, inflate overflow, CRC corruption, real 80-case pack |
| `exercises.test.mjs` | interpretation sections, canonical diagnoses, regions from all finding-linked annotations + 1:1, matching ≥ 3, pools, signatures, self-assessment, session transitions |
| `structured.test.mjs` | chapter-bank steps, exact choice sets, repeated observation matching, order-independent signatures, image/key invalidation, structured scheduling, written-question pools |

## Shared contracts

Two modules are the spine. Change them deliberately — many files depend on them.

- **`dist/js/schema.js`** — the pack/archive contract (prose version: `pack-format.md`).
  `validatePack(raw) → {pack, assets: Map<path, {id, path, width, height, sha256?}>}`,
  `validateQuestions(raw, pack)`, `validateFiles(Map|Array, onProgress) → {pack, bank, blobs, total}`.
  Used by `zip`, `storage`, `app`, `studio`, `checks`, and two tests.
- **`dist/js/core.js`** — the learning contract. `progressKey(packId, qId, kind) → "a|b|kind"`,
  `questionSignature(q)` (must stay byte-stable for existing progress), `scheduleReview`,
  `chooseQuestions`, `gradeAnswer`, `availableQuestions`. Used by `exercises`, `app`,
  `catalogue`, `studio`, and tests.

Data shapes: `pack.json` (`radiology-study-pack` v1/v2), `questions.json`
(`radiology-question-bank` v1/v2), backups (`radiology-learning-backup` v1/v2).
Progress records live in IndexedDB `meta`, split between `progress`
(catalogue | mcq | matching | structured) and `selfAssessments`
(interpretation | regions | written).

## The mirror trap

`prepare:studio` copies the shared modules listed in `tools/prepare-studio.mjs`
to `studio/lib/` byte-for-byte and copies `dist/styles.css` to `studio/base.css`.
`check.mjs` fails on drift.

- Authoritative copy: **`dist/js/`** and **`dist/styles.css`**.
- Editing `studio/lib/*` appears to work, then is silently overwritten.
- Editing `dist/js/*` breaks `npm run check` until you run `prepare:studio`.

The mirrored viewer uses Studio's draft asset loader when embedded in a preview.

## Hard contracts enforced by `check.mjs`

- `dist/sw.js` `FILES` lists real paths; `release.json` sha256 values match.
- Manifests keep `start_url` / `scope` at `"./"`.
- Staged `releases/*-site` contains no extra files.
