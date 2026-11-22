import { button, el, icon, modal, toast } from './lib/dom.js';
import {
  annotationNumbers, annotationRenderer, annotationsInObservationOrder, autoColour,
  convertAnnotationShape, DEFAULT_LINE_WIDTH, LINE_STYLES, MARK_PALETTE, markColour,
  MAX_LINE_WIDTH, MIN_LINE_WIDTH, updateAnnotationGeometry,
} from './lib/annotation-view.js';

const SVG = 'http://www.w3.org/2000/svg';
const SHAPES = {
  ellipse: 'Elipsă', rect: 'Dreptunghi', arrow: 'Săgeată',
  polyline: 'Contur liber deschis', polygon: 'Contur liber închis',
};
const FILLS = { none: 'Fără umplere', diagonal: 'Linii oblice', dots: 'Puncte', vertical: 'Linii verticale', horizontal: 'Linii orizontale' };
const LINES = { solid: 'Continuă', dotted: 'Punctată', dashed: 'Întreruptă', 'dash-dot': 'Linie-punct', double: 'Dublă' };
const CLOSED = new Set(['ellipse', 'rect', 'polygon']);
const PROMPT_KEY = 'radioeasy-studio-hide-binding-prompt';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const choice = (value, label) => el('option', { value }, label);

function select(label, entries, value, change) {
  const node = el('select', { class: 'studio-control', 'aria-label': label, onchange: event => change(event.target.value) },
    ...entries.map(([id, text]) => choice(id, text)));
  node.value = value;
  return node;
}

function control(label, input) {
  return el('label', { class: 'studio-ribbon-control' }, el('span', {}, label), input);
}

function draftGeometry(shape, start, end, points) {
  const [x1, y1] = start, [x2, y2] = end;
  if (shape === 'ellipse') return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx: Math.abs(x1 - x2) / 2, ry: Math.abs(y1 - y2) / 2 };
  if (shape === 'rect') return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x1 - x2), height: Math.abs(y1 - y2) };
  if (shape === 'arrow') return { x1, y1, x2, y2 };
  return { points };
}

function validGeometry(row, box) {
  if (row.shape === 'ellipse') return row.rx * box.width >= 2 && row.ry * box.height >= 2;
  if (row.shape === 'rect') return row.width * box.width >= 4 && row.height * box.height >= 4;
  if (row.shape === 'arrow') return Math.hypot((row.x2 - row.x1) * box.width, (row.y2 - row.y1) * box.height) >= 5;
  if (row.shape === 'polyline') return row.points.length >= 2;
  const [first, second] = row.points;
  return Boolean(second && row.points.some((point, index) => index > 1 &&
    Math.abs((second[0] - first[0]) * (point[1] - first[1]) - (second[1] - first[1]) * (point[0] - first[0])) > 1e-9));
}

function scrollWithin(container, target) {
  if (!container || !target) return;
  const pane = container.getBoundingClientRect(), box = target.getBoundingClientRect();
  if (box.top < pane.top || box.bottom > pane.bottom) {
    container.scrollTop += box.top - pane.top - Math.max(0, (pane.height - box.height) / 2);
  }
}

function swatch(row) {
  const node = el('span', { class: 'studio-mark-swatch', 'aria-hidden': 'true' });
  node.style.backgroundColor = markColour(row);
  return node;
}

function colourWheel() {
  const step = 100 / MARK_PALETTE.length;
  return `conic-gradient(${MARK_PALETTE.map((colour, index) => `${colour} ${index * step}% ${(index + 1) * step}%`).join(', ')})`;
}

const autoMark = () => el('span', { class: 'studio-colour-auto-mark', 'aria-hidden': 'true' }, 'A');

function wheelBadge() {
  const node = el('span', { class: 'studio-colour-wheel', 'aria-hidden': 'true' }, autoMark());
  node.style.background = colourWheel();
  return node;
}

