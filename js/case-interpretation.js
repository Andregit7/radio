import { SECTION_LABELS } from './core.js';
import { button, el, icon } from './dom.js';

export function caseInterpretation(item, onSelect) {
  const rows = new Map();
  const toggles = new Map();
  const notes = el('section', { class: 'interpretation', 'aria-label': 'Interpretarea radiografiei' });
  const linkedItems = new Set(item.annotations.map(row => row.itemId));
  const observationNotes = new Map((item.structured?.observations || []).filter(row => row.note).map(row => [row.itemId, row.note]));

  function select(itemId, reveal = false) {
    const row = rows.get(itemId);
    if (!row) return;
    for (const candidate of rows.values()) candidate.classList.toggle('active', candidate === row);
    if (reveal) {
      const body = row.parentElement;
      body.hidden = false;
      toggles.get(body).setAttribute('aria-expanded', 'true');
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  for (const [index, [sectionId, label]] of Object.entries(SECTION_LABELS).entries()) {
    const section = item.sections.find(row => row.id === sectionId);
    const body = el('div', { class: 'notes-body', id: `section-${sectionId}` });
    const toggle = button([el('span', { class: 'notes-number' }, String(index + 1).padStart(2, '0')), label, icon('chevron', 15)], () => {
      body.hidden = !body.hidden;
      toggle.setAttribute('aria-expanded', String(!body.hidden));
    }, 'notes-heading', { 'aria-expanded': 'true', 'aria-controls': body.id });
    toggles.set(body, toggle);
    if (!section?.items.length) body.append(el('p', { class: 'missing' }, 'Nu este precizat în notițele sursă.'));
    for (const point of section?.items || []) {
      const linked = linkedItems.has(point.id);
      const row = el('div', { class: `finding${linked ? ' linked' : ''}`, tabindex: linked ? '0' : null, role: linked ? 'button' : null }, point.text);
      if (linked) {
        const activate = () => { onSelect(point.id); select(point.id); };
        row.addEventListener('click', activate);
        row.addEventListener('keydown', event => {
          if (!['Enter', ' '].includes(event.key)) return;
          event.preventDefault();
          activate();
        });
      }
      rows.set(point.id, row);
      body.append(row);
      if (observationNotes.has(point.id)) body.append(el('p', { class: 'study-note' }, icon('info', 13), observationNotes.get(point.id)));
    }
    const note = item.structured?.sectionNotes?.[sectionId];
    if (note) body.append(el('p', { class: 'study-note' }, icon('info', 13), note));
    notes.append(el('section', { class: 'notes-section' }, toggle, body));
  }
  notes.append(el('details', { class: 'source-disclosure' }, el('summary', {}, 'Vezi transcrierea integrală'), el('div', { class: 'source-text' }, item.referenceText)));
  return { node: notes, select };
}

export function caseComparisonLayers(pack, item) {
  const layers = [];
  for (const row of item.comparisons || []) {
    const target = pack.cases.find(candidate => candidate.id === row.caseId);
    const image = target?.images.find(candidate => candidate.id === row.imageId);
    if (image) layers.push({ id: row.id, label: row.label, path: image.path, ...(row.caseId === item.id ? { imageId: image.id } : {}) });
  }
  return layers;
}
