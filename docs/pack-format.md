# Contractul pachetelor · versiunea 1

Validatorul executabil este `dist/js/schema.js`. Contractul nu depinde de interfață, de ordinea întrebărilor sau de algoritmul de recapitulare.

## Arhivă

```text
pack.json
questions.json (opțional)
images/caz-001.jpeg
images/caz-002.png
```

Sunt acceptate ZIP standard stored sau deflate, fără criptare, ZIP64, volume multiple, legături simbolice, nume duplicate ori fișiere neutilizate. Căile sunt relative ASCII, folosesc `/`, nu conțin `..`, `\`, scheme URL sau directoare absolute. Imaginile acceptate sunt PNG și JPEG; SVG, HTML și JavaScript importate nu sunt executate sau afișate ca material.

## pack.json

| Câmp | Conținut |
|---|---|
| `format`, `version` | `radiology-study-pack`, `1` |
| `id`, `revision`, `title` | Identificator stabil, versiune și nume |
| `description`, `language`, `source` | Descriere, limbă și proveniență |
| `curriculum` | ID, nume, ediție, capitole și domenii de examen |
| `diagnoses` | Catalogul canonic al programei |
| `cases` | Cazuri cu imagini, explicații și repere |

Un capitol are `{id, label}`. Un domeniu are `{id, label, chapterIds}`. Domeniile pot împărți aceleași capitole; imaginile nu sunt duplicate. Nu există presupuneri hardcodate despre colocviul I/II sau examenul final.

Un diagnostic are `{id, label, chapterIds, aliases}`. Aliasurile sunt numai pentru căutare; nu creează răspunsuri distincte. Un concept cu alt sens primește alt ID. Schimbarea ortografiei nu necesită un ID nou.

Un caz are:

- `id`, `title`, `chapterId`, `diagnosisIds`;
- `source: {document, page}` și `referenceText`, pentru transcrierea păstrată;
- `images: [{id, path, width, height, sha256?}]`;
- `sections: [{id, label, items: [{id, text}], status}]`;
- `annotations` și `completeness`.

Secțiunile sunt `examination`, `projection`, `findings`, `diagnosis`, `differentials`, `investigations`. O secțiune fără text este afișată ca neprecizată, fără completare automată. `completeness` poate fi `full`, `partial` sau `diagnosis-only`; indică prezența datelor, nu validare medicală.

`diagnosisIds: []` păstrează cazul pentru studiu, fără întrebare automată. Mai multe ID-uri reprezintă diagnostice care trebuie selectate împreună, nu sinonime acceptate alternativ. Sinonimele apar în `aliases` ale unui singur concept.

## Repere

Un reper referă explicit o imagine și un element de text:

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
  "label": "1",
  "reviewStatus": "draft"
}
```

Toate coordonatele sunt normalizate în intervalul 0–1. Alte forme acceptate: `rect` cu `x,y,width,height`, `polygon` cu `points:[[x,y],…]`, `arrow` cu `x1,y1,x2,y2`. Formele sunt reconstruite prin API-uri DOM/SVG; pachetul nu furnizează markup. `reviewed` înseamnă verificare asumată de contributor, nu o acreditare medicală oferită de aplicație.

## questions.json

| Câmp | Conținut |
|---|---|
| `format`, `version` | `radiology-question-bank`, `1` |
| `packId`, `revision` | Trebuie să corespundă exact pachetului |
| `items` | Lista grilelor independente de sesiune |

O grilă are `id, caseId, sectionId, kind:'mcq', prompt, options:[{id,label,feedback}], correctOptionIds, feedback, reviewStatus`. Notarea compară seturi exacte de ID-uri; ordinea opțiunilor nu afectează cheia. Mai multe ID-uri corecte activează selectarea multiplă.

Stările sunt `draft`, `source-derived`, `reviewed`. Study exclude `draft`. Studio exportă numai întrebările reconfirmate sau cele sursă păstrate fără editări. O modificare a explicațiilor unui caz readuce grilele lui în starea `draft`.

Selecția diagnosticului din catalog nu necesită o întrebare în bancă: folosește direct catalogul și referințele cazului. Pentru alte raționamente, autorul pregătește și verifică explicit alternativele.

## Compatibilitate și backup

ID-urile folosesc litere/cifre ASCII și `.`, `_`, `:`, `-`, cu maximum 120 de caractere. Nu reutiliza un ID pentru alt caz, alt diagnostic sau altă observație. O corectură publicată schimbă `revision` și păstrează ID-urile cu același sens.

Backupul de progres este separat, cu `format:'radiology-learning-backup', version:1`. El nu este parte dintr-un pachet partajat. Backupul complet conține `backup.json` și pachetele în `packs/000/`, `packs/001/` etc. Nu include sesiuni neterminate sau proiecte Studio.
