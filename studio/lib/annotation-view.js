import { SECTION_LABELS } from './core.js';
import { nonCollinear } from './schema.js';
export { LINE_STYLES, MAX_LINE_WIDTH, MIN_LINE_WIDTH } from './schema.js';

let rendererNumber = 0;

export const MARK_PALETTE = Object.freeze([
  '#ffb000', '#00d4ff', '#ff4fd8', '#9dff3d', '#b58cff', '#ff7a18', '#3dffc0', '#ff4d5e',
]);
export const DEFAULT_LINE_WIDTH = 2.6;

const DEFAULT_COLOUR = '#e8c777';
const CLOSED = new Set(['ellipse', 'rect', 'polygon']);
const NS = 'http://www.w3.org/2000/svg';
const LABEL_GRID = 64;
const LABEL_DIRECTIONS = Array.from({ length: 16 }, (_, index) => {
  const angle = index * Math.PI / 8;
  return [Math.cos(angle), Math.sin(angle)];
});

function rgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function distance(a, b) {
  const [ar, ag, ab] = rgb(a), [br, bg, bb] = rgb(b);
  return Math.sqrt((ar - br) ** 2 * .3 + (ag - bg) ** 2 * .59 + (ab - bb) ** 2 * .11);
}

export function markColour(row) {
  return row?.style?.color || DEFAULT_COLOUR;
}

export function annotationsInObservationOrder(caseData) {
  const sections = caseData.sections || [];
  const byId = new Map(sections.map(section => [section.id, section]));
  const itemIds = [...Object.keys(SECTION_LABELS).map(id => byId.get(id)).filter(Boolean),
    ...sections.filter(section => !Object.hasOwn(SECTION_LABELS, section.id))].flatMap(section => section.items.map(item => item.id));
  const order = new Map(itemIds.map((id, index) => [id, index]));
  return [...(caseData.annotations || [])].sort((a, b) => (order.get(a.itemId) ?? Infinity) - (order.get(b.itemId) ?? Infinity));
}

export function annotationNumbers(caseData) {
  return new Map(annotationsInObservationOrder(caseData).map((row, index) => [row.id, String(index + 1)]));
}

export function autoColour(annotations = [], imageId = null) {
  const rows = annotations.filter(row => row.imageId === imageId);
  const counts = new Map(MARK_PALETTE.map(colour => [colour, 0]));
  for (const row of rows) {
    const colour = markColour(row);
    if (counts.has(colour)) counts.set(colour, counts.get(colour) + 1);
  }
  const unused = MARK_PALETTE.filter(colour => counts.get(colour) === 0);
  if (!unused.length) {
    const least = Math.min(...MARK_PALETTE.map(colour => counts.get(colour)));
    return MARK_PALETTE.find(colour => counts.get(colour) === least);
  }
  if (!rows.length) return MARK_PALETTE[0];
  const used = rows.map(row => markColour(row));
  let best = unused[0], score = -1;
  for (const colour of unused) {
    const minimum = Math.min(...used.map(other => distance(colour, other)));
    if (minimum > score) { best = colour; score = minimum; }
  }
  return best;
}

function node(name) { return document.createElementNS(NS, name); }

function geometryPoints(row) {
  if (row.shape === 'ellipse') {
    return Array.from({length: 40}, (_, index) => {
      const angle = index * Math.PI / 20;
      return [row.cx + Math.cos(angle) * row.rx, row.cy + Math.sin(angle) * row.ry];
    });
  }
  if (row.shape === 'rect') return [[row.x, row.y], [row.x + row.width, row.y], [row.x + row.width, row.y + row.height], [row.x, row.y + row.height]];
  if (row.shape === 'arrow') return [[row.x1, row.y1], [row.x2, row.y2]];
  return row.points;
}

function minimumSpan(min, max) {
  if (max - min >= .01) return [min, max];
  const start = Math.max(0, Math.min(.99, (min + max) / 2 - .005));
  return [start, start + .01];
}