export function annotationWorkbench({ item, pack, files, state, preferences = state, remember, changed, ensureV2, uid, onUpload, onPreview, onDelete, undoControl, renderNotes }) {
  const settings = preferences.settings ??= { shape: 'ellipse', color: 'auto', pattern: 'none', line: 'solid', width: DEFAULT_LINE_WIDTH };
  const collapsed = preferences.collapsed ??= {};
  const widths = preferences.widths ??= { marks: 21, notes: 31 };
  const heights = preferences.heights ??= {};
  preferences.tool ??= 'draw';
  const observations = new Map();
  const marks = new Map();
  const rows = new Map();
  const paneToggles = new Map();
  const imageFor = id => item.images.find(image => image.id === id);
  const itemFor = id => item.sections.flatMap(section => section.items).find(row => row.id === id);
  state.imageId = (imageFor(state.imageId) || item.images.find(image => image.role !== 'comparison') || item.images[0]).id;
  if (!itemFor(state.preboundId)) state.preboundId = null;
  if (!itemFor(state.selectedObservationId)) state.selectedObservationId = null;
  if (!itemFor(state.groupId)) state.groupId = null;
  if (!Array.isArray(state.selectedIds)) state.selectedIds = [];
  state.selectedIds = state.selectedIds.filter(id => item.annotations.some(row => row.id === id));
  if (!state.selectedIds.includes(state.annotationId)) {
    state.annotationId = state.selectedIds.length === 1 ? state.selectedIds[0] : null;
  }

  let objectUrl, displayedPath, redrawId, frame = 0, gesture = null, liveMark = null, spaceHeld = false, suppressMarkClick = false;
  let annotationLabels, ordered;
  const view = { zoom: 1, x: 0, y: 0 };
  const root = el('div', { class: 'studio-workbench' });
  const ribbonBody = el('div', { class: 'studio-ribbon-body', id: 'studio-ribbon-body' });
  const drawTab = button('Desen', () => setRibbonTab('draw'), 'chip');
  const selectionTab = button('Reper selectat', () => setRibbonTab('selection'), 'chip');
  const ribbonToggle = button('', () => {
    preferences.ribbonCollapsed = !preferences.ribbonCollapsed;
    syncRibbon();
    queueMicrotask(sizeCanvas);
  }, 'studio-panel-toggle', { 'aria-controls': 'studio-ribbon-body' });
  const ribbon = el('section', { class: 'studio-ribbon', 'aria-label': 'Instrumente pentru repere' },
    el('header', { class: 'studio-ribbon-head' }, el('div', { class: 'studio-ribbon-tabs' }, drawTab, selectionTab),
      el('div', { class: 'studio-ribbon-actions' }, undoControl || null,
        button([icon('eye', 15), 'Previzualizare'], () => onPreview?.(state.imageId, state.comparisonId), 'chip'),
        onDelete ? button([icon('trash', 15), 'Șterge cazul'], () => onDelete(), 'chip chip-danger') : null,
        ribbonToggle)), ribbonBody);
  const binding = el('div', { class: 'studio-bind-notice', role: 'status', 'aria-live': 'polite' });
  const list = el('div', { class: 'studio-mark-list' });
  const selectAll = el('input', { type: 'checkbox', class: 'studio-mark-check studio-select-all',
    'aria-label': 'Selectează toate reperele', title: 'Selectează toate reperele', onchange: event => toggleAll(event.target.checked) });
  const marksHeadTools = el('label', { class: 'studio-select-all-wrap' }, selectAll, el('span', {}, 'Toate'));
  const notes = el('div', { class: 'studio-pane-body studio-notes-body' });
  const listBody = el('div', { class: 'studio-pane-body studio-marks-body' }, list);
  const svg = document.createElementNS(SVG, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 1000 1000', preserveAspectRatio: 'none', class: 'studio-workbench-overlay', 'aria-label': 'Repere pe radiografie' })) svg.setAttribute(key, value);
  const picture = el('img', { alt: item.title, draggable: 'false' });
  const canvas = el('div', { class: 'studio-workbench-canvas' }, picture, svg);
  const missing = el('p', { class: 'studio-workbench-missing', role: 'status', hidden: true }, 'Imaginea nu este disponibilă.');
  const stage = el('div', { class: 'studio-workbench-stage', tabindex: '0', 'aria-label': 'Radiografie. Rotița ajustează zoomul. Tastele [ și ] schimbă stratul. Ține Spațiu și trage pentru deplasare.' }, canvas, missing);
  const zoomLabel = el('output', { class: 'studio-zoom-label', 'aria-live': 'polite' }, '100%');
  const selectTool = button(icon('cursor', 17), () => setTool('select'), 'studio-stage-button', { 'aria-label': 'Selectează reperele', title: 'Selectează reperele' });
  const penTool = button(icon('pen', 17), () => setTool('draw'), 'studio-stage-button', { 'aria-label': 'Desenează un reper', title: 'Desenează un reper' });
  const panTool = button(icon('hand', 17), () => setTool('pan'), 'studio-stage-button', { 'aria-label': 'Deplasează imaginea', title: 'Deplasează imaginea (Spațiu + tragere)' });
  const viewerControls = el('div', { class: 'studio-view-tools' },
    button('−', () => zoomTo(view.zoom / 1.25), 'studio-stage-button', { 'aria-label': 'Micșorează radiografia' }),
    zoomLabel,
    button('+', () => zoomTo(view.zoom * 1.25), 'studio-stage-button', { 'aria-label': 'Mărește radiografia' }),
    button('Încadrează', resetView, 'studio-stage-button'), selectTool, penTool, panTool);
  const imageSelect = select('Imagine editată', [], state.imageId, value => switchImage(value));
  const layerSelect = select('Strat afișat', [], '', value => setComparison(value || null));
  const imageHeadTools = el('div', { class: 'studio-pane-head-tools' }, imageSelect, layerSelect);
  const imageBody = el('div', { class: 'studio-pane-body studio-image-body' }, stage, viewerControls);
  const grid = el('div', { class: 'studio-workbench-grid' });

  function pane(id, label, body, extra = null, heading = label) {
    body.id = `studio-pane-body-${id}`;
    const toggle = button('', () => setCollapsed(id, !collapsed[id]), 'studio-panel-toggle', { 'aria-controls': body.id });
    const node = el('section', { class: `studio-workbench-pane studio-pane-${id}`, 'aria-label': label },
      el('header', { class: 'studio-pane-head' }, el('div', { class: 'studio-pane-head-title' }, el('h2', {}, heading), extra), toggle), body,
      separator(id, 'height', `Redimensionează pe verticală: ${label}`));
    paneToggles.set(id, { toggle, node, body, label });
    return node;
  }

  grid.append(pane('marks', 'Repere', listBody, marksHeadTools), separator('marks', 'width', 'Redimensionează lista de repere'),
    pane('image', 'Radiografie', imageBody, imageHeadTools, 'Radiografie:'), separator('notes', 'width', 'Redimensionează observațiile'), pane('notes', 'Observații', notes));
  root.append(ribbon, binding, grid);

  function syncPaneSizes() {
    // When the center is collapsed, the open side panes share the available width.
    const marksWidth = collapsed.marks ? '40px' : collapsed.image ? 'minmax(180px, 1fr)' : `${widths.marks}%`;
    const imageWidth = collapsed.image ? '40px' : 'minmax(160px, 1fr)';
    const notesWidth = collapsed.notes ? '40px' : collapsed.image ? 'minmax(180px, 1fr)' : `${widths.notes}%`;
    grid.style.setProperty('--studio-workbench-columns', `${marksWidth} 8px ${imageWidth} 8px ${notesWidth}`);
    for (const [id, { node, body, toggle, label }] of paneToggles) {
      const closed = Boolean(collapsed[id]);
      body.hidden = closed;
      node.classList.toggle('is-collapsed', closed);
      node.style.setProperty('--studio-mobile-pane-height', heights[id] ? `${heights[id]}px` : '');
      toggle.setAttribute('aria-expanded', String(!closed));
      toggle.setAttribute('aria-label', `${closed ? 'Deschide' : 'Restrânge'} ${label.toLowerCase()}`);
      toggle.title = toggle.getAttribute('aria-label');
      toggle.textContent = closed ? '+' : '−';
    }
    for (const handle of grid.querySelectorAll('[data-resize-pane]')) {
      const id = handle.dataset.resizePane;
      const horizontal = handle.getAttribute('aria-orientation') === 'horizontal';
      const disabled = Boolean(collapsed[id] || (!horizontal && collapsed.image));
      handle.setAttribute('aria-disabled', String(disabled));
      handle.tabIndex = disabled ? -1 : 0;
      if (horizontal) handle.setAttribute('aria-valuenow', String(heights[id] || (id === 'image' ? 340 : 235)));
      else handle.setAttribute('aria-valuenow', String(widths[id]));
    }
  }

  function setCollapsed(id, value) {
    if (value && Object.keys(collapsed).filter(key => collapsed[key]).length >= 2) {
      toast('Păstrează cel puțin un panou deschis.');
      return;
    }
    collapsed[id] = value;
    syncPaneSizes();
    queueMicrotask(sizeCanvas);
  }

  function separator(id, direction, label) {
    const height = direction === 'height';
    const node = el('div', { class: `studio-resize studio-resize-${direction}`, role: 'separator', tabindex: '0',
      'data-resize-pane': id, 'aria-label': label, 'aria-orientation': height ? 'horizontal' : 'vertical',
      'aria-valuemin': height ? '150' : '14', 'aria-valuemax': height ? '900' : '50' });
    let drag = null;
    const value = () => height ? heights[id] || paneToggles.get(id).node.clientHeight : widths[id];
    function resize(next) {
      if (height) heights[id] = clamp(Math.round(next), 150, 900);
      else widths[id] = clamp(Math.round(next), 14, Math.min(50, 78 - widths[id === 'marks' ? 'notes' : 'marks']));
      syncPaneSizes();
      sizeCanvas();
    }
    node.addEventListener('pointerdown', event => {
      if (event.button !== 0 || node.getAttribute('aria-disabled') === 'true') return;
      drag = { point: height ? event.clientY : event.clientX, value: value() };
      node.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    node.addEventListener('pointermove', event => {
      if (!drag) return;
      const delta = (height ? event.clientY : event.clientX) - drag.point;
      resize(drag.value + (height ? delta : (id === 'notes' ? -delta : delta) * 100 / grid.clientWidth));
    });
    node.addEventListener('lostpointercapture', () => { drag = null; });
    node.addEventListener('keydown', event => {
      const amount = height ? { ArrowUp: -20, ArrowDown: 20 }[event.key] : { ArrowLeft: -2, ArrowRight: 2 }[event.key];
      if (!amount || node.getAttribute('aria-disabled') === 'true') return;
      event.preventDefault();
      resize(value() + (id === 'notes' && !height ? -amount : amount));
    });
    return node;
  }

  const selectedIdSet = () => new Set(state.selectedIds || []);
  const selectedRows = () => item.annotations.filter(row => selectedIdSet().has(row.id));
  const selected = () => item.annotations.find(row => row.id === state.annotationId) || (selectedRows().length === 1 ? selectedRows()[0] : null);
  const activeComparison = () => (item.comparisons || []).find(row => row.id === state.comparisonId);
  const comparisonImage = row => pack.cases.find(caseRow => caseRow.id === row.caseId)?.images.find(image => image.id === row.imageId);
  const displayedImage = () => activeComparison() ? comparisonImage(activeComparison()) : imageFor(state.imageId);

  function refreshLabels() {
    ordered = annotationsInObservationOrder(item);
    annotationLabels = annotationNumbers(item);
  }

  function updateAnnotation(callback, { reselection = false } = {}) {
    const row = selected();
    if (!row) return;
    remember();
    callback(row);
    ensureV2();
    changed();
    paint();
    if (reselection) renderRibbon();
  }

  function setTool(tool) {
    preferences.tool = tool;
    toolControls?.querySelectorAll('button').forEach(button => {
      const active = button.dataset.tool === tool;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active', active);
    });
    syncCursor();
  }

  function setRibbonTab(tab) {
    state.ribbonTab = tab;
    preferences.ribbonCollapsed = false;
    syncRibbon();
    renderRibbon();
  }

  function syncRibbon() {
    const editing = state.ribbonTab === 'selection' && selectedRows().length > 0;
    selectionTab.disabled = selectedRows().length === 0;
    ribbonBody.hidden = Boolean(preferences.ribbonCollapsed);
    for (const [target, active] of [[drawTab, !editing], [selectionTab, editing]]) {
      target.classList.toggle('active', active);
      target.setAttribute('aria-pressed', String(active));
    }
    const label = preferences.ribbonCollapsed ? 'Extinde instrumentele' : 'Restrânge instrumentele';
    ribbonToggle.replaceChildren(icon(preferences.ribbonCollapsed ? 'chevron-up' : 'chevron-down', 15));
    ribbonToggle.setAttribute('aria-expanded', String(!preferences.ribbonCollapsed));
    ribbonToggle.setAttribute('aria-label', label);
    ribbonToggle.title = label;
  }

  let toolControls;
  function renderRibbon() {
    syncRibbon();
    const rowsSelected = state.ribbonTab === 'selection' ? selectedRows() : [];
    const multi = rowsSelected.length > 1;
    const row = rowsSelected.length === 1 ? rowsSelected[0] : null;
    const pendingStyle = !rowsSelected.length && state.pending ? state.pending.style || {} : null;
    const values = row ? row.style || {} : pendingStyle || settings;
    const shape = row?.shape || (pendingStyle ? state.pending.shape : settings.shape);
    const styleValue = (mark, key) => mark.style?.[key] ?? (key === 'pattern' ? 'none' : key === 'line' ? 'solid' : DEFAULT_LINE_WIDTH);
    const commonValue = key => {
      if (!rowsSelected.length) return settings[key];
      const first = styleValue(rowsSelected[0], key);
      return rowsSelected.every(candidate => styleValue(candidate, key) === first) ? first : undefined;
    };
    const applyStyle = (key, value) => {
      if (!rowsSelected.length) {
        settings[key] = value;
        if (state.pending) {
          state.pending.style = { ...state.pending.style, [key]: value };
          paint();
          renderRibbon();
        }
        return;
      }
      if (!multi) {
        updateAnnotation(mark => { mark.style = { ...mark.style, [key]: value }; });
        renderRibbon();
        return;
      }
      remember();
      for (const mark of rowsSelected) mark.style = { ...mark.style, [key]: value };
      ensureV2();
      changed();
      paint();
      renderRibbon();
    };
    const applyFill = value => {
      settings.pattern = value;
      if (!rowsSelected.length) {
        if (state.pending) {
          state.pending.style = { ...state.pending.style, pattern: value };
          paint();
          renderRibbon();
        }
        return;
      }
      if (!multi) {
        updateAnnotation(mark => { mark.style = { ...mark.style, pattern: value }; });
        renderRibbon();
        return;
      }
      const targets = rowsSelected.filter(mark => CLOSED.has(mark.shape));
      if (!targets.length) return;
      remember();
      for (const mark of targets) mark.style = { ...mark.style, pattern: value };
      ensureV2();
      changed();
      paint();
      renderRibbon();
    };
    const shapeControl = select('Formă', multi ? [['', 'Diverse'], ...Object.entries(SHAPES)] : Object.entries(SHAPES), multi ? '' : shape, value => {
      if (!value) return;
      if (row) updateAnnotation(mark => {
        const replacement = convertAnnotationShape(mark, value);
        item.annotations[item.annotations.indexOf(mark)] = replacement;
      }, { reselection: true });
      else { settings.shape = value; setTool('draw'); renderRibbon(); }
    });
    shapeControl.disabled = multi;
    const currentColour = row ? markColour(row) : state.pending ? markColour(state.pending) : settings.color;
    const applyColour = value => {
      if (!rowsSelected.length) {
        settings.color = value;
        if (state.pending) {
          const colour = value === 'auto' ? autoColour(item.annotations, state.imageId) : value;
          state.pending.style = { ...state.pending.style, color: colour };
          paint();
        }
        renderRibbon();
        return;
      }
      if (multi) return;
      if (value === 'auto') {
        updateAnnotation(mark => {
          mark.style = { ...mark.style, color: autoColour(item.annotations.filter(candidate => candidate !== mark), mark.imageId) };
        }, { reselection: true });
      } else {
        updateAnnotation(mark => { mark.style = { ...mark.style, color: value }; }, { reselection: true });
      }
    };
    const pickColour = String(settings.color ?? 'auto').toLowerCase();
    const faceColour = pickColour === 'auto' ? 'auto' : String(currentColour).toLowerCase();
    const colourLabel = value => {
      if (value === 'auto') return 'Culoare automată';
      const index = MARK_PALETTE.indexOf(value);
      return index === -1 ? `Culoare personalizată ${value}` : `Culoare ${index + 1}`;
    };
    const colourFace = value => {
      if (value === 'auto') return wheelBadge();
      const face = el('span', { class: 'studio-colour-fill', 'aria-hidden': 'true' });
      face.style.backgroundColor = value;
      return face;
    };
    const openColourPicker = () => {
      let dialog;
      const close = () => {
        dialog.close();
        ribbonBody.querySelector('.studio-colour-trigger')?.focus();
      };
      const option = (value, label) => {
        const active = value === pickColour;
        const node = el('button', { type: 'button', class: `studio-colour-option${active ? ' active' : ''}`,
          'aria-label': label, 'aria-pressed': String(active), title: label });
        node.append(colourFace(value));
        if (value === 'auto') node.append(el('span', {}, 'Automată'));
        node.addEventListener('click', () => { applyColour(value); close(); });
        return node;
      };
      const custom = el('input', { type: 'color', value: pickColour === 'auto' ? MARK_PALETTE[0] : pickColour,
        'aria-label': 'Culoare personalizată', onchange: event => { applyColour(event.target.value); close(); } });
      const customActive = pickColour !== 'auto' && !MARK_PALETTE.includes(pickColour);
      dialog = modal('Culoare', el('div', { class: 'studio-colour-picker' },
        option('auto', 'Culoare automată'),
        el('div', { class: 'studio-colour-grid', role: 'group', 'aria-label': 'Paletă de culori' },
          ...MARK_PALETTE.map((colour, index) => option(colour, `Culoare ${index + 1}`))),
        el('label', { class: `studio-colour-custom${customActive ? ' active' : ''}` }, el('span', {}, 'Culoare personalizată'), custom)),
      [button('Închide', () => close(), 'button secondary')]);
    };
    const colourTrigger = el('button', { type: 'button', class: 'studio-colour-trigger', disabled: multi, onclick: openColourPicker,
      'aria-label': `${colourLabel(faceColour)}. Deschide paleta de culori`, 'aria-haspopup': 'dialog',
      title: colourLabel(faceColour) }, colourFace(faceColour));
    const colourControl = el('div', { class: 'studio-ribbon-control studio-colour-control' }, el('span', {}, 'Culoare'), colourTrigger);
    const fill = select('Umplere', multi ? [['', 'Diverse'], ...Object.entries(FILLS)] : Object.entries(FILLS),
      multi ? (commonValue('pattern') ?? '') : (values.pattern || 'none'), value => { if (value) applyFill(value); });
    fill.disabled = multi ? !rowsSelected.some(mark => CLOSED.has(mark.shape)) : !CLOSED.has(shape);
    const line = select('Stil linie', multi ? [['', 'Diverse'], ...LINE_STYLES.map(id => [id, LINES[id]])] : LINE_STYLES.map(id => [id, LINES[id]]),
      multi ? (commonValue('line') ?? '') : (values.line || 'solid'), value => { if (value) applyStyle('line', value); });
    const width = el('input', { type: 'number', class: 'studio-control studio-line-width', min: MIN_LINE_WIDTH, max: MAX_LINE_WIDTH, step: '.1',
      value: multi ? (commonValue('width') ?? '') : (values.width || DEFAULT_LINE_WIDTH), placeholder: multi ? 'Diverse' : '', 'aria-label': 'Grosime (px)', onchange: event => {
        if (!event.target.value) return;
        const next = clamp(event.target.valueAsNumber || DEFAULT_LINE_WIDTH, MIN_LINE_WIDTH, MAX_LINE_WIDTH);
        event.target.value = next;
        applyStyle('width', next);
      } });
    const attrs = el('div', { class: 'studio-ribbon-group', role: 'group', 'aria-label': 'Aspect' }, colourControl,
      control('Grosime (px)', width), control('Stil linie', line), control('Umplere', fill));
    toolControls = null;
    if (row) {
      const options = el('div', { class: 'studio-ribbon-group', role: 'group', 'aria-label': 'Reper selectat' }, control('Formă', shapeControl),
        button('Redesenează', () => startRedraw(row), 'chip', { disabled: Boolean(state.pending) }),
        button('Șterge reperul', removeMark, 'chip studio-delete-mark'));
      ribbonBody.replaceChildren(options, attrs);
      return;
    }
    if (multi) {
      const options = el('div', { class: 'studio-ribbon-group', role: 'group', 'aria-label': 'Repere selectate' },
        el('span', { class: 'studio-selection-count' }, `${rowsSelected.length} repere selectate`),
        button('Șterge reperele', removeMark, 'chip studio-delete-mark'));
      ribbonBody.replaceChildren(options, attrs);
      return;
    }
    toolControls = el('div', { class: 'studio-edit-mode', role: 'group', 'aria-label': 'Mod de editare' },
      ...[['draw', 'Desenează'], ['select', 'Selectează']].map(([id, text]) => button(text, () => setTool(id), 'chip', { 'data-tool': id })));
    const editOptions = el('div', { class: 'studio-ribbon-group', role: 'group', 'aria-label': 'Instrument' }, toolControls, control('Formă', shapeControl),
      button('Coordonate', openCoordinates, 'chip', { disabled: Boolean(state.pending) }));
    const images = el('div', { class: 'studio-ribbon-group', role: 'group', 'aria-label': 'Imagini' },
      button('Adaugă imagine', () => onUpload('primary'), 'chip'), button('Comparații', openComparisons, 'chip'));
    ribbonBody.replaceChildren(editOptions, attrs, images);
    setTool(preferences.tool);
  }

  function relabel() {
    refreshLabels();
    for (const row of item.annotations) row.label = annotationLabels.get(row.id);
    item.annotations = ordered;
  }

  function removeMark() {
    const targets = selectedRows();
    if (!targets.length) return;
    const ids = new Set(targets.map(row => row.id));
    remember();
    item.annotations = item.annotations.filter(mark => !ids.has(mark.id));
    if (ids.has(redrawId)) redrawId = null;
    state.selectedIds = [];
    state.annotationId = null;
    state.ribbonTab = 'draw';
    relabel();
    changed();
    paint();
    renderRibbon();
  }

  function paintMarks() {
    svg.replaceChildren();
    marks.clear();
    const renderer = annotationRenderer(svg);
    const comparison = activeComparison();
    if (comparison && comparison.caseId !== item.id) return;
    const imageId = comparison?.imageId || state.imageId;
    for (const row of ordered.filter(row => row.imageId === imageId)) {
      const number = annotationLabels.get(row.id);
      const className = comparison ? 'studio-comparison-mark' : 'studio-workbench-mark';
      const node = renderer(row, { label: number, interactive: !comparison, className });
      svg.append(node);
      if (comparison) continue;
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `Reper ${number}: ${itemFor(row.itemId)?.text || SHAPES[row.shape]}`);
      node.addEventListener('click', () => { if (!suppressMarkClick) selectMark(row.id, 'image'); });
      node.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectMark(row.id, 'image');
      });
      marks.set(row.id, node);
    }
    if (!comparison && state.pending?.imageId === state.imageId) svg.append(renderer(state.pending, { className: 'studio-draft-mark' }));
  }

  function paintList() {
    const index = listBody.scrollTop;
    rows.clear();
    const group = state.groupId && itemFor(state.groupId);
    const data = group ? ordered.filter(row => row.itemId === group.id) : ordered;
    const groupHead = group ? el('div', { class: 'studio-mark-group-head' },
      el('strong', {}, group.text || 'Observație'), button('Toate reperele', () => { state.groupId = null; paintList(); syncSelection(); }, 'chip')) : null;
    const entries = data.map(row => {
      const number = annotationLabels.get(row.id);
      const text = itemFor(row.itemId)?.text || 'Observație fără text';
      const footer = item.images.length > 1 ? `${SHAPES[row.shape]} · Imaginea ${item.images.findIndex(image => image.id === row.imageId) + 1}` : SHAPES[row.shape];
      const checkbox = el('input', { type: 'checkbox', class: 'studio-mark-check', checked: selectedIdSet().has(row.id),
        'aria-label': `Selectează reperul ${number}`, onchange: event => toggleSelection(row.id, event.target.checked) });
      const option = button([swatch(row), el('span', { class: 'studio-mark-list-number' }, number),
        el('span', { class: 'studio-mark-list-label' }, el('strong', {}, text), el('small', {}, footer))], () => selectMark(row.id, 'list'), 'studio-mark-option',
      { 'aria-label': `Reper ${number}: ${text}` });
      const node = el('div', { class: 'studio-mark-row', 'data-mark-id': row.id }, checkbox, option);
      rows.set(row.id, { node, option, checkbox });
      return node;
    });
    list.replaceChildren(...(groupHead ? [groupHead] : []), ...entries);
    if (!entries.length) list.append(el('p', { class: 'studio-mark-empty' }, group ? 'Observația nu are repere.' : 'Desenează primul reper pe radiografie.'));
    if (state.pending) list.append(el('div', { class: 'studio-pending-row' }, swatch(state.pending), 'Reper în așteptarea legăturii'));
    listBody.scrollTop = index;
  }

  function paintObservationBadges() {
    for (const [id, { chips }] of observations) {
      const linked = ordered.filter(row => row.itemId === id);
      chips.replaceChildren(...linked.map(row => button([swatch(row), annotationLabels.get(row.id)], () => selectMark(row.id, 'observation'), 'studio-observation-chip',
        { 'aria-label': `Selectează reperul ${annotationLabels.get(row.id)}`, 'data-mark-id': row.id })));
      chips.hidden = !linked.length;
    }
  }

  function announceBinding() {
    const pending = Boolean(state.pending);
    const pinned = itemFor(state.preboundId);
    root.classList.toggle('awaiting-binding', pending);
    binding.hidden = !pending && !redrawId && !pinned;
    binding.classList.toggle('studio-bind-pending', pending);
    if (pending) binding.replaceChildren(el('span', {}, 'Alege o observație și apasă „Leagă reperul” înainte să desenezi din nou.'),
      button('Renunță la reper', cancelPending, 'chip'));
    else if (redrawId) binding.replaceChildren(el('span', {}, 'Desenează din nou forma reperului selectat.'),
      button('Anulează redesenarea', cancelRedraw, 'chip'));
    else if (pinned) binding.replaceChildren(el('span', {}, `Desenezi pentru ${pinned.text || 'observația selectată'}.`),
      button('Desenează fără legătură', () => { state.preboundId = null; syncSelection(); }, 'chip'));
    syncCursor();
  }

  function syncSelection() {
    const ids = selectedIdSet();
    const total = ordered?.length || 0;
    selectAll.checked = total > 0 && ids.size === total;
    selectAll.indeterminate = ids.size > 0 && ids.size < total;
    selectAll.disabled = total === 0;
    for (const row of ordered) {
      const select = ids.has(row.id);
      const mark = marks.get(row.id);
      if (mark) {
        mark.classList.toggle('is-selected', select);
        mark.setAttribute('aria-pressed', String(select));
      }
      const entry = rows.get(row.id);
      if (entry) {
        entry.node.classList.toggle('is-selected', select);
        entry.option.classList.toggle('is-selected', select);
        entry.option.setAttribute('aria-pressed', String(select));
        entry.checkbox.checked = select;
      }
    }
    for (const [id, { select, bind, chips }] of observations) {
      const active = id === state.selectedObservationId;
      const pinned = id === state.preboundId;
      select.setAttribute('aria-pressed', String(active));
      select.classList.toggle('active', active);
      bind.setAttribute('aria-pressed', String(pinned));
      bind.classList.toggle('active', pinned || active);
      bind.textContent = state.pending ? 'Leagă reperul' : pinned ? 'Legată pentru desen' : 'Leagă înainte de desen';
      select.textContent = state.pending ? 'Alege observația' : 'Selectează observația';
      for (const chip of chips.children) {
        const selected = ids.has(chip.dataset.markId);
        chip.classList.toggle('is-selected', selected);
        chip.setAttribute('aria-pressed', String(Boolean(selected)));
      }
      select.closest('[data-observation-id]')?.classList.toggle('studio-linked-observation', active);
    }
    announceBinding();
    syncRibbon();
  }

  function paint() {
    refreshLabels();
    paintMarks();
    paintList();
    paintObservationBadges();
    syncSelection();
  }

  function focusObservation(id) {
    if (!observations.has(id)) return;
    if (collapsed.notes) setCollapsed('notes', false);
    scrollWithin(notes, observations.get(id).select.closest('[data-observation-id]') || observations.get(id).select);
  }

  function focusList(id) {
    if (!id) return;
    if (collapsed.marks) setCollapsed('marks', false);
    scrollWithin(listBody, rows.get(id)?.node);
  }

  function focusDrawing(row) {
    if (!row) return;
    const imageChanged = row.imageId !== state.imageId || Boolean(activeComparison());
    state.imageId = row.imageId;
    state.comparisonId = null;
    if (collapsed.image) setCollapsed('image', false);
    if (imageChanged) {
      refreshImage();
      paintMarks();
    }
    if (view.zoom === 1) return;
    const element = marks.get(row.id);
    if (!element) return;
    const bounds = stage.getBoundingClientRect(), box = element.getBoundingClientRect();
    if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom) {
      view.x += bounds.left + bounds.width / 2 - box.left - box.width / 2;
      view.y += bounds.top + bounds.height / 2 - box.top - box.height / 2;
      sizeCanvas();
    }
  }

  function selectMark(id, source) {
    const row = item.annotations.find(row => row.id === id);
    if (!row) return;
    if (state.groupId && state.groupId !== row.itemId) { state.groupId = null; paintList(); }
    if (redrawId !== id) redrawId = null;
    state.selectedIds = [id];
    state.annotationId = id;
    state.selectedObservationId = row.itemId;
    state.ribbonTab = 'selection';
    if (source !== 'image') focusDrawing(row);
    if (source !== 'list') focusList(id);
    if (source !== 'observation') focusObservation(row.itemId);
    syncSelection();
    renderRibbon();
  }

  function toggleSelection(id, checked) {
    const ids = new Set(state.selectedIds || []);
    if (checked) ids.add(id); else ids.delete(id);
    state.selectedIds = [...ids];
    state.annotationId = checked ? id : state.selectedIds.length === 1 ? state.selectedIds[0] : null;
    const row = item.annotations.find(candidate => candidate.id === state.annotationId);
    if (row) state.selectedObservationId = row.itemId;
    state.ribbonTab = state.selectedIds.length ? 'selection' : 'draw';
    syncSelection();
    renderRibbon();
  }

  function toggleAll(checked) {
    const ids = ordered.map(row => row.id);
    state.selectedIds = checked ? ids : [];
    state.annotationId = checked && ids.length === 1 ? ids[0] : null;
    state.ribbonTab = checked && ids.length ? 'selection' : 'draw';
    syncSelection();
    renderRibbon();
  }

  function selectObservation(id, group = false) {
    if (state.pending) { bindObservation(id); return; }
    redrawId = null;
    const related = ordered.filter(row => row.itemId === id);
    const row = related.find(row => row.imageId === state.imageId) || related[0];
    state.selectedObservationId = id;
    state.selectedIds = related.map(candidate => candidate.id);
    state.annotationId = group || related.length !== 1 ? null : row?.id || null;
    state.groupId = group ? id : null;
    state.ribbonTab = related.length ? 'selection' : 'draw';
    paintList();
    focusDrawing(row);
    focusList(row?.id);
    syncSelection();
    renderRibbon();
  }

  function bindObservation(id) {
    const row = state.pending;
    if (row) {
      state.pending = null;
      commitMark(row, id);
      return;
    }
    state.preboundId = state.preboundId === id ? null : id;
    selectObservation(id);
    if (state.preboundId) {
      state.ribbonTab = 'draw';
      preferences.tool = 'draw';
      if (collapsed.image) setCollapsed('image', false);
      switchImage(state.imageId);
    }
  }

  function observationControls(entry) {
    const select = button('Selectează observația', () => selectObservation(entry.id), 'chip studio-observation-select',
      { title: 'Dublu clic pentru a grupa reperele observației' });
    select.addEventListener('dblclick', event => { event.stopPropagation(); selectObservation(entry.id, true); });
    const bind = button('Leagă înainte de desen', () => bindObservation(entry.id), 'chip studio-observation-bind');
    const chips = el('div', { class: 'studio-observation-marks', 'aria-label': 'Repere legate', hidden: true });
    const group = button(icon('grid', 14), () => selectObservation(entry.id, true), 'chip studio-observation-group', { 'aria-label': 'Grupează reperele observației', title: 'Grupează reperele observației' });
    observations.set(entry.id, { select, bind, chips });
    return el('div', { class: 'studio-observation-controls' }, el('div', { class: 'studio-observation-actions' }, select, bind, group), chips);
  }

  function removeObservation(id) {
    if (state.selectedObservationId === id) {
      state.selectedObservationId = null;
      state.annotationId = null;
      state.selectedIds = [];
    }
    if (state.preboundId === id) state.preboundId = null;
    if (state.groupId === id) state.groupId = null;
  }

  function commitMark(row, itemId) {
    remember();
    item.annotations.push({ ...row, itemId });
    state.selectedIds = [row.id];
    state.annotationId = row.id;
    state.selectedObservationId = itemId;
    state.ribbonTab = 'selection';
    if (state.groupId !== itemId) state.groupId = null;
    relabel();
    ensureV2();
    changed();
    paint();
    renderRibbon();
  }

  function proposeMark(geometry, style) {
    const row = { ...geometry, style, id: uid('region'), imageId: state.imageId };
    if (itemFor(state.preboundId)) { commitMark(row, state.preboundId); return; }
    state.pending = row;
    if (collapsed.notes) setCollapsed('notes', false);
    paint();
    renderRibbon();
    try { if (localStorage.getItem(PROMPT_KEY)) return; } catch {}
    const hide = el('input', { type: 'checkbox' });
    hide.addEventListener('change', () => {
      try { if (hide.checked) localStorage.setItem(PROMPT_KEY, '1'); else localStorage.removeItem(PROMPT_KEY); } catch {}
    });
    const dialog = modal('Leagă reperul de o observație', el('div', { class: 'studio-binding-dialog' },
      el('p', {}, 'Alege observația corespunzătoare în panoul Observații. Poți continua desenul după ce legi reperul sau renunți la el.'),
      el('label', { class: 'studio-review-mark' }, hide, 'Nu mai afișa această explicație')),
    [button('Alege observația', () => dialog.close())]);
  }

  function cancelPending() {
    state.pending = null;
    paint();
    renderRibbon();
  }

  function startRedraw(row) {
    redrawId = row.id;
    focusDrawing(row);
    setTool('draw');
    announceBinding();
    stage.focus({ preventScroll: true });
  }

  function cancelRedraw() {
    redrawId = null;
    announceBinding();
  }

  function drawStyle(shape) {
    return { color: settings.color === 'auto' ? autoColour(item.annotations, state.imageId) : settings.color,
      pattern: CLOSED.has(shape) ? settings.pattern : 'none', width: settings.width, line: settings.line };
  }

  function openCoordinates() {
    if (state.pending) return;
    if (activeComparison()) setComparison(null);
    const values = [['X', '.40'], ['Y', '.40'], ['Lățime', '.10'], ['Înălțime', '.10']].map(([label, value]) =>
      [label, el('input', { type: 'number', class: 'studio-control', min: 0, max: 1, step: '.001', value })]);
    const dialog = modal('Adaugă o elipsă prin coordonate', el('div', { class: 'studio-coordinate-controls' }, ...values.map(([label, input]) => control(label, input))),
      [button('Adaugă elipsa', () => {
        const [x, y, w, h] = values.map(([, input]) => input.valueAsNumber);
        if (![x, y, w, h].every(number => Number.isFinite(number) && number >= 0) || !w || !h || x + w > 1 || y + h > 1) {
          toast('Completează coordonate între 0 și 1. Elipsa trebuie să încapă în imagine.', true);
          return;
        }
        dialog.close();
        proposeMark({ shape: 'ellipse', ...draftGeometry('ellipse', [x, y], [x + w, y + h]) }, drawStyle('ellipse'));
      })]);
  }

  function refreshImageSelect() {
    const entries = item.images.map((image, index) => [image.id, `${index + 1}. ${image.role === 'comparison' ? 'Comparație' : 'Principală'}`]);
    if (entries.length !== imageSelect.options.length || entries.some(([id, label], index) =>
      id !== imageSelect.options[index].value || label !== imageSelect.options[index].text)) {
      imageSelect.replaceChildren(...entries.map(([id, label]) => choice(id, label)));
    }
    imageSelect.value = state.imageId;
  }

  function refreshLayers() {
    const comparisons = (item.comparisons || []).filter(comparisonImage);
    if (!comparisons.some(row => row.id === state.comparisonId)) state.comparisonId = null;
    layerSelect.hidden = !comparisons.length;
    const entries = [['', 'Imaginea editată'], ...comparisons.map(row => [row.id, row.label])];
    if (entries.length !== layerSelect.options.length || entries.some(([id, label], index) =>
      id !== layerSelect.options[index].value || label !== layerSelect.options[index].text)) {
      layerSelect.replaceChildren(...entries.map(([id, label]) => choice(id, label)));
    }
    layerSelect.value = state.comparisonId ?? '';
  }

  function cycleLayer(offset) {
    const ids = [null, ...(item.comparisons || []).filter(comparisonImage).map(row => row.id)];
    if (ids.length === 1) return;
    setComparison(ids[(ids.indexOf(state.comparisonId ?? null) + offset + ids.length) % ids.length]);
  }

  function setComparison(value) {
    if (gesture) return;
    redrawId = null;
    state.comparisonId = value;
    refreshImage();
    paintMarks();
    syncSelection();
  }

  function switchImage(id, updateRibbon = true) {
    if (id !== state.imageId) redrawId = null;
    state.imageId = id;
    state.comparisonId = null;
    state.selectedIds = state.selectedIds.filter(markId => item.annotations.find(row => row.id === markId)?.imageId === id);
    if (!state.selectedIds.includes(state.annotationId)) {
      state.annotationId = state.selectedIds.length === 1 ? state.selectedIds[0] : null;
    }
    refreshImage();
    paintMarks();
    syncSelection();
    if (updateRibbon) renderRibbon();
  }

  function openComparisons() {
    const comparisonList = el('div', { class: 'studio-comparison-entries' });
    const caseSelect = select('Caz de comparație', pack.cases.map(row => [row.id, row.title]), item.id, refreshTargets);
    const imageSelect = select('Imagine de comparație', [], '', () => {});
    const label = el('input', { type: 'text', class: 'studio-control', placeholder: 'Ex. Aspect normal', maxlength: 120 });
    function refreshTargets() {
      const fromCase = pack.cases.find(row => row.id === caseSelect.value);
      const candidates = fromCase?.images.filter(image => fromCase.id !== item.id || image.id !== state.imageId) || [];
      imageSelect.replaceChildren(...candidates.map((image, index) => choice(image.id, `${index + 1}. ${image.role === 'comparison' ? 'Comparație' : 'Principală'}`)));
    }
    function refreshRows() {
      comparisonList.replaceChildren(...(item.comparisons || []).map(row => el('div', { class: 'studio-comparison-entry' },
        el('span', {}, row.label), button('Arată', () => { dialog.close(); setComparison(row.id); }, 'chip'),
        button(icon('close', 14), () => {
          remember();
          item.comparisons = item.comparisons.filter(candidate => candidate.id !== row.id);
          changed();
          if (state.comparisonId === row.id) setComparison(null);
          refreshLayers();
          refreshRows();
        }, 'chip', { 'aria-label': `Șterge comparația ${row.label}` }))));
    }
    function addComparison() {
      if (!imageSelect.value) { toast('Alege o imagine de comparație.', true); return; }
      const existing = item.comparisons || [];
      if (existing.length >= 8) { toast('Cazul are deja numărul maxim de comparații.', true); return; }
      if (existing.some(row => row.caseId === caseSelect.value && row.imageId === imageSelect.value)) {
        toast('Comparația există deja.', true);
        return;
      }
      remember();
      const row = { id: uid('comparison'), caseId: caseSelect.value, imageId: imageSelect.value, label: label.value.trim() || 'Comparație' };
      item.comparisons = [...existing, row];
      ensureV2();
      changed();
      setComparison(row.id);
      dialog.close();
    }
    const dialog = modal('Straturi de comparație', el('div', { class: 'studio-comparison-dialog' }, comparisonList,
      el('div', { class: 'studio-compare-fields' }, control('Caz', caseSelect), control('Imagine', imageSelect), control('Etichetă', label))), [
      button('Încarcă imagine de comparație', () => {
        if ((item.comparisons || []).length >= 8) { toast('Cazul are deja numărul maxim de comparații.', true); return; }
        dialog.close();
        onUpload('comparison');
      }, 'button secondary'), button('Adaugă comparația', addComparison),
    ]);
    refreshTargets();
    refreshRows();
  }

  function refreshImage() {
    refreshImageSelect();
    refreshLayers();
    const image = displayedImage();
    if (image?.path !== displayedPath) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const blob = image && files.get(image.path);
      objectUrl = blob ? URL.createObjectURL(blob) : null;
      displayedPath = image?.path;
      missing.hidden = Boolean(objectUrl);
      canvas.hidden = !objectUrl;
      if (objectUrl) picture.src = objectUrl;
      else picture.removeAttribute('src');
      resetView();
    }
    picture.alt = activeComparison() ? `Comparație: ${activeComparison().label}` : `Radiografie: ${item.title}`;
    svg.classList.toggle('studio-comparison-overlay', Boolean(activeComparison()));
    syncCursor();
  }

  function fitSize() {
    const image = displayedImage();
    if (!image || !stage.clientWidth || !stage.clientHeight) return [0, 0];
    const scale = Math.min(stage.clientWidth / image.width, stage.clientHeight / image.height) * view.zoom;
    return [image.width * scale, image.height * scale];
  }

  function sizeCanvas() {
    const [width, height] = fitSize();
    if (!width || !height) return;
    const xLimit = Math.max(0, (width - stage.clientWidth) / 2);
    const yLimit = Math.max(0, (height - stage.clientHeight) / 2);
    view.x = clamp(view.x, -xLimit, xLimit);
    view.y = clamp(view.y, -yLimit, yLimit);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.left = `${(stage.clientWidth - width) / 2 + view.x}px`;
    canvas.style.top = `${(stage.clientHeight - height) / 2 + view.y}px`;
    syncCursor();
  }

  function zoomTo(value, at = null) {
    const next = clamp(value, 1, 8);
    const ratio = next / view.zoom;
    const box = stage.getBoundingClientRect();
    const offsetX = at ? at.clientX - box.left - box.width / 2 : 0;
    const offsetY = at ? at.clientY - box.top - box.height / 2 : 0;
    view.x = offsetX + (view.x - offsetX) * ratio;
    view.y = offsetY + (view.y - offsetY) * ratio;
    view.zoom = next;
    zoomLabel.textContent = `${Math.round(next * 100)}%`;
    sizeCanvas();
  }

  function resetView() {
    view.x = 0;
    view.y = 0;
    zoomTo(1);
  }

  function syncCursor() {
    const pannable = view.zoom > 1;
    const handMode = preferences.tool === 'pan' || spaceHeld || Boolean(activeComparison());
    stage.classList.toggle('is-pannable', pannable && handMode);
    stage.classList.toggle('is-panning', gesture?.kind === 'pan');
    stage.classList.toggle('is-drawing', preferences.tool === 'draw' && !spaceHeld && !activeComparison() && !state.pending);
    selectTool.classList.toggle('active', preferences.tool === 'select');
    selectTool.setAttribute('aria-pressed', String(preferences.tool === 'select'));
    penTool.classList.toggle('active', preferences.tool === 'draw');
    penTool.setAttribute('aria-pressed', String(preferences.tool === 'draw'));
    panTool.classList.toggle('active', preferences.tool === 'pan');
    panTool.setAttribute('aria-pressed', String(preferences.tool === 'pan'));
  }

  function normalPoint(event, box) {
    const serial = value => Math.round(clamp(value, 0, 1) * 1e6) / 1e6;
    return [serial((event.clientX - box.left) / box.width), serial((event.clientY - box.top) / box.height)];
  }

  function updateGesture(event, final = false) {
    const points = gesture.points;
    const freehand = gesture.row.shape === 'polygon' || gesture.row.shape === 'polyline';
    const coalesced = freehand && !final ? event.getCoalescedEvents?.() : null;
    const events = coalesced?.length ? coalesced : [event];
    for (const sample of events) {
      const point = normalPoint(sample, gesture.box);
      const last = points.at(-1);
      const distance = Math.hypot((last[0] - point[0]) * gesture.box.width, (last[1] - point[1]) * gesture.box.height);
      if (freehand && distance >= (final ? .001 : 1.6)) points.push(point);
      Object.assign(gesture.row, draftGeometry(gesture.row.shape, gesture.start, point, points));
    }
    if (!frame && !final) frame = requestAnimationFrame(() => {
      frame = 0;
      if (gesture?.kind === 'draw' && liveMark) updateAnnotationGeometry(liveMark, gesture.row, { appendPoints: true });
    });
  }

  function clearGesture() {
    const id = gesture?.id;
    gesture = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    liveMark?.remove();
    liveMark = null;
    if (id !== undefined && stage.hasPointerCapture(id)) stage.releasePointerCapture(id);
    syncCursor();
  }

  stage.addEventListener('pointerdown', event => {
    if (gesture || !event.isPrimary || (event.button !== 0 && event.button !== 1) || !objectUrl) return;
    const onShape = event.target.closest?.('.studio-workbench-mark');
    const pan = preferences.tool === 'pan' || spaceHeld || event.button === 1 || Boolean(activeComparison());
    if (pan && view.zoom > 1) {
      gesture = { kind: 'pan', id: event.pointerId, x: event.clientX, y: event.clientY, baseX: view.x, baseY: view.y };
    } else {
      if (pan || (onShape && !redrawId) || preferences.tool !== 'draw' || !canvas.contains(event.target)) return;
      if (state.pending) { toast('Leagă mai întâi reperul de o observație.'); return; }
      const box = canvas.getBoundingClientRect();
      const redraw = redrawId && selected()?.id === redrawId ? selected() : null;
      const start = normalPoint(event, box), shape = redraw?.shape || settings.shape, points = [start];
      const row = { shape, id: 'drawing-preview', style: redraw ? redraw.style : drawStyle(shape), ...draftGeometry(shape, start, start, points) };
      gesture = { kind: 'draw', id: event.pointerId, box, start, points, row };
      liveMark = annotationRenderer(svg)(row, { className: 'studio-draft-mark' });
      svg.append(liveMark);
    }
    stage.setPointerCapture(event.pointerId);
    stage.focus({ preventScroll: true });
    syncCursor();
    event.preventDefault();
  });
  stage.addEventListener('pointermove', event => {
    if (gesture?.id !== event.pointerId) return;
    if (gesture.kind === 'pan') {
      view.x = gesture.baseX + event.clientX - gesture.x;
      view.y = gesture.baseY + event.clientY - gesture.y;
      sizeCanvas();
    } else updateGesture(event);
  });
  stage.addEventListener('pointerup', event => {
    if (gesture?.id !== event.pointerId) return;
    if (gesture.kind !== 'draw') { clearGesture(); return; }
    updateGesture(event, true);
    const { row, box } = gesture;
    clearGesture();
    if (validGeometry(row, box)) {
      const { id, style, ...geometry } = row;
      suppressMarkClick = true;
      setTimeout(() => { suppressMarkClick = false; }, 0);
      if (redrawId) {
        redrawId = null;
        updateAnnotation(mark => {
          const replacement = { ...geometry, id: mark.id, imageId: mark.imageId, itemId: mark.itemId,
            label: mark.label, ...(mark.style ? { style: mark.style } : {}) };
          item.annotations[item.annotations.indexOf(mark)] = replacement;
        }, { reselection: true });
      } else proposeMark(geometry, style);
    }
  });
  stage.addEventListener('pointercancel', clearGesture);
  stage.addEventListener('lostpointercapture', clearGesture);
  stage.addEventListener('wheel', event => {
    if (gesture || !event.deltaY) return;
    event.preventDefault();
    zoomTo(view.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event);
  }, { passive: false });
  imageBody.addEventListener('keydown', event => {
    if (event.key === '[' || event.key === ']') {
      cycleLayer(event.key === '[' ? -1 : 1);
      event.preventDefault();
    }
    if (event.target !== stage) return;
    if (event.key === ' ') { spaceHeld = true; syncCursor(); event.preventDefault(); }
    if (event.key === 'Escape' && (gesture || redrawId)) { clearGesture(); cancelRedraw(); event.preventDefault(); }
    if (event.key === '+' || event.key === '-') {
      zoomTo(view.zoom * (event.key === '+' ? 1.25 : 1 / 1.25));
      event.preventDefault();
    }
  });
  const releaseSpace = () => { spaceHeld = false; syncCursor(); };
  stage.addEventListener('keyup', event => { if (event.key === ' ') releaseSpace(); });
  stage.addEventListener('blur', releaseSpace);
  picture.addEventListener('error', () => { missing.hidden = false; });

  let marquee = null, suppressListClick = false;
  function startMarquee(event) {
    if (event.button !== 0 || event.target.closest('input')) return;
    marquee = { x: event.clientX, y: event.clientY, pointerId: event.pointerId,
      base: new Set(state.selectedIds || []), additive: event.ctrlKey || event.metaKey || event.shiftKey, active: false, node: null };
  }
  function updateMarquee(event) {
    if (!marquee || event.pointerId !== marquee.pointerId) return;
    if (!marquee.active && Math.hypot(event.clientX - marquee.x, event.clientY - marquee.y) < 5) return;
    if (!marquee.active) {
      marquee.active = true;
      marquee.node = el('div', { class: 'studio-marquee' });
      document.body.append(marquee.node);
      list.classList.add('is-marquee');
    }
    event.preventDefault();
    const left = Math.min(marquee.x, event.clientX), top = Math.min(marquee.y, event.clientY);
    const right = Math.max(marquee.x, event.clientX), bottom = Math.max(marquee.y, event.clientY);
    marquee.node.style.cssText = `left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px`;
    const ids = new Set(marquee.additive ? marquee.base : []);
    for (const [id, entry] of rows) {
      const box = entry.node.getBoundingClientRect();
      if (box.bottom >= top && box.top <= bottom && box.right >= left && box.left <= right) ids.add(id);
    }
    state.selectedIds = [...ids];
    state.annotationId = ids.size === 1 ? [...ids][0] : null;
    state.ribbonTab = state.selectedIds.length ? 'selection' : 'draw';
    syncSelection();
  }
  function endMarquee(event) {
    if (!marquee || (event && event.pointerId !== marquee.pointerId)) return;
    const active = marquee.active;
    marquee.node?.remove();
    list.classList.remove('is-marquee');
    marquee = null;
    if (active) {
      suppressListClick = true;
      setTimeout(() => { suppressListClick = false; }, 0);
      renderRibbon();
    } else syncSelection();
  }
  list.addEventListener('pointerdown', startMarquee);
  list.addEventListener('click', event => {
    if (!suppressListClick) return;
    suppressListClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  window.addEventListener('pointermove', updateMarquee);
  window.addEventListener('pointerup', endMarquee);
  window.addEventListener('pointercancel', endMarquee);

  const noteContent = renderNotes({ observationControls, bindObservation, removeObservation });
  if (noteContent) notes.append(noteContent);
  notes.addEventListener('input', event => {
    const row = event.target.closest('textarea')?.closest('[data-observation-id]');
    if (!row) return;
    const id = row.dataset.observationId;
    const observation = itemFor(id);
    for (const annotation of ordered.filter(entry => entry.itemId === id)) {
      const number = annotationLabels.get(annotation.id);
      marks.get(annotation.id)?.setAttribute('aria-label', `Reper ${number}: ${observation.text || SHAPES[annotation.shape]}`);
    }
    paintList();
    syncSelection();
  });
  notes.addEventListener('click', event => {
    if (event.target.closest('button, input, textarea, select, label, a')) return;
    const row = event.target.closest('[data-observation-id]');
    if (row) selectObservation(row.dataset.observationId);
  });
  notes.addEventListener('dblclick', event => {
    if (event.target.closest('button, input, select, label, a')) return;
    const row = event.target.closest('[data-observation-id]');
    if (row) selectObservation(row.dataset.observationId, true);
  });
  const observer = new ResizeObserver(sizeCanvas);
  observer.observe(stage);
  syncPaneSizes();
  refreshImage();
  paint();
  renderRibbon();
  listBody.addEventListener('scroll', () => { state.listScroll = listBody.scrollTop; });
  notes.addEventListener('scroll', () => { state.notesScroll = notes.scrollTop; });

  return {
    node: root,
    restoreScroll() { listBody.scrollTop = state.listScroll || 0; notes.scrollTop = state.notesScroll || 0; },
    destroy() {
      if (!listBody.hidden) state.listScroll = listBody.scrollTop;
      if (!notes.hidden) state.notesScroll = notes.scrollTop;
      observer.disconnect();
      clearGesture();
      marquee?.node?.remove();
      window.removeEventListener('pointermove', updateMarquee);
      window.removeEventListener('pointerup', endMarquee);
      window.removeEventListener('pointercancel', endMarquee);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
  };
}
