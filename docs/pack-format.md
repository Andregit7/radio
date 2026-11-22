# Pack contract · versions 1 and 2

The executable validator is `dist/js/schema.js`. The contract does not depend on the interface, on question order or on the spaced-review algorithm. Version 1 remains readable. Version 2 adds typed findings, authored chapter banks, comparison layers, mark styles and written questions; a v1 client strips those fields, so Studio promotes a draft to v2 as soon as one is used.

## Archive

```text
pack.json
questions.json (optional)
images/caz-001.jpeg
images/caz-002.png
```

Standard ZIP is accepted, stored or deflate, without encryption, ZIP64, multiple volumes, symbolic links, duplicate names or unused files. Paths are relative ASCII, use `/`, and contain no `..`, `\`, URL schemes or absolute directories. Accepted images are PNG and JPEG; imported SVG, HTML and JavaScript are not executed or displayed as material.

## pack.json

| Field | Content |
|---|---|
| `format`, `version` | `radiology-study-pack`, `1` or `2` |
| `id`, `revision`, `title` | Stable identifier, version and name |
| `description`, `language`, `source` | Description, language and provenance |
| `curriculum` | ID, name, edition, chapters and exam domains |
| `diagnoses` | The canonical catalogue of the curriculum |
| `cases` | Cases with images, explanations and annotations |

A chapter has `{id, label}`. A domain has `{id, label, chapterIds}`. Domains may share the same chapters; images are not duplicated. There are no hardcoded assumptions about colloquium I/II or the final exam.

A diagnosis has `{id, label, chapterIds, keywords}`. The full label is displayed and searchable. Optional keywords add search terms for the same diagnosis ID. Import reads legacy `aliases` as keywords when the `keywords` field is absent. Exports write `keywords`. A concept with a different meaning gets a different ID. A spelling change keeps the existing ID.

A case has:

- `id`, `title`, `chapterId`, `diagnosisIds`;
- `source: {document, page}` and `referenceText`, for the transcription kept;
- `images: [{id, path, width, height, sha256?, role?}]`; in v2 `role` is `primary` (default) or `comparison`, and each case keeps at least one primary;
- `sections: [{id, label, items: [{id, text, targetCaseId?}], status}]`;
- `comparisons`, `structured`, `annotations` and `completeness` (v2 for the first two).

The sections are `examination`, `projection`, `findings`, `diagnosis`, `differentials`, `investigations`. A section without text is displayed as unspecified, with no automatic completion. `completeness` can be `full`, `partial` or `diagnosis-only`; it indicates the presence of data, not medical validation.

`diagnosisIds: []` keeps the case for study, without an automatic question. Several IDs represent diagnoses that must be selected together.

## Annotations

An annotation explicitly references an image and a text element:

```json
{
  "id": "regiune-1",
  "imageId": "primary",
  "itemId": "p001-findings-1",
  "shape": "ellipse",
  "cx": 0.75,
  "cy": 0.455,
  "rx": 0.14,
  "ry": 0.115,
  "label": "1"
}
```

All coordinates are normalised to the 0–1 range. Other accepted shapes are `rect` with `x,y,width,height`, `polygon` with `points:[[x,y],…]`, `arrow` with `x1,y1,x2,y2`, and in v2 `polyline` with at least two distinct points for an open freehand stroke. Point arrays are covered by the pack's JSON and archive size limits. The renderer constructs shapes through DOM/SVG APIs.

Version 2 marks may carry `style: {color?, pattern?, width?, line?}`. `color` is `#RRGGBB`. `pattern` is `none`, `diagonal`, `dots`, `vertical` or `horizontal`, with fills available for `ellipse`, `rect` and `polygon`. `width` is a stroke thickness from 1 to 12 CSS pixels. `line` is `solid`, `dotted`, `dashed`, `dash-dot` or `double`. Legacy marks keep the default color and stroke. Studio stores the selected style per mark. Both apps number marks across the case images in the order of their linked text items.

Every annotation linked to a `findings` item feeds the numbered-regions and matching exercises, in observation order. Those exercises need a one-to-one link between a region and an observation: duplicate links to the same observation, or fewer regions than the exercise minimum, disable the method for that case. The reader has an independent `Repere` toggle and named comparison layers; comparison-only images never enter ordinary image tabs or graded prompts.

## Chapter banks (v2)

`curriculum.chapterBanks` holds reusable, chapter-specific answer variants:

```json
{
  "chapterId": "respiratory",
  "sections": {
    "projection": {"options": [{"id": "pa", "label": "Postero-anterioară (PA)"}]},
    "findings": {
      "types": [{
        "id": "opacity",
        "label": "Opacitate",
        "fields": [
          {"id": "structure", "label": "Structura", "kind": "single",
           "options": [{"id": "homogeneous", "label": "Omogenă"}]},
          {"id": "size", "label": "Mărimea", "kind": "measurementMm"}
        ]
      }]
    }
  }
}
```