export function convertAnnotationShape(row, shape) {
  if (row.shape === shape) return row;
  const outline = geometryPoints(row).map(point => point.map(value => Math.max(0, Math.min(1, value))));
  const bounds = outline.reduce(([left, top, right, bottom], [px, py]) =>
    [Math.min(left, px), Math.min(top, py), Math.max(right, px), Math.max(bottom, py)], [1, 1, 0, 0]);
  const [left, right] = minimumSpan(bounds[0], bounds[2]);
  const [top, bottom] = minimumSpan(bounds[1], bounds[3]);
  const converted = {...row, shape};
  for (const key of ['cx', 'cy', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'points']) delete converted[key];
  if (converted.style && !CLOSED.has(shape)) converted.style = {...converted.style, pattern: 'none'};
  if (shape === 'ellipse') return {...converted, cx: (left + right) / 2, cy: (top + bottom) / 2, rx: (right - left) / 2, ry: (bottom - top) / 2};
  if (shape === 'rect') return {...converted, x: left, y: top, width: right - left, height: bottom - top};
  if (shape === 'arrow') {
    const [start, end] = row.shape === 'polyline' && Math.hypot(outline[0][0] - outline.at(-1)[0], outline[0][1] - outline.at(-1)[1]) >= .01
      ? [outline[0], outline.at(-1)] : [[left, top], [right, bottom]];
    return {...converted, x1: start[0], y1: start[1], x2: end[0], y2: end[1]};
  }
  if (shape === 'polygon' && !nonCollinear(outline)) return {...converted, points: [[left, top], [right, top], [right, bottom], [left, bottom]]};
  if (shape === 'polyline') {
    if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) return {...converted, points: [[left, top], [right, bottom]]};
    if (CLOSED.has(row.shape)) outline.push(outline[0]);
  }
  return {...converted, points: outline};
}

function anchor(row) {
  if (row.shape === 'ellipse') return [row.cx * 1000, (row.cy - row.ry) * 1000];
  if (row.shape === 'rect') return [row.x * 1000, row.y * 1000];
  if (row.shape === 'arrow') return [row.x1 * 1000, row.y1 * 1000];
  return row.points[0].map(value => value * 1000);
}

function segmentDistanceSquared(x, y, segment) {
  const { x1, y1, dx, dy, lengthSquared } = segment;
  const fraction = lengthSquared ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared)) : 0;
  return (x - x1 - fraction * dx) ** 2 + (y - y1 - fraction * dy) ** 2;
}

export function annotationLabelPositions(entries, width, height, { neutral = false } = {}) {
  if (!entries.length || !width || !height) return [];
  const cells = new Map();
  const pixel = 1000 / Math.min(width, height);
  const lastCell = Math.floor(1000 / LABEL_GRID);
  const cell = n => Math.max(0, Math.min(lastCell, Math.floor(n / LABEL_GRID)));
  function indexSegment(x1, y1, x2, y2, padding) {
    const dx = x2 - x1, dy = y2 - y1;
    const segment = { x1, y1, dx, dy, lengthSquared: dx ** 2 + dy ** 2, padding };
    const left = cell(Math.min(x1, x2) - padding), right = cell(Math.max(x1, x2) + padding);
    const top = cell(Math.min(y1, y2) - padding), bottom = cell(Math.max(y1, y2) + padding);
    for (let cy = top; cy <= bottom; cy++) {
      for (let cx = left; cx <= right; cx++) {
        // Skip cells that are inside the bounds of a long diagonal but away from the line.
        if (segmentDistanceSquared((cx + .5) * LABEL_GRID, (cy + .5) * LABEL_GRID, segment) > (padding + LABEL_GRID / Math.SQRT2) ** 2) continue;
        const key = cx + cy * (lastCell + 1);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(segment);
      }
    }
  }

  for (const { row } of entries) {
    const points = geometryPoints(row);
    const { strokeWidth } = strokeMetrics(row, neutral);
    const padding = (strokeWidth / 2 + 4) * pixel + (row.shape === 'ellipse' ? 2 : 0);
    const end = CLOSED.has(row.shape) ? points.length : points.length - 1;
    for (let index = 0; index < end; index++) {
      const [x1, y1] = points[index], [x2, y2] = points[(index + 1) % points.length];
      indexSegment(x1 * 1000, y1 * 1000, x2 * 1000, y2 * 1000, padding);
    }
    if (row.shape === 'arrow') {
      const tipX = row.x2 * 1000, tipY = row.y2 * 1000;
      indexSegment(tipX, tipY, tipX, tipY, Math.max(22, (7 * Math.sqrt(DEFAULT_LINE_WIDTH * strokeWidth) + 3) * pixel));
    }
  }

  return entries.map(({ row, radius = 24 }) => {
    if (!radius) return null;
    const [ax, ay] = anchor(row);
    const margin = radius + 3;
    const within = n => Math.max(margin, Math.min(1000 - margin, n));
    let best = [within(ax), within(ay)], fewest = Infinity;
    const tested = new Set();
    function tryPosition(x, y) {
      const px = Math.round(within(x)), py = Math.round(within(y));
      const key = px + 1001 * py;
      if (tested.has(key)) return false;
      tested.add(key);
      const nearby = new Set();
      for (let cy = cell(py - margin); cy <= cell(py + margin); cy++) {
        for (let cx = cell(px - margin); cx <= cell(px + margin); cx++) {
          for (const segment of cells.get(cx + cy * (lastCell + 1)) || []) nearby.add(segment);
        }
      }
      let overlaps = 0;
      for (const segment of nearby) {
        if (segmentDistanceSquared(px, py, segment) < (margin + segment.padding) ** 2) overlaps++;
        if (overlaps >= fewest) return false;
      }
      best = [px, py];
      fewest = overlaps;
      return !overlaps;
    }
    // Prefer a position beside the mark. Widen the search only in crowded areas.
    for (let distance = margin; distance <= 170 && fewest; distance += 16) {
      for (const [dx, dy] of LABEL_DIRECTIONS) {
        if (tryPosition(ax + dx * distance, ay + dy * distance)) break;
      }
    }
    if (fewest) {
      const interior = [];
      for (let y = margin; y <= 1000 - margin; y += 28) {
        for (let x = margin; x <= 1000 - margin; x += 28) interior.push([x, y, (x - ax) ** 2 + (y - ay) ** 2]);
      }
      interior.sort((a, b) => a[2] - b[2]);
      interior.some(([x, y]) => tryPosition(x, y));
    }
    indexSegment(...best, ...best, radius + 2);
    return best;
  });
}

