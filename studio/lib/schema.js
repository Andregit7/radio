export const LIMITS = Object.freeze({ archive: 32 * 1024 * 1024, total: 64 * 1024 * 1024,
  entry: 12 * 1024 * 1024, json: 3 * 1024 * 1024, entries: 1200, cases: 500, diagnoses: 2500,
  pixels: 12_000_000, questions: 6000 });

export function requireThat(condition, message) { if (!condition) throw new Error(message); }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 20000) => typeof value === 'string' && value.length <= max;
const id = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const list = (value, max) => Array.isArray(value) && value.length <= max;
const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;
const strings = (rows, max = 100) => list(rows, max) && rows.every(value => text(value, 400));
const range = value => Number.isFinite(value) && value >= 0 && value <= 1;
const oneOf = (value, values) => values.includes(value);
export const safePath = value => typeof value === 'string' && value.length <= 220 &&
  /^[a-zA-Z0-9_./-]+$/.test(value) && !value.startsWith('/') && !value.includes('..') && !value.includes('//') && !value.endsWith('/');

const SECTION_IDS = ['examination', 'projection', 'findings', 'diagnosis', 'differentials', 'investigations'];
const CHOICE_SECTIONS = ['examination', 'projection', 'differentials', 'investigations'];
const SHAPES = ['ellipse', 'rect', 'polygon', 'arrow'];
const V2_SHAPES = [...SHAPES, 'polyline'];
const PATTERNS = ['none', 'diagonal', 'dots', 'vertical', 'horizontal'];
const CLOSED_SHAPES = new Set(['ellipse', 'rect', 'polygon']);
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
export const LINE_STYLES = Object.freeze(['solid', 'dotted', 'dashed', 'dash-dot', 'double']);
export const MIN_LINE_WIDTH = 1;
export const MAX_LINE_WIDTH = 12;
export const OBSERVATION_FIELD_LIMITS = Object.freeze({ perLevel: 24, perType: 256, levels: 8, options: 64 });

export function observationFields(fields = []) {
  return fields.flatMap(field => [field, ...observationFields(field.groups)]);
}

export function parseJSON(value, max = LIMITS.json) {
  requireThat(typeof value === 'string' && new TextEncoder().encode(value).length <= max, 'Fișierul JSON depășește limita permisă.');
  try { return JSON.parse(value, (key, item) => {
    requireThat(!['__proto__', 'prototype', 'constructor'].includes(key), 'Cheie JSON nesigură.'); return item;
  }); } catch (error) { throw new Error(`JSON invalid: ${error.message}`); }
}

function points(row, minimum) {
  return Array.isArray(row) && row.length >= minimum &&
    row.every(point => Array.isArray(point) && point.length === 2 && point.every(range));
}

export function nonCollinear(rows) {
  const [first] = rows;
  const second = rows.find(point => point[0] !== first[0] || point[1] !== first[1]);
  return Boolean(second && rows.some(point =>
    (second[0] - first[0]) * (point[1] - first[1]) - (second[1] - first[1]) * (point[0] - first[0]) !== 0));
}

