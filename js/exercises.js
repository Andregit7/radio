import { SECTION_LABELS, availableQuestions, shuffled, scheduleReview } from './core.js';
import { structuredExercise } from './structured.js';

export const EXERCISE_LABELS = Object.freeze({
  interpretation: 'Interpretare completă',
  structured: 'Interpretare structurată',
  regions: 'Regiuni numerotate',
  matching: 'Potrivire',
  short: 'Întrebări scurte',
  catalogue: 'Alegere din listă',
  mcq: 'Întrebare cu variante',
  written: 'Răspuns scris',
});

export const SECTION_PROMPTS = Object.freeze({
  examination: 'Ce examinare este?',
  projection: 'Ce incidență este?',
  findings: 'Ce observi pe imagine?',
  diagnosis: 'Care este diagnosticul pozitiv?',
  differentials: 'Ce diagnostice diferențiale ai lua în calcul?',
  investigations: 'Ce explorări suplimentare sunt indicate?',
});

export const SECTION_ORDER = Object.freeze(['examination', 'projection', 'findings', 'diagnosis', 'differentials', 'investigations']);

export function presentSections(caseData) {
  return SECTION_ORDER
    .map(id => caseData.sections.find(section => section.id === id))
    .filter(section => section?.items?.length);
}

export function interpretationExercise(caseData) {
  const sections = presentSections(caseData);
  if (sections.length < 2) return null;
  if (!sections.some(section => section.id !== 'diagnosis')) return null;
  return {
    id: `interpretation:${caseData.id}`,
    kind: 'interpretation',
    caseId: caseData.id,
    chapterId: caseData.chapterId,
    sectionId: 'interpretation',
    prompt: 'Interpretează radiografia.',
    sections: sections.map(section => ({ id: section.id, label: section.label || SECTION_LABELS[section.id] })),
    itemIds: sections.flatMap(section => section.items.map(item => item.id)),
  };
}

function reviewedFindingRows(caseData) {
  const findings = caseData.sections.find(section => section.id === 'findings');
  if (!findings?.items?.length) return [];
  const itemIds = new Set(findings.items.map(item => item.id));
  return caseData.annotations.filter(row => row.reviewStatus === 'reviewed' && itemIds.has(row.itemId));
}

function oneToOne(rows) {
  return rows.length > 0 && new Set(rows.map(row => row.itemId)).size === rows.length;
}

export function regionsExercise(caseData) {
  const rows = reviewedFindingRows(caseData);
  if (rows.length < 2 || !oneToOne(rows)) return null;
  const regions = rows.map((row, index) => ({ annotationId: row.id, label: String(index + 1), itemId: row.itemId }));
  return {
    id: `regions:${caseData.id}`,
    kind: 'regions',
    caseId: caseData.id,
    chapterId: caseData.chapterId,
    sectionId: 'findings',
    prompt: 'Scrie ce reprezintă fiecare regiune numerotată.',
    regions,
    sections: [{ id: 'findings', label: SECTION_LABELS.findings }],
    itemIds: regions.map(region => region.itemId),
  };
}

export function matchingExercise(caseData, random = Math.random) {
  const rows = reviewedFindingRows(caseData);
  if (rows.length < 3 || !oneToOne(rows)) return null;
  const texts = new Map(caseData.sections.flatMap(section => section.items).map(item => [item.id, item.text]));
  const pairs = rows.map((row, index) => ({ regionId: row.id, label: String(index + 1), itemId: row.itemId }));
  const options = shuffled(pairs.map((pair, index) => ({
    id: `option-${index + 1}`,
    itemId: pair.itemId,
    text: texts.get(pair.itemId),
  })), random);
  const correctMapping = Object.fromEntries(pairs.map(pair => [pair.regionId, options.find(option => option.itemId === pair.itemId).id]));
  return {
    id: `matching:${caseData.id}`,
    kind: 'matching',
    caseId: caseData.id,
    chapterId: caseData.chapterId,
    sectionId: 'findings',
    prompt: 'Potrivește fiecare descriere cu regiunea corespunzătoare.',
    pairs,
    options,
    correctMapping,
    regions: pairs.map(pair => ({ annotationId: pair.regionId, label: pair.label })),
    itemIds: pairs.map(pair => pair.itemId),
  };
}

