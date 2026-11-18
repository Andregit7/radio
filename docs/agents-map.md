# Code map

One line per file: what it is, what it exports, what it depends on.
Read this instead of exploring. It covers the whole hand-written surface of `app/`
(~3.6k lines). If a file is not listed here, it is data or generated output.

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
| `storage.js` | IndexedDB `radia-study-v1` | `DB_NAME`, `openDatabase`, `getMeta`, `setMeta`, `setMetas`, `listPacks`, `assetBlob`, `packAssets`, `installPacks`, `removePack`, `learningVersion`, `validateLearning`, `learningSnapshot`, `mergeLearning`, `restoreLearningFile` | `schema.js` |
| `zip.js` | ZIP read/write over `DecompressionStream` | `crc32`, `inspectZip`, `readZip`, `writeZip` | `schema.js` |
| `archive.js` | runs ZIP work in a Worker | `archiveJob(action, payload, onProgress, signal)` — 120 s timeout, AbortSignal | `archive-worker.js` |
| `archive-worker.js` | worker entry | none (`self.onmessage`) | `zip.js` |
| `dom.js` | DOM kit | `el`, `button`, `link`, `badge`, `icon`, `toast`, `modal` | none |
| `annotation-view.js` | shared SVG marks: palette, automatic color, shape, pattern and arrow rendering | `MARK_PALETTE`, `autoColour`, `markColour`, `annotationRenderer` | none |
| `viewer.js` | image viewer, primary tabs, mark toggle and comparison layers | `imageViewer(record, caseData, opts) → {node, selectItem, destroy}` | `dom.js`, `storage.js`, `annotation-view.js` |
| `catalogue.js` | chapter/case selector UI | `catalogueSelector(pack, opts)` | `dom.js`, `core.js` |
| `exercises.js` | exercise derivation + grading | `EXERCISE_LABELS`, `SECTION_PROMPTS`, `SECTION_ORDER`, `presentSections`, `interpretationExercise`, `regionsExercise`, `matchingExercise`, `availableExercises`, `gradeMatching`, `matchingScore`, `answerSelfChecks`, `selfAssessmentCount`, `selfAssessmentItems`, `recordSelfAssessment`, `sessionAnswer`, `advanceSession`, `finishSessionEarly`, `receivedAnswers`, `exerciseSubject`, `canonicalDiagnosisLabels` | `core.js`, `structured.js` |
| `structured.js` | chapter-bank exercise derivation, one-to-one observation matching, structured progress | `STRUCTURED_ORDER`, `structuredExercise`, `stepLabel`, `gradeStructured`, `structuredRecord`, `optionLabel`, `describeObservation` | `core.js` |
| `app.js` | Study SPA: router (`#library`, `#cases`, `#case/:id`, `#practice`, `#exam`, `#progress`, `#settings`), reader layers, differential previews, guided/exam structured rendering and persistence | none | everything above |
| `checks/browser.js` | 8 browser integration checks | none | `storage`, `schema`, `archive`, `viewer`, `catalogue`, `core`, `exercises` |

## `studio`

| File | Purpose |
|---|---|
| `studio.js` | Pack Studio SPA: IndexedDB `radia-studio-v1` (`drafts`, `meta`), debounced `saveNow` (450 ms), tabs case/banks/catalogue/curriculum/questions, ellipse/rect/arrow/freehand drawing, automatic or manual colors and fills, image comparison layers, linked differentials, structured case forms and written questions; `exportDraft` sanitizes → `validatePack` → `validateQuestions` → `validateFiles` |
| `studio/lib/*` | **GENERATED** copies of `dist/js/{core,schema,zip,archive,archive-worker,dom,annotation-view}.js` — never edit |
| `studio/base.css` | **GENERATED** copy of `dist/styles.css` — never edit |

## `tools`

| File | npm script | Purpose |
|---|---|---|
| `serve.mjs` | `dev`, `studio` | dev server |
| `prepare-studio.mjs` | `prepare:studio` | copies the seven shared modules + icons + `styles.css` into `studio/` |
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
| `exercises.test.mjs` | interpretation sections, canonical diagnoses, regions `reviewed`-only + 1:1, matching ≥ 3, pools, signatures, self-assessment, session transitions |
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

`dist/js/{core,schema,zip,archive,archive-worker,dom,annotation-view}.js` are copied to
`studio/lib/` byte-for-byte by `prepare:studio`. `dist/styles.css` is copied to
`studio/base.css`. `check.mjs` fails on drift.

- Authoritative copy: **`dist/js/`** and **`dist/styles.css`**.
- Editing `studio/lib/*` appears to work, then is silently overwritten.
- Editing `dist/js/*` breaks `npm run check` until you run `prepare:studio`.

`storage.js`, `viewer.js`, `catalogue.js`, `exercises.js`, and `app.js` are
Study-only and are **not** mirrored.

## Hard contracts enforced by `check.mjs`

- `dist/sw.js` `FILES` lists real paths; `release.json` sha256 values match.
- Manifests keep `start_url` / `scope` at `"./"`.
- Staged `releases/*-site` contains no extra files.