export function validateAnnotation(row, imageIds, itemIds, version = 1) {
  const v2 = version === 2;
  requireThat(object(row) && id(row.id) && imageIds.has(row.imageId) && itemIds.has(row.itemId), 'Adnotare cu referințe invalide.');
  requireThat((v2 ? V2_SHAPES : SHAPES).includes(row.shape), 'Formă de adnotare nesuportată.');
  if (row.shape === 'ellipse') requireThat([row.cx, row.cy, row.rx, row.ry].every(range) && row.rx > 0 && row.ry > 0, 'Elipsă invalidă.');
  if (row.shape === 'rect') requireThat([row.x, row.y, row.width, row.height].every(range) && row.width > 0 && row.height > 0, 'Dreptunghi invalid.');
  if (row.shape === 'arrow') requireThat([row.x1, row.y1, row.x2, row.y2].every(range), 'Săgeată invalidă.');
  if (row.shape === 'polygon') requireThat(points(row.points, 3) && nonCollinear(row.points), 'Poligon invalid.');
  if (row.shape === 'polyline') requireThat(v2 && points(row.points, 2) && row.points.some(([x, y]) =>
    x !== row.points[0][0] || y !== row.points[0][1]), 'Contur liber invalid.');
  let style;
  if (row.style !== undefined) {
    requireThat(v2, 'Stilurile de adnotare necesită pachetul versiunea 2.');
    requireThat(object(row.style) && (row.style.color === undefined || (typeof row.style.color === 'string' && HEX_COLOUR.test(row.style.color))) &&
      (row.style.pattern === undefined || PATTERNS.includes(row.style.pattern)) &&
      (row.style.line === undefined || LINE_STYLES.includes(row.style.line)) &&
      (row.style.width === undefined || (Number.isFinite(row.style.width) && row.style.width >= MIN_LINE_WIDTH && row.style.width <= MAX_LINE_WIDTH)), 'Stil de adnotare invalid.');
    const pattern = row.style.pattern || 'none';
    requireThat(CLOSED_SHAPES.has(row.shape) || pattern === 'none', 'Modelul de umplere este permis doar formelor închise.');
    style = { pattern, ...(row.style.color ? { color: row.style.color.toLowerCase() } : {}),
      ...(row.style.line !== undefined ? { line: row.style.line } : {}), ...(row.style.width !== undefined ? { width: row.style.width } : {}) };
  }
  return { id: row.id, imageId: row.imageId, itemId: row.itemId, shape: row.shape,
    ...Object.fromEntries(['cx','cy','rx','ry','x','y','width','height','x1','y1','x2','y2'].filter(k => k in row).map(k => [k, row[k]])),
    ...(row.points ? { points: row.points.map(p => [...p]) } : {}), ...(style ? { style } : {}),
    label: text(row.label, 80) ? row.label : '' };
}

function validateObservationFields(fields, ids = new Set(), level = 1) {
  const { perLevel, perType, levels, options: optionLimit } = OBSERVATION_FIELD_LIMITS;
  requireThat(level <= levels && list(fields, perLevel), 'Sunt prea multe niveluri sau câmpuri de observație.');
  return fields.map(field => {
    requireThat(object(field) && id(field.id) && text(field.label, 400) && field.label.trim() &&
      oneOf(field.kind, level === 1 ? ['single', 'multiple', 'measurementMm'] : ['single', 'multiple']), 'Câmp de observație invalid.');
    requireThat(!ids.has(field.id) && ids.size < perType, 'Câmpuri de observație duplicate sau prea numeroase.');
    ids.add(field.id);
    const { id: fieldId, label, kind } = field;
    if (kind === 'measurementMm') {
      requireThat(field.options === undefined && field.groups === undefined, 'Un câmp numeric nu are variante sau subgrupuri.');
      return { id: fieldId, label, kind };
    }
    const options = field.options === undefined ? [] : field.options;
    requireThat(list(options, optionLimit) &&
      options.every(option => object(option) && id(option.id) && text(option.label, 400) && option.label.trim()) &&
      unique(options), 'Variantele câmpului sunt invalide.');
    const groups = field.groups === undefined ? [] : validateObservationFields(field.groups, ids, level + 1);
    requireThat(options.length || groups.length, 'Câmpul are nevoie de cel puțin o variantă sau un subgrup.');
    return { id: fieldId, label, kind,
      ...(options.length ? { options: options.map(option => ({ id: option.id, label: option.label })) } : {}),
      ...(groups.length ? { groups } : {}),
    };
  });
}

function validateBankSection(chapterId, sectionId, raw) {
  if (sectionId === 'findings') {
    requireThat(object(raw) && list(raw.types, 40) && unique(raw.types), `Tipurile de observații pentru ${chapterId} sunt invalide.`);
    const types = raw.types.map(type => {
      requireThat(object(type) && id(type.id) && text(type.label, 400) && type.label.trim(), 'Tip de observație invalid.');
      return { id: type.id, label: type.label, fields: validateObservationFields(type.fields) };
    });
    return { types };
  }
  requireThat(object(raw) && list(raw.options, 64) && raw.options.length && unique(raw.options) &&
    raw.options.every(option => object(option) && id(option.id) && text(option.label, 400) && option.label.trim()), `Variantele pentru ${sectionId} sunt invalide.`);
  return { options: raw.options.map(option => ({ id: option.id, label: option.label })) };
}

