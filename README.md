# RadioEasy · Study and Pack Studio

[Open Study](https://andregit7.github.io/radio/) · [Open Pack Studio](https://andregit7.github.io/radio/studio/) · [Source code](https://github.com/Andregit7/radio)

Two static web apps with no accounts, no backend and no AI services. The source is the code the browser runs.

**Study** is for students: pack import, atlas, chapter-bank structured interpretation, full interpretation across six sections, semiology with verified annotations, matching, short questions, written questions with author rubrics, comparison layers, differential previews, spaced review, exam simulation and backup.

**Pack Studio** is the separate app for contributors: pack creation/import, editing cases and diagnoses, curriculum, chapter answer banks, structured observations and study notes, ellipses/rectangles/arrows/freehand marks with automatic or manual colors and fills, comparison layers, linked differentials, MCQs, written questions and validated export. Study never downloads the editing modules.

The product UI is Romanian. Labels quoted in these docs keep their Romanian spelling, with an English gloss on first use.

## Exercises

Study has five selectable methods:

- **Structured interpretation** (`Interpretare structurată`) — the student chooses chapter-bank options and repeated observations, then the diagnosis. Guided review reveals one step at a time; exam simulation grades only after final submission. Exact ID sets and one-to-one observation matching are automatic.
- **Full interpretation** (`Interpretare completă`) — empty fields for each section present in the source. The student's written answer is compared against the notes by ticking; there is no automatic grading of medical text. This legacy method remains for packs/cases without structured data.
- **Numbered regions** (`Regiuni numerotate`) — regions marked `reviewed` are numbered on the image, and the student writes what each one represents.
- **Matching** (`Potrivire`) — the student pairs the descriptions from the notes with the numbered regions; the pairing is graded automatically.
- **Short questions** (`Întrebări scurte`) — the diagnosis catalogue, authored MCQs and authored written questions with a rubric and self-check.

Methods that rely on annotations appear only for cases with `reviewed` annotations. `draft` annotations stay visible while reading but are not used in exercises. Only one-to-one links between a region and an observation are accepted per case. Notes, comparison layers and rubric text never become automatic keys.

## Running locally

Node.js 20+ is required for the development server. Students using the hosted app do not need Node.js.

From this directory:

```text
node tools/serve.mjs
```

Open `http://127.0.0.1:4173/` for Study. On Windows you can run `start-study.cmd`.

In another terminal:

```text
node tools/serve.mjs --studio
```

Open `http://127.0.0.1:4174/` for Studio. On Windows you can run `start-studio.cmd`.

The distinct ports separate the origins and storage of the two apps. The servers listen only on the local interface. Do not open the HTML files directly over `file://`: modules, IndexedDB and Service Worker need a proper web origin.

## First pack

The private distribution includes `course-pack/radiografii-explicate.study.zip`. Import it from the Library (`Bibliotecă`). It can also be opened in Studio via "Open ZIP" (`Deschide ZIP`).

The pack counts are in `starter-pack/build-report.json`; regenerate them with `python tools/build_starter_pack.py`. The images are the exact JPEG streams from the PDF, with no additional recompression. The pack is version 2: it includes chapter banks, source-derived structured cases and one authored written question.

A single orientation annotation, marked `draft`, demonstrates the text–image link on the first case. The annotation methods are implemented but stay disabled until the regions are visually verified in Studio and marked `reviewed`. `source-derived` MCQs, structured keys and written rubrics are not an independent medical validation.

Some cases have only a diagnosis. Case p054 has no explicit positive diagnosis and remains available for study, without an automatic diagnosis question. Findings without explicit source support remain study notes rather than keys. The colloquium limits were not invented.

The course-material extraction utilities are kept separate from the public code.

## Checks

```text
npm test
npm run check
npm run verify
npm run prepare:studio
npm run release
```

The Node tests cover Romanian filtering, selection and grading by identifier, review scheduling, key changes, data validation, ZIP import/export, section eligibility, `reviewed`-only annotations, exact matching, structured choice/observation grading, written-question signatures, self-assessment and session transitions. The test archives include directory traversal, duplicate names, active files, overlaps, oversized entries and bad CRC. If the original pack is not present, the separate test over the built pack is marked "skipped".

For browser integration tests, start Study and open `http://127.0.0.1:4173/checks.html`. These tests use a temporary IndexedDB database, separate from study data. They cover transactions, restore without duplication, the ZIP worker, the catalogue and annotation geometry. The tests are not cached by the app. A developer copy is available at https://andregit7.github.io/radio/checks.html; generated static releases remain free of these auxiliary files. The last local run and the additional Study/Studio smoke flow are recorded in `docs/browser-checks.json`.

**Verification status:** run `npm test`, `npm run check` and `npm run verify` — the last writes the current numbers into `verification-results.json`. Do not quote a count from this file; regenerate it. Browser integration checks must be repeated after any change to the app; current evidence for the released build IDs is kept in `docs/browser-checks.json`. Installation on the four platforms, airplane-mode startup and measurements on a modest phone remain to be done.

The manual checklist is in `docs/verification.md`.

## Release and GitHub Pages

`npm run release` prepares `releases/study-site/` and `releases/studio-site/` separately. Neither contains the course pack or user data. The files are buildless; no npm install or external services are needed to publish.

To publish on GitHub Pages, put the contents of the release directory at the root of a public repository or in the `docs/` directory, then configure Pages for that branch/directory. All paths are relative, including `start_url`, `scope`, the modules and the app images, so it also works under `/<repository>/`.

For real isolation between the two apps, use different origins. Two Pages repositories under the same owner usually share the `owner.github.io` origin; two paths are not a security boundary for IndexedDB. You can use different owners/organizations, with no paid domains.

Keep the app repository separate from the course material and from backups. `.gitignore` excludes the generated pack and the private preview configuration. The MIT licence applies to the program; it does not transfer rights over the imported images or notes.

## Structure

| Directory | Role |
|---|---|
| `dist/` | Study, ready to serve statically |
| `studio/` | Pack Studio, separate app |
| `studio/lib/` | Explicit copies of the shared modules, prepared by `tools/prepare-studio.mjs` |
| `tools/` | Local servers, checks and release preparation |
| `tests/` | Node tests and independent ZIP/PNG fixtures |
| `docs/` | Pack contract, architecture, security and verification |
| `starter-pack/` | Generated private material; excluded from Git |
| `releases/` | Publishable releases, generated locally |

## Data and limits

Study uses IndexedDB for packs and images, and Cache Storage for the app files. Studio uses a separate database for projects. Exports are ordinary downloads; imports read only the files chosen. Persistent access to directories, camera, microphone, notifications or geolocation is not requested by default.

The JSON backup includes automatic progress, self-assessments and bookmarks, without images. The full ZIP backup includes the packs and all progress data. Unfinished sessions are saved locally but are not included in backup exports. The displayed date is the moment the export started; the app cannot confirm that the operating system actually kept the download.

Standard ZIP packs accept the stored and deflate methods; deflate decompression uses `DecompressionStream('deflate-raw')`. On browsers without that format, stored packs still work if the other APIs are available. The app's exports use stored, because the images are already compressed.

The initial limits are 32 MiB for an archive, 64 MiB total uncompressed, 12 MiB per entry, 3 MiB for a JSON, 1,200 entries and 12 megapixels per image. These are protection limits, not the results of a benchmark on modest devices. Split large collections into smaller packs.

Keep downloaded backups: browser storage can be cleared. Extra persistence is an explicit option in Study, not a usage requirement.