export function availableExercises(pack, bank = null, { chapterIds = [], random = Math.random } = {}) {
  const allowed = new Set(chapterIds);
  const cases = pack.cases.filter(item => !allowed.size || allowed.has(item.chapterId));
  const build = builder => cases.map(builder).filter(Boolean);
  return {
    interpretation: build(item => item.structured ? null : interpretationExercise(item)),
    structured: build(item => structuredExercise(pack, item)),
    regions: build(regionsExercise),
    matching: build(item => matchingExercise(item, random)),
    short: availableQuestions(pack, bank, { kind: 'mixed', chapterIds }),
  };
}

export function gradeMatching(selected = {}, correct = {}) {
  const expected = Object.keys(correct);
  return expected.length > 0 && selected !== null && typeof selected === 'object' &&
    expected.length === Object.keys(selected).length && expected.every(regionId => selected[regionId] === correct[regionId]);
}

export function matchingScore(selected = {}, correct = {}) {
  const expected = Object.keys(correct);
  const hit = expected.filter(regionId => selected[regionId] === correct[regionId]).length;
  return { hit, total: expected.length };
}

export function answerSelfChecks(answer) {
  return Object.values(answer?.selfChecks || {}).flat();
}

export function selfAssessmentCount(answer) {
  return new Set(answerSelfChecks(answer)).size;
}

export function selfAssessmentItems(record, exercise) {
  if (exercise.kind === 'regions') {
    const texts = new Map((record.pack.cases.find(item => item.id === exercise.caseId)?.sections || [])
      .flatMap(section => section.items).map(item => [item.id, item.text]));
    return exercise.regions.map(region => ({
      id: `region:${region.annotationId}`, sectionId: 'findings',
      text: texts.get(region.itemId) || '', regionId: region.annotationId,
    }));
  }
  if (exercise.kind !== 'interpretation') return [];
  const caseData = record.pack.cases.find(item => item.id === exercise.caseId);
  if (!caseData) return [];
  const rows = [];
  for (const section of caseData.sections) {
    if (section.id === 'diagnosis') continue;
    if (!exercise.sections.some(row => row.id === section.id)) continue;
    for (const item of section.items) rows.push({ id: item.id, sectionId: section.id, text: item.text });
  }
  const labels = canonicalDiagnosisLabels(record, exercise.caseId);
  if (labels.length) {
    for (const [index, label] of labels.entries()) {
      rows.push({ id: `diagnosis:${caseData.diagnosisIds[index] || index}`, sectionId: 'diagnosis', text: label, canonical: true });
    }
  } else {
    const section = caseData.sections.find(row => row.id === 'diagnosis');
    for (const item of section?.items || []) rows.push({ id: item.id, sectionId: 'diagnosis', text: item.text, canonical: true });
  }
  return rows;
}

export function recordSelfAssessment(previous, { identified = 0, total = 0 }, now = Date.now()) {
  const safeTotal = Math.max(0, total);
  const safeIdentified = Math.max(0, Math.min(safeTotal, identified));
  const correct = safeTotal > 0 && safeIdentified >= safeTotal;
  return {
    ...scheduleReview(previous, correct, now),
    identified: safeIdentified,
    total: safeTotal,
    selfAssessed: true,
  };
}

export function sessionAnswer(session, answer) {
  const answers = [...session.answers];
  while (answers.length < session.questions.length) answers.push(null);
  answers[session.index] = answer;
  return { ...session, answers };
}

export function advanceSession(session, answer, now = Date.now()) {
  const next = sessionAnswer(session, answer);
  const last = session.index >= session.questions.length - 1;
  return last ? { ...next, finished: true, finishedAt: now } : { ...next, index: session.index + 1 };
}

export function finishSessionEarly(session, now = Date.now()) {
  return { ...session, finished: true, finishedEarly: true, finishedAt: now };
}

export function receivedAnswers(session) {
  return (session.answers || []).filter(Boolean);
}

export function exerciseSubject(record, exercise) {
  const source = record.pack.cases.find(item => item.id === exercise.caseId);
  return source || null;
}

export function canonicalDiagnosisLabels(record, caseId) {
  const source = record.pack.cases.find(item => item.id === caseId);
  if (!source) return [];
  return source.diagnosisIds.map(id => record.pack.diagnoses.find(row => row.id === id)?.label).filter(Boolean);
}