function bankIndex(bank) {
  const index = new Map();
  for (const sectionId of CHOICE_SECTIONS) {
    const rows = bank.sections[sectionId]?.options || [];
    index.set(sectionId, new Map(rows.map(row => [row.id, row])));
  }
  const types = new Map();
  for (const type of bank.sections.findings?.types || []) {
    types.set(type.id, { ...type, fieldsById: new Map(observationFields(type.fields).map(field => [field.id, field])) });
  }
  return { choices: index, types };
}

export function validatePack(raw) {
  requireThat(object(raw) && raw.format === 'radiology-study-pack' && (raw.version === 1 || raw.version === 2), 'Acest format de pachet nu este compatibil cu RadioEasy.');
  const version = raw.version, v2 = version === 2;
  requireThat(id(raw.id) && text(raw.title, 200) && raw.title.trim() && text(raw.revision, 60) && raw.revision.trim(), 'Identificarea pachetului este incompletă.');
  const curriculum = raw.curriculum;
  requireThat(object(curriculum) && id(curriculum.id) && text(curriculum.title, 200) && list(curriculum.chapters, 50) && curriculum.chapters.length, 'Curriculum invalid.');
  requireThat(curriculum.chapters.every(c => object(c) && id(c.id) && text(c.label, 120)) && unique(curriculum.chapters), 'Capitole invalide sau duplicate.');
  const chapterIds = new Set(curriculum.chapters.map(row => row.id));
  if (!v2) requireThat(curriculum.chapterBanks === undefined, 'Băncile de răspunsuri necesită pachetul versiunea 2.');
  const rawBanks = curriculum.chapterBanks || [];
  requireThat(list(rawBanks, 50) && rawBanks.every(bank => object(bank) && id(bank.chapterId)) && new Set(rawBanks.map(bank => bank.chapterId)).size === rawBanks.length, 'Băncile pe capitole sunt invalide.');
  const chapterBanks = rawBanks.map(bank => {
    requireThat(object(bank) && chapterIds.has(bank.chapterId) && object(bank.sections), 'Bancă de răspunsuri cu referințe invalide.');
    const sections = {};
    for (const sectionId of [...CHOICE_SECTIONS, 'findings']) {
      const value = bank.sections[sectionId];
      if (value === undefined) continue;
      sections[sectionId] = validateBankSection(bank.chapterId, sectionId, value);
    }
    requireThat(Object.keys(sections).length, 'Banca de răspunsuri este goală.');
    return { chapterId: bank.chapterId, sections };
  });
  const banks = new Map(chapterBanks.map(bank => [bank.chapterId, { ...bank, index: bankIndex(bank) }]));
  const scopes = curriculum.scopes || [{ id: 'all', label: 'Toată materia', chapterIds: [...chapterIds] }];
  requireThat(list(scopes, 30) && unique(scopes) && scopes.every(row => id(row.id) && text(row.label, 160) && list(row.chapterIds, 50) && row.chapterIds.length && row.chapterIds.every(v => chapterIds.has(v))), 'Domenii de examen invalide.');
  requireThat(list(raw.diagnoses, LIMITS.diagnoses) && raw.diagnoses.every(object) && unique(raw.diagnoses), 'Catalog de diagnostice invalid.');
  const diagnoses = new Map(raw.diagnoses.map(row => {
    requireThat(id(row.id) && text(row.label, 400) && row.label.trim() &&
      list(row.chapterIds, 50) && row.chapterIds.length && row.chapterIds.every(v => chapterIds.has(v)), 'Diagnostic invalid în catalog.');
    const keywords = row.keywords === undefined ? (row.aliases || []) : row.keywords;
    requireThat(strings(keywords), 'Cuvinte-cheie invalide în catalogul de diagnostice.');
    return [row.id, {id:row.id,label:row.label,chapterIds:[...row.chapterIds],keywords:[...keywords]}];
  }));
  requireThat(list(raw.cases, LIMITS.cases) && raw.cases.length && unique(raw.cases), 'Lista de cazuri este goală sau invalidă.');
  const assets = new Map();
  const cases = raw.cases.map(item => {
    requireThat(object(item) && id(item.id) && chapterIds.has(item.chapterId) && text(item.title, 200) && list(item.diagnosisIds, 20) && item.diagnosisIds.every(v => diagnoses.has(v)), 'Caz cu identificare sau diagnostic invalid.');
    requireThat(list(item.images, 8) && item.images.length && unique(item.images), 'Imaginile cazului sunt invalide.');
    const images = item.images.map(image => {
      requireThat(object(image) && id(image.id) && safePath(image.path) && /^images\/.+\.(png|jpe?g)$/i.test(image.path), 'Sunt acceptate numai imagini PNG/JPEG în directorul images/.');
      requireThat(Number.isInteger(image.width) && Number.isInteger(image.height) && image.width > 0 && image.height > 0 && image.width * image.height <= LIMITS.pixels, 'Dimensiuni de imagine invalide.');
      requireThat(!image.sha256 || /^[a-f0-9]{64}$/i.test(image.sha256), 'Sumă de control invalidă.');
      if (image.role !== undefined) requireThat(v2, 'Rolurile imaginilor necesită pachetul versiunea 2.');
      requireThat(image.role === undefined || oneOf(image.role, ['primary', 'comparison']), 'Rol de imagine invalid.');
      if (assets.has(image.path)) requireThat(assets.get(image.path).width === image.width && assets.get(image.path).height === image.height && assets.get(image.path).sha256 === image.sha256, 'Imagine reutilizată cu metadate contradictorii.');
      const clean = { id: image.id, path: image.path, width: image.width, height: image.height, ...(v2 ? { role: image.role || 'primary' } : {}), ...(image.sha256 ? {sha256:image.sha256.toLowerCase()} : {}) };
      assets.set(image.path, clean); return clean;
    });
    if (v2) requireThat(images.some(image => image.role === 'primary'), 'Fiecare caz are nevoie de cel puțin o imagine principală.');
    requireThat(list(item.sections, 6) && unique(item.sections), 'Secțiunile cazului sunt invalide.');
    const sections = item.sections.map(section => {
      requireThat(SECTION_IDS.includes(section.id) && text(section.label, 120) && list(section.items, 100) && unique(section.items), 'Secțiune nesuportată.');
      requireThat(section.items.every(row => object(row) && id(row.id) && text(row.text)), 'Text sau identificator invalid.');
      return { id: section.id, label: section.label, items: section.items.map(row => {
        const clean = { id: row.id, text: row.text };
        if (section.id === 'differentials' && row.targetCaseId !== undefined) {
          requireThat(v2 && id(row.targetCaseId), 'Diagnosticul diferențial are o țintă invalidă.');
          clean.targetCaseId = row.targetCaseId;
        }
        return clean;
      }), status: section.items.length ? 'present' : 'missing' };
    });
    const itemIds = new Set(sections.flatMap(row => row.items.map(point => point.id)));
    requireThat(itemIds.size === sections.reduce((n, section) => n + section.items.length, 0), 'Identificatori de observații duplicați.');
    requireThat(list(item.annotations || [], 1000), 'Prea multe adnotări.');
    const imageIds = new Set(images.map(image => image.id));
    const annotations = (item.annotations || []).map(row => validateAnnotation(row, imageIds, itemIds, version));
    requireThat(unique(annotations), 'Identificatori de adnotări duplicați.');
    if (!v2) requireThat(item.comparisons === undefined && item.structured === undefined, 'Comparațiile și observațiile structurate necesită pachetul versiunea 2.');
    const comparisons = (item.comparisons || []);
    requireThat(list(comparisons, 8) && unique(comparisons), 'Comparațiile cazului sunt invalide.');
    const cleanComparisons = comparisons.map(row => {
      requireThat(object(row) && id(row.caseId) && id(row.imageId) && text(row.label, 120) && row.label.trim(), 'Referință de comparație invalidă.');
      return { id: row.id, label: row.label, caseId: row.caseId, imageId: row.imageId };
    });
    const findings = sections.find(section => section.id === 'findings');
    const findingsIds = new Set(findings?.items.map(row => row.id) || []);
    let structured = null;
    if (item.structured !== undefined) {
      requireThat(object(item.structured), 'Observațiile structurate sunt invalide.');
      const status = item.structured.status === 'reviewed' ? 'source-derived'
        : oneOf(item.structured.status, ['draft', 'source-derived']) ? item.structured.status : 'draft';
      const bank = banks.get(item.chapterId);
      const choices = {};
      for (const sectionId of CHOICE_SECTIONS) {
        const values = item.structured.choices?.[sectionId] || [];
        requireThat(list(values, 64) && values.every(value => typeof value === 'string') && new Set(values).size === values.length, `Selecțiile pentru ${sectionId} sunt invalide.`);
        if (!bank && values.length) requireThat(false, 'Cazul folosește o bancă care nu există pentru capitolul lui.');
        if (bank) requireThat(values.every(value => bank.index.choices.get(sectionId)?.has(value)), `Selecție fără variantă în banca de ${sectionId}.`);
        choices[sectionId] = [...values];
      }
      const observations = item.structured.observations || [];
      requireThat(list(observations, 100) && unique(observations.map(row => ({ id: row?.itemId }))), 'Observațiile structurate sunt invalide sau duplicate.');
      const cleanObservations = observations.map(row => {
        requireThat(object(row) && findingsIds.has(row.itemId) && id(row.typeId), 'Observație fără text sau tip valid.');
        const type = bank?.index.types.get(row.typeId);
        requireThat(type, 'Tipul observației nu există în banca capitolului.');
        requireThat(object(row.values), 'Valorile observației sunt invalide.');
        const values = {};
        for (const [fieldId, value] of Object.entries(row.values)) {
          const field = type.fieldsById.get(fieldId);
          requireThat(field, 'Câmp de observație necunoscut.');
          if (field.kind === 'measurementMm') {
            requireThat(Number.isFinite(value) && value > 0 && value <= 2000, 'Măsurarea este invalidă.');
            values[fieldId] = Math.round(value * 10) / 10;
          } else {
            requireThat(list(value, OBSERVATION_FIELD_LIMITS.options) && value.length && new Set(value).size === value.length &&
              field.options && value.every(optionId => field.options.some(option => option.id === optionId)), 'Selecțiile câmpului sunt invalide.');
            if (field.kind === 'single') requireThat(value.length === 1, 'Câmpul admite o singură variantă.');
            values[fieldId] = [...value];
          }
        }
        requireThat(text(row.note || '', 20000), 'Nota observației este prea lungă.');
        const fieldNotes = {};
        for (const [fieldId, note] of Object.entries(row.fieldNotes || {})) {
          requireThat(type.fieldsById.has(fieldId) && text(note, 4000), 'Nota câmpului este invalidă.');
          fieldNotes[fieldId] = note;
        }
        return { itemId: row.itemId, typeId: row.typeId, values, ...(row.note ? { note: row.note } : {}), ...(Object.keys(fieldNotes).length ? { fieldNotes } : {}) };
      });
      const sectionNotes = {};
      for (const [sectionId, note] of Object.entries(item.structured.sectionNotes || {})) {
        requireThat(SECTION_IDS.includes(sectionId) && text(note, 20000), 'Nota de secțiune este invalidă.');
        sectionNotes[sectionId] = note;
      }
      structured = { status, choices, observations: cleanObservations, ...(Object.keys(sectionNotes).length ? { sectionNotes } : {}) };
    }
    if (structured) requireThat(item.diagnosisIds.every(diagnosisId => diagnoses.get(diagnosisId).chapterIds.includes(item.chapterId)), 'Diagnosticul pozitiv nu aparține capitolului observațiilor structurate.');
    return { id:item.id, title:item.title, chapterId:item.chapterId, diagnosisIds:[...item.diagnosisIds], images, sections, annotations,
      ...(v2 || cleanComparisons.length ? { comparisons: cleanComparisons } : {}),
      ...(structured ? { structured } : {}),
      referenceText: text(item.referenceText, 30000) ? item.referenceText : '',
      source: { document: text(item.source?.document, 200) ? item.source.document : '', page: Number.isInteger(item.source?.page) && item.source.page > 0 ? item.source.page : null },
      completeness: ['full','partial','diagnosis-only'].includes(item.completeness) ? item.completeness : 'partial' };
  });
  const caseImages = new Map(cases.map(item => [item.id, new Map(item.images.map(image => [image.id, image]))]));
  for (const item of cases) {
    for (const row of item.comparisons || []) {
      requireThat(caseImages.has(row.caseId), 'Comparația trimite către un caz inexistent.');
      requireThat(caseImages.get(row.caseId).has(row.imageId), 'Comparația trimite către o imagine inexistentă.');
    }
    const differentials = item.sections.find(section => section.id === 'differentials');
    for (const row of differentials?.items || []) if (row.targetCaseId) {
      requireThat(row.targetCaseId !== item.id && caseImages.has(row.targetCaseId), 'Diagnosticul diferențial trimite către un caz invalid.');
    }
  }
  const clean = { format:raw.format,version,id:raw.id,revision:raw.revision,title:raw.title,
    description:text(raw.description, 3000) ? raw.description : '',language:text(raw.language, 20) ? raw.language : 'ro',
    source: {document:text(raw.source?.document, 200) ? raw.source.document : '',note:text(raw.source?.note, 3000) ? raw.source.note : ''},
    curriculum: {id:curriculum.id,title:curriculum.title,edition:text(curriculum.edition, 100) ? curriculum.edition : '',chapters:curriculum.chapters.map(c => ({id:c.id,label:c.label})),
      ...(chapterBanks.length ? { chapterBanks: chapterBanks.map(bank => ({ chapterId: bank.chapterId, sections: bank.sections })) } : {}),
      scopes:scopes.map(s => ({id:s.id,label:s.label,chapterIds:[...s.chapterIds]}))},
    diagnoses:[...diagnoses.values()],cases };
  return {pack:clean,assets};
}

