let rendererNumber = 0;

export const MARK_PALETTE = Object.freeze([
  '#ffb000', '#00d4ff', '#ff4fd8', '#9dff3d', '#b58cff', '#ff7a18', '#3dffc0', '#ff4d5e',
]);

const DEFAULT_COLOUR = '#e8c777';
const CLOSED = new Set(['ellipse', 'rect', 'polygon']);
const NS = 'http://www.w3.org/2000/svg';

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

function anchor(row) {
  if (row.shape === 'ellipse') return [row.cx * 1000, Math.max(30, (row.cy - row.ry) * 1000)];
  if (row.shape === 'rect') return [row.x * 1000, Math.max(30, row.y * 1000)];
  if (row.shape === 'arrow') return [row.x1 * 1000, Math.max(30, row.y1 * 1000)];
  return [row.points[0][0] * 1000, Math.max(30, row.points[0][1] * 1000)];
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

function markerNode(svg, colour, prefix) {
  const id = `${prefix}-arrow-${colour.replace('#', '')}`;
  if (svg.querySelector(`#${id}`)) return id;
  const defs = svg.querySelector('defs') || svg.appendChild(node('defs'));
  const marker = node('marker');
  for (const [key, value] of Object.entries({ id, viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' })) marker.setAttribute(key, value);
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

export function annotationRenderer(svg, { prefix = `marks-${++rendererNumber}`, neutral = false } = {}) {
  return function draw(row, { label = '', className = 'annotation' } = {}) {
    const colour = neutral ? DEFAULT_COLOUR : markColour(row);
    const pattern = neutral ? 'none' : row.style?.pattern || 'none';
    const group = node('g');
    group.setAttribute('class', className);
    group.dataset.annotationId = row.id;
    const [tag, attrs] = geometry(row);
    const patternId = `${prefix}-pattern-${pattern}-${colour.replace('#', '')}`;
    if (CLOSED.has(row.shape) && pattern !== 'none') patternNode(svg, colour, pattern, patternId);
    const backdrop = node(tag), shape = node(tag);
    for (const shapeNode of [backdrop, shape]) {
      for (const [key, value] of Object.entries(attrs)) shapeNode.setAttribute(key, value);
      shapeNode.setAttribute('vector-effect', 'non-scaling-stroke');
    }
    backdrop.setAttribute('fill', 'none');
    backdrop.setAttribute('stroke', '#0a0e10');
    backdrop.setAttribute('stroke-opacity', '.8');
    backdrop.setAttribute('stroke-width', '5.5');
    shape.setAttribute('fill', CLOSED.has(row.shape) && pattern !== 'none' ? `url(#${patternId})` : 'none');
    shape.setAttribute('stroke', colour);
    shape.setAttribute('stroke-width', '2.6');
    if (row.shape === 'arrow') shape.setAttribute('marker-end', `url(#${markerNode(svg, colour, prefix)})`);
    group.append(backdrop, shape);
    if (label) {
      const [x, y] = anchor(row);
      const circle = node('circle');
      circle.setAttribute('cx', x); circle.setAttribute('cy', y); circle.setAttribute('r', '24'); circle.setAttribute('class', 'annotation-number');
      const text = node('text');
      text.setAttribute('x', x); text.setAttribute('y', y + 8); text.setAttribute('text-anchor', 'middle'); text.textContent = label;
      group.append(circle, text);
    }
    return group;
  };
}

export function SVG_NS() { return NS; }
