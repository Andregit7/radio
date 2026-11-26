import { SECTION_LABELS, availableQuestions, scheduleReview } from './core.js';

export const EXERCISE_LABELS = Object.freeze({
  catalogue: 'Diagnostic',
  interpretation: 'Interpretare completă',
});

export const SECTION_PROMPTS = Object.freeze({
  examination: 'Ce examinare este?',
  projection: 'Ce incidență este?',
  findings: 'Ce observi pe imagine?',
  diagnosis: 'Care este diagnosticul pozitiv?',
  differentials: 'Ce diagnostice diferențiale ai lua în calcul?',
  investigations: 'Ce explorări suplimentare sunt indicate?',
});

export const SECTION_ORDER = Object.freeze(Object.keys(SECTION_LABELS));

export function presentSections(caseData) {
  return SECTION_ORDER
    .map(id => caseData.sections.find(section => section.id === id))
    .filter(Boolean)
    .map(section => ({ ...section, items: section.items.filter(item => item.text.trim()) }))
    .filter(section => section.items.length);
}

export function interpretationExercise(caseData) {
  const sections = presentSections(caseData);
  if (!sections.length) return null;
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

export function availableExercises(pack, { chapterIds = [] } = {}) {
  const allowed = new Set(chapterIds);
  const cases = pack.cases.filter(item => !allowed.size || allowed.has(item.chapterId));
  const catalogue = availableQuestions(pack, null, { kind: 'catalogue', chapterIds });
  for (const item of cases) {
    if (item.diagnosisIds.length || !presentSections(item).some(section => section.id === 'diagnosis')) continue;
    catalogue.push({
      id: `diagnosis:${item.id}`,
      caseId: item.id,
      chapterId: item.chapterId,
      sectionId: 'diagnosis',
      kind: 'catalogue',
      prompt: SECTION_PROMPTS.diagnosis,
      correctOptionIds: [],
    });
  }
  return { catalogue, interpretation: cases.map(interpretationExercise).filter(Boolean) };
}

export function selfAssessmentItems(caseData) {
  return presentSections(caseData).flatMap(section =>
    section.items.map(item => ({ id: item.id, sectionId: section.id, text: item.text })));
}

export const validNoteScore = score => Number.isInteger(score) && score >= 0 && score <= 10;

export function assessmentMean(scores) {
  if (!scores?.length) return null;
  return scores.reduce((sum, row) => sum + row.score, 0) / scores.length;
}

export function recordSelfAssessment(previous, scores, now = Date.now()) {
  const identified = scores.filter(row => row.score === 10).length;
  return {
    ...scheduleReview(previous, identified === scores.length, now),
    identified,
    total: scores.length,
    selfAssessed: true,
    scores,
  };
}

export function sessionAnswer(session, answer, index = session.index) {
  const answers = [...session.answers];
  while (answers.length < session.questions.length) answers.push(null);
  answers[index] = answer;
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
  return session.answers.filter(answer => answer && !answer.skipped);
}

export function canonicalDiagnosisLabels(record, caseData) {
  const diagnoses = new Map(record.pack.diagnoses.map(row => [row.id, row.label]));
  return caseData.diagnosisIds.map(id => diagnoses.get(id)).filter(Boolean);
}
