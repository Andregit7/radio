# Maintenance: docs and git

Read this before editing a doc, writing a count into prose, or staging files.
The failure this file exists to prevent: a doc says "36 tests, 183 checks, v0.2.0",
a release happens, nobody updates it, and every later session trusts a wrong number.

## Language policy

Romanian is the **product** language and the **medical** language. English is the
**engineering** language. Do not mix them inside one file beyond the allowed exceptions.

| Content | Language |
|---|---|
| Code — identifiers, comments, JSON keys, commit messages | **English** |
| Technical docs — architecture, pack format, verification, maintenance, this file | **English** |
| Developer-facing READMEs (`app/README.md`, `tests/fixtures/README.md`) | **English** |
| UI strings — every literal the student sees | **Romanian**, unchanged |
| Medical material — `Semester 1/`, `SUBJECT.md`, workbook transcripts | **Romanian**, unchanged |
| `README.md` at the repo root | **Romanian** — it tracks study material, and it links to the English docs |

Allowed exceptions when writing English technical docs:

- Quoting a UI label the student sees. Keep the Romanian and gloss it once:
  `Bibliotecă` (Library), `Potrivire` (Matching), `Toată materia` (All material).
- Domain nouns that are already the data contract: section ids
  (`examination`, `projection`, `findings`, `diagnosis`, `differentials`, `investigations`),
  shapes (`ellipse`/`rect`/`polygon`/`arrow`), statuses (`draft`, `reviewed`,
  `source-derived`), and format strings (`radiology-study-pack`).
- A filename, path, command or URL — never translate it.

Never translate: identifiers, JSON keys, format-version strings, CLI flags, ports,
`lang="ro"`, or the Romanian default values baked into `schema.js`
(`'Toată materia'`, `language: 'ro'`). Those are behaviour, not prose.

## The one rule

**Never write a number into prose if a command can print it.**

| Do not write | Instead |
|---|---|
| "36 Node tests, 183 static checks" | "run `npm test` and `npm run check`" |
| "v0.2.0" three times in a doc title | one `APP_VERSION` in `dist/js/core.js`; docs say "current version" |
| a list of every file in a directory | link to the directory, or to `agents-map.md` |
| "80 cases, 60 diagnoses, 21 questions" in checks | `starter-pack/build-report.json` holds the counts |
| `releases/*` contents | `npm run release` writes them |

A doc may state a **fact that cannot change without someone deliberately changing it**
(a contract, a format version, an endpoint). It may not state a **measurement**.

## Where each fact actually lives

| Fact | Source of truth |
|---|---|
| app version | `dist/js/core.js` → `APP_VERSION` |
| pack/bank/backup format versions | `dist/js/schema.js` (`version: 1` checks) |
| limits (entries, pixels, path length) | `dist/js/schema.js` → `LIMITS` |
| review intervals, day length | `dist/js/core.js` → `scheduleReview`, `DAY` |
| case/diagnosis/question/image counts | `starter-pack/build-report.json` |
| test and check results | `verification-results.json` (`npm run verify`) |
| dev ports | `tools/serve.mjs` |
| which modules are mirrored | `tools/prepare-studio.mjs` |
| shared-module drift | `npm run check` |

If you must quote a measurement in a doc, add the command that regenerates it on the
same line, so the next reader can re-derive instead of trusting.

## Known stale content (fix on sight, do not propagate)

Verified stale at the last audit. Do not copy them into new docs.

- `docs/architecture.md` — said "Studio v0.1" while the package was at 0.2.0 (fixed;
  the doc now says "Studio"). Use `package.json` / `APP_VERSION` for versions.
- `tools/package_project.py` — the `START-HERE.md` it generates hardcodes a version
  and a test/check count. That text is baked into every packaged ZIP, so it goes stale
  silently. Keep it free of counts, or regenerate it.

Not stale, despite looking it: `app/README.md`'s `course-pack/…` path is the path
*inside* the packaged ZIP produced by `tools/package_project.py`, not a repo path.
Do not "fix" it to `dist/packs/`.

## Verification workflow

`npm run verify` is the only writer of `verification-results.json`. Never hand-edit it.

Before claiming work is verified, run the real gates:

```
cd app
npm test        # node --test tests/*.test.mjs
npm run check   # static checks incl. shared-module drift
npm run verify  # writes verification-results.json
```

`npm run check` must pass before `npm run release`. Release stamps `sw.js` `VERSION`
and rewrites both `release.json` files, so run it **after** the code is final.

## Git discipline

The repo is `app/.git`. `.gitignore` already covers `starter-pack/`, `releases/`,
`test-results/`, `dist/packs/`, `dist/starter.json`, and the build-only Python and
preview tools.

### Never stage these

Generated, and rewritten by a command:

- `dist/release.json`, `studio/release.json` — written by `release.mjs`
- `verification-results.json` — written by `verify.mjs`
- `dist/sw.js`, `studio/sw.js` — **mutated in place** by `release.mjs` (VERSION stamp)
- `releases/`, `test-results/`, `dist/packs/`, `starter-pack/`

`dist/sw.js` and `studio/sw.js` are sources that a tool edits in place. If `release`
has been run, `git diff` shows a VERSION change: that change belongs to the release,
not to your feature. Do not commit it with unrelated work.

### Staging checklist

1. `git status --short` — read it before `git add`.
2. Stage by explicit path, or `git add -u` for modified tracked files. Avoid `git add -A`
   while generated artifacts are untracked-but-modifiable.
3. Confirm nothing from the "never stage" list is in `git diff --cached --name-only`.
4. If a generated file keeps showing up, add it to `.gitignore` — do not commit it and
   do not `git update-index --skip-worktree` (that hides the real change from everyone).

### Index state (verified after the last cleanup)

- `dist/release.json`, `studio/release.json`, `verification-results.json` are
  **untracked** and covered by `.gitignore`. They stay on disk; regenerate them with
  `npm run release` / `npm run verify`.
- `dist/js/exercises.js` is tracked, so a clean clone can build a working release.
- `app/.git` has a root commit on branch `main`; use `git log`, `git diff` and
  `git show` for future changes. Keep generated artifacts out of later commits.
- `dist/sw.js` and `studio/sw.js` are tracked, but `release` rewrites their `VERSION`
  line in place. That diff belongs to a release — do not bundle it with a feature.