export function validateQuestions(raw, pack) {
  if (raw == null) return null;
  requireThat(object(raw) && raw.format === 'radiology-question-bank' && (raw.version === 1 || raw.version === 2) && raw.packId === pack.id && raw.revision === pack.revision, 'Banca de întrebări nu corespunde versiunii pachetului.');
  requireThat(raw.version === 1 || pack.version === 2, 'Întrebările scrise necesită un pachet versiunea 2.');
  requireThat(list(raw.items, LIMITS.questions) && unique(raw.items), 'Bancă de întrebări invalidă.');
  const cases = new Set(pack.cases.map(row => row.id));
  const items = raw.items.map(row => {
    requireThat(object(row) && id(row.id) && cases.has(row.caseId) && text(row.prompt, 2000) && row.prompt.trim(), 'Întrebare invalidă.');
    requireThat(SECTION_IDS.includes(row.sectionId), 'Secțiune de întrebare invalidă.');
    if (row.kind === 'written') {
      requireThat(raw.version === 2 && text(row.rubric, 10000) && row.rubric.trim(), 'Întrebarea scrisă are nevoie de un barem autor.');
      requireThat(row.options === undefined && row.correctOptionIds === undefined, 'Întrebarea scrisă nu are variante.');
      return { id:row.id,caseId:row.caseId,kind:'written',sectionId:row.sectionId,prompt:row.prompt,rubric:row.rubric };
    }
    requireThat(row.kind === 'mcq' && text(row.feedback || '', 10000), 'Întrebare invalidă.');
    requireThat(list(row.options, 8) && row.options.length >= 2 && unique(row.options) && row.options.every(o => id(o.id) && text(o.label, 1500) && o.label.trim() && text(o.feedback || '', 4000)), 'Opțiuni invalide sau necompletate.');
    requireThat(new Set(row.options.map(o=>o.label.trim().toLocaleLowerCase('ro'))).size===row.options.length, 'Opțiuni de răspuns duplicate.');
    const options = new Set(row.options.map(o => o.id));
    requireThat(list(row.correctOptionIds, 8) && row.correctOptionIds.length > 0 && row.correctOptionIds.every(v => options.has(v)) && new Set(row.correctOptionIds).size === row.correctOptionIds.length, 'Cheie de răspuns invalidă.');
    return { id:row.id,caseId:row.caseId,kind:'mcq',sectionId:row.sectionId,prompt:row.prompt,
      correctOptionIds:[...row.correctOptionIds],options:row.options.map(o=>({id:o.id,label:o.label,feedback:o.feedback || ''})),
      feedback:row.feedback || '' };
  });
  return {format:raw.format,version:raw.version,packId:pack.id,revision:pack.revision,items};
}

