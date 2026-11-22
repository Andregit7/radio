export const APP_VERSION = '0.5.1';
export const DAY = 86_400_000;
export const SECTION_LABELS = Object.freeze({
  examination: 'Tipul examinării', projection: 'Incidență', findings: 'Semiologie',
  diagnosis: 'Diagnostic pozitiv', differentials: 'Diagnostic diferențial', investigations: 'Alte explorări',
});

export function normalise(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('ro')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function matches(value, query) {
  const haystack = normalise(value);
  return normalise(query).split(' ').every(token => haystack.includes(token));
}

// This function has no case/answer argument: results cannot leak the answer.
export function searchCatalogue(diagnoses, chapters, query = '', allowedChapterIds = []) {
  const allowed = new Set(allowedChapterIds);
  const results = diagnoses.filter(item =>
    (!allowed.size || item.chapterIds.some(id => allowed.has(id))) &&
    matches([item.label, ...(item.keywords ?? item.aliases ?? [])].join(' '), query));
  return chapters.filter(chapter => !allowed.size || allowed.has(chapter.id)).map(chapter => ({
    ...chapter,
    items: results.filter(item => item.chapterIds.includes(chapter.id))
      .sort((a, b) => a.label.localeCompare(b.label, 'ro', { sensitivity: 'base' })),
  })).filter(chapter => chapter.items.length);
}

export function shuffled(values, random = Math.random) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const progressKey = (packId, questionId, kind = 'catalogue') => `${packId}|${questionId}|${kind}`;
export function questionSignature(question) {
  // The catalogue/MCQ output stays byte-identical so v0.1.0 progress survives.
  if(question.kind==='structured')
    return question.signature || JSON.stringify(['structured',question.caseId,question.steps]);
  if(question.kind==='written')
    return JSON.stringify(['written',question.caseId,question.sectionId,question.prompt,question.rubric]);
  if(question.kind==='interpretation')
    return JSON.stringify(['interpretation',question.sectionId,question.prompt,[...question.itemIds].sort()]);
  if(question.kind==='regions')
    return JSON.stringify(['regions',question.sectionId,question.prompt,
      [...question.regions].sort((a,b)=>a.annotationId.localeCompare(b.annotationId)).map(row=>[row.annotationId,row.itemId])]);
  if(question.kind==='matching')
    return JSON.stringify(['matching',question.sectionId,question.prompt,
      [...question.pairs].sort((a,b)=>a.regionId.localeCompare(b.regionId)).map(row=>[row.regionId,row.itemId])]);
  return JSON.stringify([question.kind,question.sectionId,question.prompt,[...question.correctOptionIds].sort(),
    (question.options || []).map(row=>[row.id,row.label]).sort((a,b)=>a[0].localeCompare(b[0]))]);
}
export function matchingProgress(record,question) {return record?.signature===questionSignature(question)?record:null;}

export function gradeAnswer(selectedIds, correctIds) {
  const selected = [...new Set(selectedIds)].sort();
  const expected = [...new Set(correctIds)].sort();
  return expected.length > 0 && selected.length === expected.length && selected.every((id, i) => id === expected[i]);
}

export function scheduleReview(previous, correct, now = Date.now()) {
  const old = previous || { attempts: 0, correct: 0, streak: 0, lapses: 0, intervalDays: 0 };
  const streak = correct ? old.streak + 1 : 0;
  const intervalDays = correct ? (streak === 1 ? 1 : streak === 2 ? 3 : Math.min(90, Math.round(Math.max(3, old.intervalDays) * 2))) : 0;
  return {
    ...old, attempts: old.attempts + 1, correct: old.correct + Number(correct), streak,
    lapses: old.lapses + Number(!correct), intervalDays,
    dueAt: now + (correct ? intervalDays * DAY : 10 * 60_000), lastAt: now, lastCorrect: correct,
  };
}

// Review: due mistakes first, then other due questions, new material, future items.
// Exam: independent shuffled selection with round-robin chapter coverage.
export function chooseQuestions(questions, progress, packId, count, mode = 'review', now = Date.now(), random = Math.random) {
  if (mode === 'exam') {
    const groups = new Map();
    for (const q of shuffled(questions, random)) {
      const group = groups.get(q.chapterId) || [];
      group.push(q); groups.set(q.chapterId, group);
    }
    const ordered = [];
    const groupList = shuffled([...groups.values()], random);
    while (groupList.some(group => group.length)) for (const group of groupList) if (group.length) ordered.push(group.shift());
    return ordered.slice(0, count);
  }
  return shuffled(questions, random).map(q => {
    const record = matchingProgress(progress[progressKey(packId, q.id, q.kind)],q);
    const category = !record ? 2 : record.dueAt <= now ? (record.lastCorrect ? 1 : 0) : 3;
    return { q, category, due: record?.dueAt || 0 };
  }).sort((a, b) => a.category - b.category || (a.category < 2 ? a.due - b.due : 0)).slice(0, count).map(item => item.q);
}

export function availableQuestions(pack, bank = null, { kind = 'mixed', chapterIds = [] } = {}) {
  const allowed = new Set(chapterIds);
  const cases = new Map(pack.cases.map(item => [item.id, item]));
  const selectedCases = pack.cases.filter(item => !allowed.size || allowed.has(item.chapterId));
  const catalogue = kind === 'mcq' || kind === 'written' ? [] : selectedCases.filter(item => item.diagnosisIds.length).map(item => ({
    id: `diagnosis:${item.id}`, caseId: item.id, chapterId: item.chapterId, sectionId: 'diagnosis',
    kind: 'catalogue', prompt: 'Care este diagnosticul pozitiv?', correctOptionIds: item.diagnosisIds,
    feedback: item.sections.find(section => section.id === 'diagnosis')?.items.map(row => row.text).join('\n') || '',
  }));
  const authored = (bank?.items || []).filter(item => {
    const source = cases.get(item.caseId);
    return source && (!allowed.size || allowed.has(source.chapterId));
  }).map(item => ({ ...item, chapterId: cases.get(item.caseId).chapterId }));
  const mcqs = kind === 'catalogue' || kind === 'written' ? [] : authored.filter(item => (item.kind || 'mcq') === 'mcq');
  const written = kind === 'catalogue' || kind === 'mcq' ? [] : authored.filter(item => item.kind === 'written');
  return [...catalogue, ...mcqs.filter(q=>kind!=='mixed' || q.sectionId!=='diagnosis' || !catalogue.some(c=>c.caseId===q.caseId)), ...written];
}

export function bytesLabel(bytes = 0) {
  return bytes < 1_000_000 ? `${Math.round(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function dateLabel(timestamp) {
  if (!timestamp) return 'Niciodată';
  return new Intl.DateTimeFormat('ro', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}