The choice sections are `examination`, `projection`, `differentials` and `investigations`; each bank option has a stable ID. `findings` defines observation types, each with fields. A field is `single`, `multiple` or `measurementMm`. IDs are scoped to their field or section and must not be reused for another meaning.

## Structured case findings (v2)

```json
"structured": {
  "status": "source-derived",
  "choices": {"projection": ["pa"], "examination": [], "differentials": [], "investigations": []},
  "observations": [{
    "itemId": "p001-findings-1",
    "typeId": "hypertransparency",
    "values": {"wall": ["thick-irregular"], "margins": ["ill-defined"]},
    "note": "Notă de studiu, fără rol de notare."
  }],
  "sectionNotes": {"findings": "Text păstrat pentru învățare."}
}
```

An observation links an existing `findings` item to a chapter type. `values` contains only keyed fields; an omitted field is unassessed, not assumed negative. `measurementMm` values are positive numbers rounded to 0.1 mm. Notes are plain text and never become questions, distractors or grading input. The positive diagnosis remains `case.diagnosisIds`; differential labels are never correct diagnoses. `status` is `draft` or `source-derived`; a legacy `reviewed` value is read as `source-derived` on import.

Study derives structured exercises from non-draft cases. It asks `examination` → `projection` → `findings` → `diagnosis` → `differentials` → `investigations`, skipping unkeyed parts. Choice steps use exact ID sets. Findings are matched one-to-one by type and keyed fields (ignoring unkeyed submitted fields), so repeated observation types cannot receive double credit. The guided review reveals one step before continuing, while the exam simulation reveals nothing until final submission. A structured attempt updates one spaced-review record; free-text notes and authored written questions stay outside automatic accuracy.

## Comparisons and linked differentials (v2)

A case may name up to eight comparison layers:

```json
"comparisons": [{"id": "cmp-1", "label": "Structură normală", "caseId": "p002", "imageId": "primary"}]
```

Both target pairs must exist in the pack. Studio can upload a local image with `role: "comparison"` and reference it. Study shows these on demand beside the base film; they are never installed as ordinary primary views.

A differential item may add `targetCaseId`:

```json
{"id": "diff-1", "text": "Atelectazie", "targetCaseId": "p021"}
```

The target is another case in the same pack, never the current case. Study opens it in a closeable preview without changing the route, visit state or reading position. Unlinked differential text remains prose.

## questions.json

| Field | Content |
|---|---|
| `format`, `version` | `radiology-question-bank`, `1` or `2` (v2 needs a v2 pack) |
| `packId`, `revision` | Must match the pack exactly |
| `items` | The list of session-independent MCQs and written questions |

An MCQ has `id, caseId, sectionId, kind:'mcq', prompt, options:[{id,label,feedback}], correctOptionIds, feedback`. Grading compares exact sets of IDs; the order of options does not affect the key. Several correct IDs enable multiple selection.

A written question has `id, caseId, sectionId, kind:'written', prompt, rubric`. It has no options and is never graded automatically. The author's `rubric` is shown only after the answer is submitted; the learner may record one self-check per attempt, kept in `selfAssessments` with kind `written` and outside automatic accuracy.

Every authored question in the bank is eligible for a session. Notes never generate MCQs or written questions; an author writes them explicitly. A legacy `reviewStatus` field is a leftover of an earlier authoring workflow: import ignores it instead of rejecting the bank, so older packs and question banks keep loading.

Selecting the diagnosis from the catalogue does not require a question in the bank: it uses the catalogue and the case references directly. For other reasoning, the author writes the alternatives explicitly.

## Compatibility and backup

IDs use ASCII letters/digits and `.`, `_`, `:`, `-`, with a maximum of 120 characters. Do not reuse an ID for another case, another diagnosis or another observation. A published correction changes `revision` and keeps the IDs with the same meaning.

The progress backup is separate, with `format:'radiology-learning-backup'`, `version:1` or `2`. It is not part of a shared pack. Version 1 stays importable; version 2 is written when `progress` contains `structured` or `selfAssessments` contains `written`. The optional `selfAssessments` field keeps self-assessments written separately from `progress`; old backups, without this field, remain valid. Structured records carry `identified`/`total` and `selfAssessed:false`; written self-checks stay in `selfAssessments` with `selfAssessed:true`. The full backup contains `backup.json` and the packs in `packs/000/`, `packs/001/` etc. It does not include unfinished sessions or Studio projects.