export function placeAnnotationLabels(entries, width, height, options) {
  const labels = entries.map(({ node }) => node.querySelector('.annotation-number'));
  const positions = annotationLabelPositions(entries.map(({ row }, index) => ({
    row, radius: Number(labels[index]?.getAttribute('r')) || 0,
  })), width, height, options);
  for (const [index, position] of positions.entries()) {
    if (!position) continue;
    const [x, y] = position;
    setLabelPosition(labels[index], x, y, entries[index].row);
  }
}

export function raiseAnnotations(nodes, isSelected) {
  if (!nodes.length) return;
  const active = new Set(nodes.filter(isSelected));
  const parent = nodes[0].parentNode;
  const focused = document.activeElement;
  let next = null;
  const order = [...nodes.filter(node => !active.has(node)), ...active];
  for (const node of order.reverse()) {
    if (node.nextSibling !== next) {
      if (typeof parent.moveBefore === 'function') parent.moveBefore(node, next);
      else parent.insertBefore(node, next);
    }
    next = node;
  }
  if (focused !== document.activeElement && nodes.includes(focused)) focused.focus({ preventScroll: true });
}

function points(row) { return row.points.map(point => point.map(value => value * 1000).join(',')).join(' '); }

function patternNode(svg, colour, pattern, id) {
  const existing = svg.querySelector(`#${id}`);
  if (existing) return;
  const tile = 12, defs = svg.querySelector('defs') || svg.appendChild(node('defs'));
  const fill = node('pattern');
  for (const [key, value] of Object.entries({ id, width: tile, height: tile, patternUnits: 'userSpaceOnUse' })) fill.setAttribute(key, value);
  const add = (tag, attrs) => { const shape = node(tag); for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value); fill.append(shape); };
  const stroke = { stroke: colour, 'stroke-width': 1.4, opacity: .55 };
  if (pattern === 'diagonal') add('path', { d: 'M0 12L12 0', fill: 'none', ...stroke });
  if (pattern === 'dots') add('circle', { cx: 3, cy: 3, r: 1.2, fill: colour, opacity: .55 });
  if (pattern === 'vertical') add('path', { d: 'M6 0V12', fill: 'none', ...stroke });
  if (pattern === 'horizontal') add('path', { d: 'M0 6H12', fill: 'none', ...stroke });
  defs.append(fill);
}

function markerNode(svg, colour, prefix, strokeWidth) {
  const id = `${prefix}-arrow-${colour.replace('#', '')}-${String(strokeWidth).replace('.', '-')}`;
  if (svg.querySelector(`#${id}`)) return id;
  const defs = svg.querySelector('defs') || svg.appendChild(node('defs'));
  const marker = node('marker');
  const size = 7 * Math.sqrt(DEFAULT_LINE_WIDTH / strokeWidth);
  for (const [key, value] of Object.entries({ id, viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: size, markerHeight: size, orient: 'auto-start-reverse' })) marker.setAttribute(key, value);
  const head = node('path');
  head.setAttribute('d', 'M0 0L8 4L0 8L2 4Z'); head.setAttribute('fill', colour); marker.append(head); defs.append(marker);
  return id;
}

function geometry(row) {
  if (row.shape === 'ellipse') return ['ellipse', { cx: row.cx * 1000, cy: row.cy * 1000, rx: row.rx * 1000, ry: row.ry * 1000 }];
  if (row.shape === 'rect') return ['rect', { x: row.x * 1000, y: row.y * 1000, width: row.width * 1000, height: row.height * 1000 }];
  if (row.shape === 'arrow') return ['line', { x1: row.x1 * 1000, y1: row.y1 * 1000, x2: row.x2 * 1000, y2: row.y2 * 1000 }];
  if (row.shape === 'polyline') return ['polyline', { points: points(row) }];
  return ['polygon', { points: points(row) }];
}

function attributes(element, values) {
  for (const [key, value] of Object.entries(values)) element.setAttribute(key, value);
}

