import { SECTION_LABELS, scheduleReview } from './core.js';
import { observationFields } from './schema.js';

export const STRUCTURED_ORDER = Object.freeze(['examination', 'projection', 'findings', 'diagnosis', 'differentials', 'investigations']);

const PROMPTS = Object.freeze({
  examination: 'Ce examinare este?',
  projection: 'Ce incidență este?',
  findings: 'Adaugă observațiile pe care le identifici.',
  diagnosis: 'Care este diagnosticul pozitiv?',
  differentials: 'Ce diagnostice diferențiale ai lua în calcul?',
  investigations: 'Ce explorări suplimentare sunt indicate?',
});

function bankFor(pack, chapterId) {
  return pack.curriculum.chapterBanks?.find(row => row.chapterId === chapterId) || null;
}

function visibleOptions(options) {
  return (options || [])
    .filter(option => typeof option.label === 'string' && option.label.trim())
    .map(option => ({ id: option.id, label: option.label }));
}

function cleanFields(fields = [], nested = false) {
  return fields.filter(field => typeof field.label === 'string' && field.label.trim()).map(field => {
    const options = visibleOptions(field.options);
    const groups = cleanFields(field.groups, true);
    return {
      id: field.id,
      label: field.label,
      kind: field.kind,
      ...(field.options ? { options } : {}),
      ...(groups.length ? { groups } : {}),
      scoreable: field.kind === 'measurementMm' || options.length > 1 || (nested && field.kind === 'multiple' && options.length === 1),
    };
  });
}

function normaliseValues(values = {}) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value]).sort(([a], [b]) => a.localeCompare(b)));
}

function primaryKey(caseData) {
  const image = caseData.images.find(row => row.role !== 'comparison') || caseData.images[0];
  return [image.path, image.width, image.height, image.sha256 || ''].join('|');
}

function canonicalField(field) {
  const key = [field.id, field.kind, (field.options || []).map(option => option.id).sort()];
  if (field.groups?.length) key.push(field.groups.map(canonicalField));
  return key;
}