export function imageDimensions(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71 && view.getUint32(4)===0x0d0a1a0a && view.getUint32(12)===0x49484452)
    return {width:view.getUint32(16),height:view.getUint32(20),mime:'image/png'};
  if (bytes[0]===255 && bytes[1]===216) {
    let p=2;
    while(p+4<=bytes.length) {
      requireThat(bytes[p]===255,'Structură JPEG invalidă.');
      while(bytes[p]===255) p++;
      const marker=bytes[p++];
      if(marker===0xd9 || marker===0xda) break;
      if(marker===0x01 || (marker>=0xd0 && marker<=0xd7)) continue;
      if(p+2>bytes.length) break;
      const size=view.getUint16(p);
      requireThat(size>=2 && p+size<=bytes.length,'Segment JPEG invalid.');
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        requireThat(size>=8,'JPEG incomplet.');
        return {height:view.getUint16(p+3),width:view.getUint16(p+5),mime:'image/jpeg'};
      }
      p+=size;
    }
  }
  throw new Error('Imagine PNG/JPEG invalidă sau nesuportată.');
}

export async function validateFiles(files, onProgress = () => {}) {
  const map = files instanceof Map ? files : new Map(files.map(f=>[f.name, f.data]));
  requireThat(map.has('pack.json'), 'Lipsește pack.json din rădăcina arhivei.');
  const decode = data => {requireThat(data.byteLength<=LIMITS.json,'Fișierul JSON depășește limita de 3 MiB.');return new TextDecoder('utf-8',{fatal:true}).decode(data);};
  const {pack,assets} = validatePack(parseJSON(decode(map.get('pack.json'))));
  const bank = map.has('questions.json') ? validateQuestions(parseJSON(decode(map.get('questions.json'))),pack) : null;
  const blobs = [];
  let total=map.get('pack.json').byteLength+(map.get('questions.json')?.byteLength || 0);
  for(const [path,metadata] of assets) {
    const data=map.get(path);
    requireThat(data && data.byteLength<=LIMITS.entry, `Imagine lipsă sau prea mare: ${path}`);
    const dims=imageDimensions(data);
    requireThat(dims.width===metadata.width && dims.height===metadata.height && dims.width*dims.height<=LIMITS.pixels, `Dimensiuni diferite pentru ${path}`);
    requireThat((dims.mime==='image/png')===path.toLowerCase().endsWith('.png'), 'Extensia imaginii nu corespunde conținutului.');
    if(metadata.sha256) {
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
      requireThat(hash===metadata.sha256, `Imagine coruptă: ${path}`);
    }
    total+=data.byteLength; blobs.push({path,blob:new Blob([data],{type:dims.mime})});
    onProgress(blobs.length/assets.size);
  }
  const expected=new Set(['pack.json','questions.json',...assets.keys()]);
  requireThat([...map.keys()].every(path=>expected.has(path)), 'Arhiva conține fișiere neutilizate. Exportă un pachet curat din Studio.');
  return {pack,bank,blobs,total};
}