function setLabelPosition(label, x, y, row) {
  const [x1, y1] = anchor(row);
  const leader = label.previousElementSibling;
  attributes(leader, { x1, y1, x2: x, y2: y });
  leader.classList.toggle('annotation-leader-offset', Math.hypot(x - x1, y - y1) > 80);
  attributes(label, { cx: x, cy: y });
  attributes(label.nextElementSibling, { x, y: y + 8 });
}

export function updateAnnotationGeometry(group, row, {appendPoints = false} = {}) {
  const svg = group.ownerSVGElement;
  if (appendPoints && row.points && svg?.createSVGPoint) {
    for (const child of group.children) {
      if (child.localName !== row.shape) continue;
      for (let index = child.points.numberOfItems; index < row.points.length; index++) {
        const point = svg.createSVGPoint();
        point.x = row.points[index][0] * 1000;
        point.y = row.points[index][1] * 1000;
        child.points.appendItem(point);
      }
    }
  } else {
    const [tag, attrs] = geometry(row);
    for (const child of group.children) if (child.localName === tag) attributes(child, attrs);
  }
  const label = group.querySelector('.annotation-number');
  if (label) setLabelPosition(label, ...anchor(row), row);
}

function dashArray(line, width) {
  if (line === 'dotted') return `0 ${width * 2.5}`;
  if (line === 'dashed') return `${width * 3} ${width * 2}`;
  if (line === 'dash-dot') return `${width * 3} ${width * 2} 0 ${width * 2}`;
  return null;
}

function strokeMetrics(row, neutral) {
  const line = neutral ? 'solid' : row.style?.line || 'solid';
  const width = neutral ? DEFAULT_LINE_WIDTH : row.style?.width ?? DEFAULT_LINE_WIDTH;
  const separation = line === 'double' ? Math.max(1.5, width * .55) : 0;
  const strokeWidth = line === 'double' ? width * 2 + separation : width;
  return { line, width, separation, strokeWidth };
}

export function annotationRenderer(svg, { prefix = `marks-${++rendererNumber}`, neutral = false } = {}) {
  return function draw(row, { label = '', className = 'annotation', interactive = false } = {}) {
    const colour = neutral ? DEFAULT_COLOUR : markColour(row);
    const pattern = neutral ? 'none' : row.style?.pattern || 'none';
    const { line, width, separation, strokeWidth } = strokeMetrics(row, neutral);
    const dashes = dashArray(line, width);
    const group = node('g');
    group.setAttribute('class', className);
    if (row.id) group.dataset.annotationId = row.id;
    const [tag, attrs] = geometry(row);
    const patternId = `${prefix}-pattern-${pattern}-${colour.replace('#', '')}`;
    function add(className, options) {
      const shape = node(tag);
      attributes(shape, { ...attrs, class: className, fill: 'none', 'vector-effect': 'non-scaling-stroke',
        'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'pointer-events': 'none', ...options });
      group.append(shape);
      return shape;
    }
    if (CLOSED.has(row.shape) && pattern !== 'none') {
      patternNode(svg, colour, pattern, patternId);
      add('annotation-fill', { fill: `url(#${patternId})` });
    }
    const dashOptions = dashes ? {'stroke-dasharray': dashes} : {};
    add('annotation-backdrop', { stroke: '#0a0e10', 'stroke-opacity': '.8', 'stroke-width': strokeWidth + 2.9, ...dashOptions });
    const stroke = add('annotation-stroke', { stroke: colour, 'stroke-width': strokeWidth, ...dashOptions });
    if (separation) add('annotation-center', { stroke: '#0a0e10', 'stroke-width': separation });
    if (row.shape === 'arrow') stroke.setAttribute('marker-end', `url(#${markerNode(svg, colour, prefix, strokeWidth)})`);
    if (interactive) add('annotation-hit', { stroke: 'transparent', 'stroke-width': Math.max(16, strokeWidth + 7), 'pointer-events': 'stroke' });
    if (label) {
      const [x, y] = anchor(row);
      const leader = node('line');
      attributes(leader, { class: 'annotation-leader', x1: x, y1: y, x2: x, y2: y, 'pointer-events': 'none',
        'vector-effect': 'non-scaling-stroke', stroke: colour, 'stroke-width': 1.5, 'stroke-dasharray': '3 4' });
      const circle = node('circle');
      const radius = Math.max(24, Math.ceil(String(label).length * 7.5 + 5));
      attributes(circle, { cx: x, cy: y, r: radius, class: 'annotation-number' });
      const text = node('text');
      text.setAttribute('x', x); text.setAttribute('y', y + 8); text.setAttribute('text-anchor', 'middle'); text.textContent = label;
      group.append(leader, circle, text);
    }
    return group;
  };
}

export function SVG_NS() { return NS; }