function canonical(step) {
  if (step.kind === 'findings') {
    return ['findings', step.expected.map(row => [row.typeId, normaliseValues(row.values)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      step.types.map(type => [type.id, type.fields.map(canonicalField)])];
  }
  return [step.kind, step.sectionId, [...step.expected].sort(), step.options.map(option => option.id).sort(), Boolean(step.multiple)];
}

function findingsStep(pack, caseData, structured) {
  const bank = bankFor(pack, caseData.chapterId);
  const types = (bank?.sections.findings?.types || [])
    .filter(type => typeof type.label === 'string' && type.label.trim())
    .map(type => ({ id: type.id, label: type.label, fields: cleanFields(type.fields) }));
  const scoreableFields = new Map();
  for (const type of types) {
    const scored = observationFields(type.fields).filter(field => field.scoreable);
    if (scored.length) scoreableFields.set(type.id, new Set(scored.map(field => field.id)));
  }
  const expected = [];
  for (const row of structured.observations || []) {
    const fieldIds = scoreableFields.get(row.typeId);
    if (!fieldIds) continue;
    const values = {};
    for (const [fieldId, value] of Object.entries(row.values || {})) {
      if (fieldIds.has(fieldId) && (!Array.isArray(value) || value.length)) values[fieldId] = value;
    }
    if (Object.keys(values).length) expected.push({ itemId: row.itemId, typeId: row.typeId, values: normaliseValues(values) });
  }
  if (!expected.length) return null;
  return {
    id: 'findings', kind: 'findings', sectionId: 'findings', prompt: PROMPTS.findings,
    types: types.filter(type => scoreableFields.has(type.id)),
    expected: expected.sort((a, b) => `${a.typeId}:${JSON.stringify(a.values)}`.localeCompare(`${b.typeId}:${JSON.stringify(b.values)}`)),
  };
}

export function structuredExercise(pack, caseData) {
  const structured = caseData.structured;
  if (!structured || structured.status === 'draft') return null;
  const bank = bankFor(pack, caseData.chapterId);
  const steps = [];
  for (const sectionId of ['examination', 'projection', 'differentials', 'investigations']) {
    const authored = [...new Set(structured.choices?.[sectionId] || [])].sort();
    const options = visibleOptions(bank?.sections[sectionId]?.options);
    const optionIds = new Set(options.map(option => option.id));
    const expected = authored.filter(id => optionIds.has(id));
    if (!expected.length || expected.length !== authored.length || options.length < 2) continue;
    steps.push({ id: sectionId, kind: 'choice', sectionId, prompt: PROMPTS[sectionId], expected, options, multiple: expected.length > 1 });
  }
  const findings = findingsStep(pack, caseData, structured);
  if (findings) steps.push(findings);
  const authoredDiagnoses = [...new Set(caseData.diagnosisIds)].sort();
  const diagnosisOptions = pack.diagnoses.filter(row => row.chapterIds.includes(caseData.chapterId) && row.label.trim()).map(row => ({ id: row.id, label: row.label }));
  const diagnosisIds = new Set(diagnosisOptions.map(option => option.id));
  const diagnosisExpected = authoredDiagnoses.filter(id => diagnosisIds.has(id));
  if (diagnosisExpected.length && diagnosisExpected.length === authoredDiagnoses.length && diagnosisOptions.length > 1) {
    steps.push({ id: 'diagnosis', kind: 'choice', sectionId: 'diagnosis', prompt: PROMPTS.diagnosis, expected: diagnosisExpected, options: diagnosisOptions, multiple: diagnosisExpected.length > 1 });
  }
  if (!steps.length) return null;
  const ordered = STRUCTURED_ORDER.map(sectionId => steps.find(step => step.id === sectionId)).filter(Boolean);
  const signature = JSON.stringify(['structured', caseData.id, primaryKey(caseData), ordered.map(canonical)]);
  return {
    id: `structured:${caseData.id}`,
    kind: 'structured',
    caseId: caseData.id,
    chapterId: caseData.chapterId,
    sectionId: 'findings',
    prompt: 'Interpretează radiografia, pas cu pas.',
    steps: ordered,
    signature,
  };
}

export function stepLabel(step) {
  return SECTION_LABELS[step.sectionId] || step.prompt;
}

function valuesMatch(expected = {}, submitted = {}) {
  return Object.entries(expected).every(([key, value]) => {
    const other = submitted[key];
    if (typeof value === 'number') return Number.isFinite(other) && Math.round(other * 10) === Math.round(value * 10);
    if (!Array.isArray(other) || other.length !== value.length) return false;
    const a = [...value].sort(), b = [...other].sort();
    return a.every((id, index) => id === b[index]);
  });
}

function maximumMatching(expected, submitted) {
  const edges = expected.map(row => submitted.map((other, index) => valuesMatch(row.values, other.values) && row.typeId === other.typeId ? index : -1));
  const match = new Array(submitted.length).fill(-1);
  const pairs = [];
  function assign(left, seen) {
    for (let right = 0; right < submitted.length; right++) {
      if (edges[left][right] !== right || seen[right]) continue;
      seen[right] = true;
      if (match[right] === -1 || assign(match[right], seen)) {
        match[right] = left; pairs[left] = right; return true;
      }
    }
    return false;
  }
  let hit = 0;
  for (let left = 0; left < expected.length; left++) if (assign(left, [])) hit++;
  return { hit, pairs };
}

function choiceGrade(step, selection = []) {
  const expected = [...new Set(step.expected)].sort(), actual = [...new Set(selection)].sort();
  const correct = expected.length === actual.length && expected.every((id, index) => id === actual[index]);
  return { stepId: step.id, sectionId: step.sectionId, kind: 'choice', correct, expected, selected: actual,
    missing: expected.filter(id => !actual.includes(id)), extra: actual.filter(id => !expected.includes(id)) };
}

function findingsGrade(step, submitted = []) {
  const rows = submitted.filter(row => row && row.typeId && row.values);
  const { hit } = maximumMatching(step.expected, rows);
  return { stepId: step.id, sectionId: step.sectionId, kind: 'findings', correct: hit === step.expected.length && rows.length === step.expected.length,
    expected: step.expected, submitted: rows, hit, total: step.expected.length };
}

export function gradeStructured(exercise, answer = {}) {
  const results = exercise.steps.map(step => {
    const submitted = answer.sections?.[step.id] || {};
    return step.kind === 'findings' ? findingsGrade(step, submitted.observations || []) : choiceGrade(step, submitted.choiceIds || []);
  });
  const hit = results.filter(result => result.correct).length;
  return { results, hit, total: results.length, correct: results.length > 0 && hit === results.length };
}

export function structuredRecord(previous, grade, now = Date.now()) {
  return {
    ...scheduleReview(previous, grade.correct, now),
    identified: grade.hit,
    total: grade.total,
    selfAssessed: false,
  };
}

export function optionLabel(step, id) {
  return step.options?.find(option => option.id === id)?.label || id;
}

function describeFields(fields, values, parent = '') {
  const parts = [];
  for (const field of fields) {
    const label = parent ? `${parent} / ${field.label}` : field.label;
    const value = values[field.id];
    if (typeof value === 'number') parts.push(`${label}: ${value} mm`);
    else if (field.options && value?.length) parts.push(`${label}: ${value.map(id => field.options.find(option => option.id === id)?.label || id).join(', ')}`);
    if (field.groups) parts.push(...describeFields(field.groups, values, label));
  }
  return parts;
}

export function describeObservation(step, row) {
  const type = step.types.find(item => item.id === row.typeId);
  if (!type) return row.typeId;
  const parts = describeFields(type.fields, row.values || {});
  return `${type.label}${parts.length ? ` — ${parts.join('; ')}` : ''}`;
}
