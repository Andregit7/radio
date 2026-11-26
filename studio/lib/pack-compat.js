import { SECTION_LABELS } from './core.js';

const SECTION_ITEM_LIMIT = 100;
const ITEM_TEXT_LIMIT = 20_000;
const CHOICE_SECTIONS = ['examination', 'projection', 'differentials', 'investigations'];
const noteText = value => typeof value === 'string' ? value.trim() : '';

function selectedOptions(options = [], selectedIds = []) {
  const selected = new Set(selectedIds);
  return options.filter(option => selected.has(option.id) && noteText(option.label));
}

function labelledObservationFields(fields = [], parent = '') {
  return fields.flatMap(field => {
    const label = [parent, noteText(field.label)].filter(Boolean).join(' / ');
    return [{ ...field, label }, ...labelledObservationFields(field.groups, label)];
  });
}

function observationNotes(row, type) {
  const fields = new Map(labelledObservationFields(type?.fields).map(field => [field.id, field]));
  const values = [];
  for (const [id, value] of Object.entries(row.values || {})) {
    const field = fields.get(id);
    if (!field) continue;
    const selected = Array.isArray(value) ? selectedOptions(field.options, value).map(option => noteText(option.label)).join(', ')
      : field.kind === 'measurementMm' && Number.isFinite(value) && value > 0 ? `${value} mm` : '';
    if (selected) values.push([field.label, selected].filter(Boolean).join(' — '));
  }
  return [
    { key: 'details', text: values.join('\n') },
    ...Object.entries(row.fieldNotes || {}).map(([id, value]) => ({
      key: `field-${id}`, text: noteText(value) ? [fields.get(id)?.label, noteText(value)].filter(Boolean).join(' — ') : '',
    })),
    { key: 'note', text: noteText(row.note) },
  ];
}

function splitLongNote(text) {
  const parts = [];
  while (text.length > ITEM_TEXT_LIMIT) {
    const separator = Math.max(text.lastIndexOf('\n', ITEM_TEXT_LIMIT), text.lastIndexOf(' ', ITEM_TEXT_LIMIT));
    let end = separator >= ITEM_TEXT_LIMIT / 2 ? separator : ITEM_TEXT_LIMIT;
    if (/^[\uDC00-\uDFFF]$/.test(text[end])) end--;
    parts.push(text.slice(0, end).trim());
    text = text.slice(end).trimStart();
  }
  return [...parts, text];
}

function reserveNoteId(ids, sectionId, key) {
  const base = `legacy-${sectionId}-${key}`.replace(/[^a-zA-Z0-9._:-]+/g, '-').slice(0, 108);
  let id = base;
  for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
  ids.add(id);
  return id;
}

function addNotes(section, notes, ids, anchorId) {
  const index = section.items.findIndex(item => item.id === anchorId);
  const anchor = section.items[index];
  let position = anchor ? index + 1 : section.items.length;
  const seen = new Set((anchor ? [anchor] : section.items).map(item => noteText(item.text)));
  for (const note of notes) {
    const text = noteText(note.text);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    for (const [part, chunk] of splitLongNote(text).entries()) {
      if (anchor && !noteText(anchor.text)) {
        anchor.text = chunk;
        continue;
      }

      // Keep full legacy sections exportable when their existing rows still have room.
      const overflow = section.items.length >= SECTION_ITEM_LIMIT &&
        [anchor, section.items[position - 1], ...section.items].find(item =>
          item && !item.targetCaseId && item.text.length + chunk.length + 2 <= ITEM_TEXT_LIMIT);
      if (overflow) {
        overflow.text = [overflow.text, chunk].filter(Boolean).join('\n\n');
      } else {
        const id = reserveNoteId(ids, section.id, `${note.key}-${part + 1}`);
        section.items.splice(position++, 0, { id, text: chunk });
      }
    }
  }
  if (section.items.some(item => noteText(item.text))) section.status = 'present';
}

function withoutStructuredNotes(item, bank = {}) {
  if (!Object.hasOwn(item, 'structured')) return item;
  const { structured, ...plain } = item;
  if (!structured) return plain;
  const sections = item.sections.map(section => ({ ...section, items: section.items.map(row => ({ ...row })) }));
  const ids = new Set(sections.flatMap(section => section.items.map(row => row.id)));
  function place(sectionId, notes, anchorId) {
    if (!notes.some(note => noteText(note.text))) return;
    let section = sections.find(candidate => candidate.id === sectionId);
    if (!section) {
      section = { id: sectionId, label: SECTION_LABELS[sectionId], items: [] };
      sections.push(section);
    }
    addNotes(section, notes, ids, anchorId);
  }

  for (const sectionId of CHOICE_SECTIONS) {
    const options = selectedOptions(bank[sectionId]?.options, structured.choices?.[sectionId]);
    place(sectionId, options.map(option => ({ key: `choice-${option.id}`, text: option.label })));
  }
  const types = new Map((bank.findings?.types || []).map(type => [type.id, type]));
  const findingItems = new Map(sections.find(section => section.id === 'findings')?.items.map(row => [row.id, row]) || []);
  const annotated = new Set((item.annotations || []).map(annotation => annotation.itemId));
  for (const [index, row] of (structured.observations || []).entries()) {
    const type = types.get(row.typeId);
    const notes = observationNotes(row, type);
    const finding = findingItems.get(row.itemId);
    if (!noteText(finding?.text) && (annotated.has(row.itemId) || notes.some(note => noteText(note.text)))) {
      notes.unshift({ key: 'type', text: type?.label });
    }
    place('findings', notes.map(note => ({
      ...note, key: `${row.itemId || `observation-${index + 1}`}-${note.key}`,
    })), row.itemId);
  }
  for (const sectionId of Object.keys(SECTION_LABELS)) {
    place(sectionId, [{ key: 'section-note', text: structured.sectionNotes?.[sectionId] }]);
  }
  return { ...plain, sections };
}

// Preserve case content from older archives and drafts as editable, assessable notes.
export function packWithoutAnswerBanks(pack) {
  const { curriculum: { chapterBanks, ...curriculum }, ...plain } = pack;
  const banks = new Map((chapterBanks || []).map(bank => [bank.chapterId, bank.sections]));
  return { ...plain, curriculum, cases: pack.cases.map(item => withoutStructuredNotes(item, banks.get(item.chapterId))) };
}
